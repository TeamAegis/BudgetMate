//! Managed application state. `DbState` holds the single keyed SQLCipher connection in memory.
//!
//! It is `Option<Connection>` so it can be `None` when the app is **locked**. The app boots locked
//! (`lib.rs`); the unlock flow derives the key, opens the connection, and calls `unlock()`. On
//! background/idle the connection is dropped via `lock()`, which closes it and lets SQLCipher free
//! its in-memory key. The key itself is never stored here - the keyed `Connection` *is* the live
//! secret, and the `Zeroizing` key/hex used to open it are dropped (zeroised) by the unlock
//! command the instant the connection opens.

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

use crate::error::AppError;

pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(Some(conn)))
    }

    /// Locked (no key in memory) until the DB is opened.
    pub fn locked() -> Self {
        Self(Mutex::new(None))
    }

    /// Install an opened connection (transition locked → unlocked).
    pub fn unlock(&self, conn: Connection) -> Result<(), AppError> {
        let mut guard = self.guard()?;
        *guard = Some(conn);
        Ok(())
    }

    /// Drop the connection (transition unlocked → locked). Closing the keyed connection frees
    /// SQLCipher's in-memory key. Idempotent.
    pub fn lock(&self) -> Result<(), AppError> {
        let mut guard = self.guard()?;
        *guard = None;
        Ok(())
    }

    pub fn is_unlocked(&self) -> bool {
        self.guard().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn guard(&self) -> Result<MutexGuard<'_, Option<Connection>>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal("database state is poisoned".to_string()))
    }

    /// Run `f` with the open connection, or return a clear error if the app is locked.
    pub fn with<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, crate::db::DbError>,
    ) -> Result<T, AppError> {
        let guard = self.guard()?;
        let conn = guard.as_ref().ok_or(AppError::Locked)?;
        f(conn).map_err(AppError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_unlock_transitions_gate_access() {
        let st = DbState::locked();
        assert!(!st.is_unlocked());
        // Locked: any DB access fails cleanly.
        assert!(matches!(st.with(|_| Ok(())).unwrap_err(), crate::error::AppError::Locked));

        // Unlock with an open connection.
        st.unlock(Connection::open_in_memory().unwrap()).unwrap();
        assert!(st.is_unlocked());
        st.with(|c| c.execute_batch("SELECT 1").map_err(Into::into)).unwrap();

        // Lock drops the connection; access is gated again. Locking twice is idempotent.
        st.lock().unwrap();
        assert!(!st.is_unlocked());
        st.lock().unwrap();
        assert!(st.with(|_| Ok(())).is_err());
    }
}
