//! Category entity + validation + tree-cycle detection (pure; the DB layer supplies the lookup).

use serde::{Deserialize, Serialize};

/// Mirrors TS `Category`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub kind: CategoryKind,
    pub archived: bool,
}

/// Mirrors TS `CategoryKind`. Stored in the DB `kind` column as the lowercase str.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryKind {
    Expense,
    Income,
    Transfer,
}

impl CategoryKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CategoryKind::Expense => "expense",
            CategoryKind::Income => "income",
            CategoryKind::Transfer => "transfer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "expense" => Some(CategoryKind::Expense),
            "income" => Some(CategoryKind::Income),
            "transfer" => Some(CategoryKind::Transfer),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("a category cannot be its own parent")]
    SelfParent,
    #[error("this parent would create a cycle in the category tree")]
    Cycle,
}

pub fn validate_name(name: &str) -> Result<(), ValidationError> {
    if name.trim().is_empty() {
        Err(ValidationError::EmptyName)
    } else {
        Ok(())
    }
}

/// Would setting `new_parent` as the parent of `target_id` create a cycle? Walks ancestors of
/// `new_parent` via `parent_of`; a cycle exists if we reach `target_id`. Pure + testable; the DB
/// layer passes a closure that reads `categories.parent_id`.
pub fn creates_cycle(
    target_id: i64,
    new_parent: Option<i64>,
    parent_of: &dyn Fn(i64) -> Option<i64>,
) -> bool {
    let mut cursor = new_parent;
    // Bound the walk defensively in case existing data already contains a loop.
    let mut steps = 0;
    while let Some(p) = cursor {
        if p == target_id {
            return true;
        }
        steps += 1;
        if steps > 10_000 {
            return true;
        }
        cursor = parent_of(p);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn empty_name_rejected() {
        assert_eq!(validate_name(" "), Err(ValidationError::EmptyName));
        assert!(validate_name("Groceries").is_ok());
    }

    #[test]
    fn kind_roundtrips() {
        for k in [CategoryKind::Expense, CategoryKind::Income, CategoryKind::Transfer] {
            assert_eq!(CategoryKind::parse(k.as_str()), Some(k));
        }
        assert_eq!(CategoryKind::parse("savings"), None);
    }

    #[test]
    fn detects_cycles() {
        // tree: 1 <- 2 <- 3  (3's parent 2, 2's parent 1)
        let parents: HashMap<i64, i64> = HashMap::from([(2, 1), (3, 2)]);
        let lookup = |id: i64| parents.get(&id).copied();

        // Re-parenting 1 under 3 would create a cycle (3 -> 2 -> 1 -> 3).
        assert!(creates_cycle(1, Some(3), &lookup));
        // Re-parenting 3 under 1 is fine (no cycle).
        assert!(!creates_cycle(3, Some(1), &lookup));
        // A node cannot reach itself through a clean chain.
        assert!(!creates_cycle(4, Some(3), &lookup));
        // Direct self-parent is a cycle.
        assert!(creates_cycle(2, Some(2), &lookup));
    }
}
