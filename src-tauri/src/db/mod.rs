//! SQLCipher-encrypted SQLite access. The DB is opened with the in-memory key set via
//! `PRAGMA key` BEFORE any read/write. Migrations are forward-only, versioned, recorded in
//! `schema_migrations`, and each runs inside ONE transaction (ACID — .claude/rules/database.md).

use rusqlite::Connection;
use std::path::Path;

pub mod accounts;
pub mod categories;
pub mod goals;
pub mod recurring;
pub mod rules;
pub mod transactions;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("wrong passphrase or corrupt database")]
    KeyVerificationFailed,
    #[error("{0}")]
    Invalid(String),
}

/// Forward-only migration list. NEVER edit a shipped migration — add a new, higher version
/// (db-migration skill). Each `&str` is the forward DDL; the runner records the version.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("migrations/0001_init.sql")),
    (2, include_str!("migrations/0002_category_archived.sql")),
    (3, include_str!("migrations/0003_goals.sql")),
];

/// Open the encrypted DB: set the raw key, then verify with a cheap read. A failed verify means
/// a wrong key or corruption. `key_hex` is the lowercase 64-char hex of the 32-byte key.
pub fn open_encrypted(path: &Path, key_hex: &str) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    // Raw-key form: SQLCipher uses the bytes directly (no extra KDF on its side).
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;
    // Sensible cipher defaults; cheap verify read fails fast on a bad key.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| DbError::KeyVerificationFailed)?;
    Ok(conn)
}

/// Apply any pending migrations in version order, each inside its own transaction together with
/// its `schema_migrations` record. Returns the resulting schema version.
pub fn run_migrations(conn: &Connection, now_iso: &str) -> Result<i64, DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let mut current: i64 =
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| {
            r.get(0)
        })?;

    for (version, sql) in MIGRATIONS {
        if *version > current {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![version, now_iso],
            )?;
            tx.commit()?;
            current = *version;
        }
    }
    Ok(current)
}

/// Open the encrypted DB and bring it fully up to date: set the key, run migrations, seed
/// first-run defaults. Returns the ready-to-use connection. Used at startup (and by `db_health`).
pub fn open_and_migrate(path: &Path, key_hex: &str, now_iso: &str) -> Result<Connection, DbError> {
    let conn = open_encrypted(path, key_hex)?;
    run_migrations(&conn, now_iso)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

/// Seed a minimal starter set on first run so the app isn't empty. Idempotent: only seeds when
/// the respective table is empty. Wrapped in one transaction (ACID).
pub fn seed_defaults(conn: &Connection) -> Result<(), DbError> {
    let tx = conn.unchecked_transaction()?;

    let account_count: i64 = tx.query_row("SELECT count(*) FROM accounts", [], |r| r.get(0))?;
    if account_count == 0 {
        // Default currency MUR (design-system §8). Multi-account schema, single default in v1.
        tx.execute(
            "INSERT INTO accounts (name, type, currency, opening_balance_minor, archived)
             VALUES ('Cash', 'cash', 'MUR', 0, 0)",
            [],
        )?;
    }

    let category_count: i64 = tx.query_row("SELECT count(*) FROM categories", [], |r| r.get(0))?;
    if category_count == 0 {
        let defaults: &[(&str, &str)] = &[
            ("Groceries", "expense"),
            ("Dining", "expense"),
            ("Transport", "expense"),
            ("Rent", "expense"),
            ("Utilities", "expense"),
            ("Shopping", "expense"),
            ("Health", "expense"),
            ("Entertainment", "expense"),
            ("Salary", "income"),
            ("Other Income", "income"),
        ];
        for (name, kind) in defaults {
            tx.execute(
                "INSERT INTO categories (name, parent_id, kind, archived) VALUES (?1, NULL, ?2, 0)",
                rusqlite::params![name, kind],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

/// True if the connection is actually encrypted (SQLCipher reports a non-zero cipher version).
pub fn is_encrypted(conn: &Connection) -> bool {
    conn.query_row("PRAGMA cipher_version", [], |r| r.get::<_, String>(0))
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runtime proof that bundled SQLCipher actually encrypts on disk, that migrations run on
    /// the encrypted connection, and that a wrong key is rejected (de-risk item #1).
    #[test]
    fn encrypted_roundtrip_and_wrong_key_rejected() {
        let mut path = std::env::temp_dir();
        // Unique-ish name without Date/random: use the test thread + a fixed tag.
        path.push(format!("budgetmate_test_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);

        let good = "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee";
        {
            let conn = open_encrypted(&path, good).unwrap();
            assert!(is_encrypted(&conn), "connection must report SQLCipher cipher version");
            let v = run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
            assert_eq!(v, MIGRATIONS.len() as i64);
        }

        // Raw bytes on disk must NOT contain the plaintext SQLite header "SQLite format 3".
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !bytes.windows(15).any(|w| w == b"SQLite format 3"),
            "database file is not encrypted at rest"
        );

        // Reopening with the correct key works…
        assert!(open_encrypted(&path, good).is_ok());
        // …and a different key fails verification.
        let bad = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        assert!(matches!(
            open_encrypted(&path, bad),
            Err(DbError::KeyVerificationFailed)
        ));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migrations_apply_and_are_idempotent() {
        // In-memory DB (no key) is enough to exercise the migration runner logic.
        let conn = Connection::open_in_memory().unwrap();
        let v1 = run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        assert_eq!(v1, MIGRATIONS.len() as i64);
        // Re-running must not double-apply or error.
        let v2 = run_migrations(&conn, "2026-06-05T00:00:01Z").unwrap();
        assert_eq!(v2, MIGRATIONS.len() as i64);
        // Core tables exist.
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='transactions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn seed_defaults_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        seed_defaults(&conn).unwrap();
        seed_defaults(&conn).unwrap(); // second run must not duplicate

        let accounts: i64 = conn.query_row("SELECT count(*) FROM accounts", [], |r| r.get(0)).unwrap();
        let categories: i64 =
            conn.query_row("SELECT count(*) FROM categories", [], |r| r.get(0)).unwrap();
        assert_eq!(accounts, 1, "exactly one default account");
        assert_eq!(categories, 10, "default category set seeded once");
    }
}
