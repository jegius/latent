//! Потоковая выдача токенов (streaming inference).

/// Streaming inference
pub struct AIStream {
    buffer: String,
    position: usize,
}

impl AIStream {
    pub fn new(text: String) -> Self {
        Self {
            buffer: text,
            position: 0,
        }
    }

    pub fn next_token(&mut self) -> Option<String> {
        // Пропускаем ведущие пробельные символы
        while self.position < self.buffer.len()
            && self.buffer[self.position..].chars().next().map_or(false, |c| c.is_whitespace())
        {
            self.position += self.buffer[self.position..].chars().next().unwrap().len_utf8();
        }
        if self.position >= self.buffer.len() {
            return None;
        }

        let start = self.position;
        let mut end = start;
        // Ищем конец слова, не выходя за границы и не разрывая UTF-8
        for c in self.buffer[start..].chars() {
            if c.is_whitespace() {
                break;
            }
            end += c.len_utf8();
        }

        self.position = end;
        Some(self.buffer[start..end].to_string())
    }

    pub fn collect(&mut self) -> String {
        // Возвращаем остаток, а не весь буфер: collect() должен быть потребляющим.
        let rest = self.buffer[self.position..].to_string();
        self.position = self.buffer.len();
        rest
    }

    /// Применяет обработчик к каждому оставшемуся токену.
    pub fn for_each<F: FnMut(&str)>(&mut self, mut f: F) {
        while let Some(tok) = self.next_token() {
            f(&tok);
        }
    }
}