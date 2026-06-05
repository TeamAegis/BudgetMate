//! Domain entities, money types, and invariants. Pure logic — no Tauri, no DB — so it is
//! unit-testable without a WebView (NFR-Maint2).

pub mod account;
pub mod category;
pub mod money;

pub use account::{Account, AccountKind};
pub use category::{Category, CategoryKind};
pub use money::{base_amount_minor, splits_sum_to_parent, Money};
