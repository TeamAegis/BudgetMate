//! Deterministic if-then rule engine (FR-2.3). Ordered rules evaluated top-down; the same rules
//! apply at import time and on manual entry. Fully inspectable — no hidden ML categorisation.
//!
//! Skeleton: the type surface is defined and unit-tested; persistence (`import_rules` table) and
//! full field/operator coverage are wired in a later change via the new-feature skill.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchOp {
    Contains,
    Equals,
}

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

/// Apply ordered rules top-down. Each matching rule sets a field; later rules can override.
pub fn apply_rules(rules: &[Rule], mut fields: RuleFields) -> RuleFields {
    let mut ordered: Vec<&Rule> = rules.iter().filter(|r| r.active).collect();
    ordered.sort_by_key(|r| r.ordinal);
    for rule in ordered {
        if matches(rule, &fields) {
            fields.set(&rule.set_field, &rule.set_value);
        }
    }
    fields
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
}
