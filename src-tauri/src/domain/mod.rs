//! Domain entities, money types, and invariants. Pure logic - no Tauri, no DB - so it is
//! unit-testable without a WebView (NFR-Maint2).

pub mod account;
pub mod budget;
pub mod category;
pub mod dashboard;
pub mod goal;
pub mod money;
pub mod recurring;
pub mod report;
pub mod transaction;

pub use account::{Account, AccountKind};
pub use budget::{Budget, EnvelopeStatus, EnvelopeSummary};
pub use category::{Category, CategoryKind};
pub use dashboard::{BalancePoint, DashboardData};
pub use goal::Goal;
pub use money::{base_amount_minor, splits_sum_to_parent, Money};
pub use recurring::{plan, Schedule};
pub use report::{CategorySpend, Granularity, ReportData, ReportPeriod, TimeBucket};
pub use transaction::{Transaction, TxSplit};
