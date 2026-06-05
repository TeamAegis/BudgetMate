//! Domain entities, money types, and invariants. Pure logic — no Tauri, no DB — so it is
//! unit-testable without a WebView (NFR-Maint2).

pub mod money;

pub use money::{base_amount_minor, splits_sum_to_parent, Money};
