// compiler/token.js — типы токенов и множество ключевых слов языка Latent.
// Единственная ответственность: описание лексических категорий.

export const TokenType = {
    Number: 'Number',
    String: 'String',
    Ident: 'Ident',
    Keyword: 'Keyword',
    Op: 'Op',
    Punct: 'Punct',
    EOF: 'EOF',
};

// Ключевые слова языка. Полный набор соответствует спецификации (Часть II):
// управление, OOP, конкурентность, AI-типы и тестовые конструкции.
// Часть слов — «мягкие»: распознаются здесь как Keyword, но в парсере
// допускаются и как обычные идентификаторы (см. parser-*).
export const KEYWORDS = new Set([
    // базовые
    'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return',
    'true', 'false', 'null', 'print',
    // OOP
    'class', 'new', 'this',
    // async
    'async', 'await',
    // конкурентность
    'spawn', 'channel', 'select', 'case', 'default', 'yield',
    // pattern matching
    'match',
    // AI
    'ai', 'tensor', 'semantic',
    // тесты и контракты
    'test', 'assert', 'assert_eq', 'forall', 'snapshot',
    'ai_contract', 'enforce_contract',
]);

// «Мягкие» ключевые слова: синтаксически валидны и как имена переменных,
// хотя лексер помечает их Keyword. Парсер отступает к идентификатору, когда
// это уместно (например, `let test = 5;`).
export const SOFT_KEYWORDS = new Set([
    'test', 'assert', 'assert_eq', 'forall', 'snapshot',
    'ai_contract', 'enforce_contract', 'tensor', 'semantic',
    'case', 'default',
]);