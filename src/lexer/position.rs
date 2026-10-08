//! Позиция в исходном коде.

/// Позиция в исходном коде (строка, столбец, байтовое смещение).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
    pub offset: usize,
}

impl Position {
    pub fn new(line: usize, column: usize, offset: usize) -> Self {
        Self { line, column, offset }
    }
}