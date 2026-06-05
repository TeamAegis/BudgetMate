//! Passphrase KDF and DB-key handling. The 256-bit DB key is derived from the user passphrase
//! with Argon2id and held in memory ONLY (zeroised on lock/background, FR-5.2). Keys, passphrases
//! and derived secrets are NEVER logged.

use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    Kdf,
}

/// Derive a 32-byte SQLCipher key from a passphrase + salt using Argon2id.
/// The returned buffer zeroises itself when dropped.
pub fn derive_key(passphrase: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let mut key = Zeroizing::new([0u8; 32]);
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::default());
    argon
        .hash_password_into(passphrase, salt, key.as_mut())
        .map_err(|_| CryptoError::Kdf)?;
    Ok(key)
}

/// Encode a raw key as the lowercase hex SQLCipher expects in `PRAGMA key = "x'<hex>'"`.
/// The returned string contains key material — do not log it.
pub fn key_to_sqlcipher_hex(key: &[u8; 32]) -> Zeroizing<String> {
    let mut s = String::with_capacity(64);
    for b in key.iter() {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    Zeroizing::new(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic_and_32_bytes() {
        let a = derive_key(b"correct horse battery staple", b"some-salt-16byte").unwrap();
        let b = derive_key(b"correct horse battery staple", b"some-salt-16byte").unwrap();
        assert_eq!(a.as_ref(), b.as_ref());
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn different_passphrase_yields_different_key() {
        let a = derive_key(b"passphrase-one", b"some-salt-16byte").unwrap();
        let b = derive_key(b"passphrase-two", b"some-salt-16byte").unwrap();
        assert_ne!(a.as_ref(), b.as_ref());
    }

    #[test]
    fn hex_is_64_lowercase_chars() {
        let key = derive_key(b"pw", b"some-salt-16byte").unwrap();
        let hex = key_to_sqlcipher_hex(&key);
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
