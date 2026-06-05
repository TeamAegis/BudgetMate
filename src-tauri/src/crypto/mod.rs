//! Passphrase KDF and DB-key handling. The 256-bit DB key is derived from the user passphrase
//! with Argon2id and held in memory ONLY (zeroised on lock/background, FR-5.2). Keys, passphrases
//! and derived secrets are NEVER logged.

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    Kdf,
}

/// Argon2id parameters, **recorded per-install** (in the vault meta sidecar) so a future open
/// derives the identical key even if the crate's defaults change between versions. NEVER mutate
/// these for an existing install — it would change the derived key and lock the user out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    /// Always "argon2id" for now; recorded for forward-compatibility.
    pub algorithm: String,
    /// Argon2 version (0x13).
    pub version: u32,
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Iterations (time cost).
    pub t_cost: u32,
    /// Parallelism (lanes).
    pub p_cost: u32,
    /// Output length in bytes (32 for a SQLCipher raw key).
    pub output_len: usize,
}

impl Default for KdfParams {
    /// Capture the crate's current Argon2 defaults explicitly so they're frozen at enrolment.
    fn default() -> Self {
        let p = Params::default();
        Self {
            algorithm: "argon2id".to_string(),
            version: Version::V0x13 as u32,
            m_cost: p.m_cost(),
            t_cost: p.t_cost(),
            p_cost: p.p_cost(),
            output_len: 32,
        }
    }
}

/// Derive a 32-byte SQLCipher key from a passphrase + salt using Argon2id with the crate defaults.
/// The returned buffer zeroises itself when dropped.
pub fn derive_key(passphrase: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    derive_key_with_params(passphrase, salt, &KdfParams::default())
}

/// Derive a 32-byte SQLCipher key using explicitly-recorded Argon2id parameters. Used by the
/// unlock flow so the key is reproducible across app versions. Zeroises on drop.
pub fn derive_key_with_params(
    passphrase: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let mut key = Zeroizing::new([0u8; 32]);
    let p = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(params.output_len))
        .map_err(|_| CryptoError::Kdf)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, p);
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
    fn default_params_match_plain_derive_key() {
        // derive_key (Params::default) and derive_key_with_params(KdfParams::default) must agree,
        // otherwise an existing install would fail to reopen after a refactor.
        let a = derive_key(b"matching", b"some-salt-16byte").unwrap();
        let b =
            derive_key_with_params(b"matching", b"some-salt-16byte", &KdfParams::default()).unwrap();
        assert_eq!(a.as_ref(), b.as_ref());
    }

    #[test]
    fn recorded_params_roundtrip_via_json() {
        let p = KdfParams::default();
        let json = serde_json::to_string(&p).unwrap();
        let back: KdfParams = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
        assert_eq!(back.algorithm, "argon2id");
        assert_eq!(back.output_len, 32);
    }

    #[test]
    fn hex_is_64_lowercase_chars() {
        let key = derive_key(b"pw", b"some-salt-16byte").unwrap();
        let hex = key_to_sqlcipher_hex(&key);
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
