//! Managed application state. `DbState` holds the single keyed SQLCipher connection in memory.
//!
//! It is `Option<Connection>` so it can be `None` when the app is **locked** — today it is opened
//! at startup with a dev key (see `lib.rs`); the unlock/key-lifecycle work (#2) will swap the key
//! source and set it to `None` on background/lock without changing the command surface.

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(Some(conn)))
    }

    /// Locked (no key in memory) until the DB is opened.
    pub fn locked() -> Self {
        Self(Mutex::new(None))
    }

    pub fn guard(&self) -> Result<MutexGuard<'_, Option<Connection>>, String> {
        self.0.lock().map_err(|_| "database state is poisoned".to_string())
    }

    /// Run `f` with the open connection, or return a clear error if the app is locked.
    pub fn with<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, crate::db::DbError>,
    ) -> Result<T, String> {
        let guard = self.guard()?;
        let conn = guard.as_ref().ok_or("database is locked")?;
        f(conn).map_err(|e| e.to_string())
    }
}
