//! Deterministic if-then rule engine (FR-2.3). Ordered rules evaluated top-down; the same rules
//! apply at import time and on manual entry. Fully inspectable - no hidden ML categorisation.
//!
//! Skeleton: the type surface is defined and unit-tested; persistence (`import_rules` table) and
//! full field/operator coverage are wired in a later change via the new-feature skill.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchOp {
    Contains,
    Equals,
}

impl MatchOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            MatchOp::Contains => "contains",
            MatchOp::Equals => "equals",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "contains" => Some(MatchOp::Contains),
            "equals" => Some(MatchOp::Equals),
            _ => None,
        }
    }
}

/// The transaction fields a rule may read (match) or write (set). Kept in sync with `RuleFields`.
pub const RULE_FIELDS: &[&str] = &["merchant", "category", "account"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub ordinal: i64,
    pub match_field: String,
    pub match_op: MatchOp,
    pub match_value: String,
    pub set_field: String,
    pub set_value: String,
    pub active: bool,
}

/// A subset of transaction fields a rule can read/write (extended as features land).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuleFields {
    pub merchant: Option<String>,
    pub category: Option<String>,
    pub account: Option<String>,
}

impl RuleFields {
    fn get(&self, field: &str) -> Option<&str> {
        match field {
            "merchant" => self.merchant.as_deref(),
            "category" => self.category.as_deref(),
            "account" => self.account.as_deref(),
            _ => None,
        }
    }
    fn set(&mut self, field: &str, value: &str) {
        match field {
            "category" => self.category = Some(value.to_string()),
            "account" => self.account = Some(value.to_string()),
            "merchant" => self.merchant = Some(value.to_string()),
            _ => {}
        }
    }
}

fn matches(rule: &Rule, fields: &RuleFields) -> bool {
    let Some(actual) = fields.get(&rule.match_field) else {
        return false;
    };
    match rule.match_op {
        MatchOp::Contains => actual.to_lowercase().contains(&rule.match_value.to_lowercase()),
        MatchOp::Equals => actual.eq_ignore_ascii_case(&rule.match_value),
    }
}

/// A rule that fired, recorded so the result is inspectable (which rule set which field, and why
/// it matched, NFR-Rel3 - "no black boxes").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub ordinal: i64,
    pub set_field: String,
    pub set_value: String,
    pub match_field: String,
    pub match_op: MatchOp,
    pub match_value: String,
}

/// Apply ordered rules top-down, recording each one that fires. Later rules can override earlier.
pub fn apply_rules_traced(rules: &[Rule], mut fields: RuleFields) -> (RuleFields, Vec<Applied>) {
    let mut ordered: Vec<&Rule> = rules.iter().filter(|r| r.active).collect();
    ordered.sort_by_key(|r| r.ordinal);
    let mut applied = Vec::new();
    for rule in ordered {
        if matches(rule, &fields) {
            fields.set(&rule.set_field, &rule.set_value);
            applied.push(Applied {
                ordinal: rule.ordinal,
                set_field: rule.set_field.clone(),
                set_value: rule.set_value.clone(),
                match_field: rule.match_field.clone(),
                match_op: rule.match_op,
                match_value: rule.match_value.clone(),
            });
        }
    }
    (fields, applied)
}

/// Apply ordered rules top-down. Each matching rule sets a field; later rules can override.
pub fn apply_rules(rules: &[Rule], fields: RuleFields) -> RuleFields {
    apply_rules_traced(rules, fields).0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(ord: i64, mf: &str, mv: &str, sf: &str, sv: &str) -> Rule {
        Rule {
            ordinal: ord,
            match_field: mf.into(),
            match_op: MatchOp::Contains,
            match_value: mv.into(),
            set_field: sf.into(),
            set_value: sv.into(),
            active: true,
        }
    }

    #[test]
    fn uber_maps_to_transport() {
        let rules = vec![rule(1, "merchant", "uber", "category", "Transport")];
        let out = apply_rules(
            &rules,
            RuleFields { merchant: Some("UBER *TRIP".into()), ..Default::default() },
        );
        assert_eq!(out.category.as_deref(), Some("Transport"));
    }

    #[test]
    fn order_determines_override() {
        let rules = vec![
            rule(1, "merchant", "shop", "category", "General"),
            rule(2, "merchant", "coffee", "category", "Cafe"),
        ];
        let out = apply_rules(
            &rules,
            RuleFields { merchant: Some("Coffee Shop".into()), ..Default::default() },
        );
        // Both match; the higher ordinal wins.
        assert_eq!(out.category.as_deref(), Some("Cafe"));
    }

    #[test]
    fn trace_records_which_rules_fired() {
        let rules = vec![
            rule(1, "merchant", "coffee", "category", "Cafe"),
            rule(2, "merchant", "tea", "category", "Tea"), // does not match
        ];
        let (out, applied) = apply_rules_traced(
            &rules,
            RuleFields { merchant: Some("Coffee Shop".into()), ..Default::default() },
        );
        assert_eq!(out.category.as_deref(), Some("Cafe"));
        assert_eq!(applied.len(), 1);
        assert_eq!(applied[0].ordinal, 1);
        assert_eq!(applied[0].set_field, "category");
        assert_eq!(applied[0].set_value, "Cafe");
        assert_eq!(applied[0].match_field, "merchant");
        assert_eq!(applied[0].match_op, MatchOp::Contains);
        assert_eq!(applied[0].match_value, "coffee");
    }

    #[test]
    fn match_op_roundtrips() {
        for op in [MatchOp::Contains, MatchOp::Equals] {
            assert_eq!(MatchOp::parse(op.as_str()), Some(op));
        }
        assert_eq!(MatchOp::parse("regex"), None);
    }
}
