//! Pattern matching для функционального стиля.

use super::value::Value;
use std::collections::HashMap;

/// Pattern matching
pub enum Pattern {
    Wildcard,
    Literal(Value),
    Identifier(String),
    Constructor(String, Vec<Pattern>),
}

/// Match result
pub enum MatchResult {
    Matched(HashMap<String, Value>),
    NotMatched,
}

/// Pattern matching engine
pub fn match_pattern(pattern: &Pattern, value: &Value) -> MatchResult {
    match (pattern, value) {
        (Pattern::Wildcard, _) => MatchResult::Matched(HashMap::new()),
        (Pattern::Literal(lit), value) if lit == value => {
            MatchResult::Matched(HashMap::new())
        }
        (Pattern::Identifier(name), value) => {
            let mut bindings = HashMap::new();
            bindings.insert(name.clone(), value.clone());
            MatchResult::Matched(bindings)
        }
        (Pattern::Constructor(name, args), Value::Object(obj)) => {
            if let Some(Value::String(ctor)) = obj.get("type") {
                if ctor == name {
                    let mut bindings = HashMap::new();
                    for (i, arg) in args.iter().enumerate() {
                        if let Some(field_value) = obj.get(&format!("_{}", i)) {
                            if let MatchResult::Matched(b) = match_pattern(arg, field_value) {
                                bindings.extend(b);
                            } else {
                                return MatchResult::NotMatched;
                            }
                        }
                    }
                    return MatchResult::Matched(bindings);
                }
            }
            MatchResult::NotMatched
        }
        _ => MatchResult::NotMatched,
    }
}