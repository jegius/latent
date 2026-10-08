// views/editor/editor-theme.js — тема и лексические множества редактора.
// Единственная ответственность: палитра IntelliJ Darcula 2026 и наборы слов.

// Тема IntelliJ IDEA Darcula 2026
export const EDITOR_THEME = {
    background: '#1e1f22',
    gutter: '#1e1f22',
    text: '#bcbec4',
    keyword: '#cf8e6d',
    type: '#56a8f5',
    builtin: '#56a8f5',
    number: '#2aacb8',
    string: '#6aab73',
    comment: '#7a7e85',
    operator: '#bcbec4',
    variable: '#bcbec4',
    function: '#56a8f5',
    cursor: '#ffffff',
    selection: '#214283',
    currentLine: 'rgba(255,255,255,0.045)',
};

export const EDITOR_KEYWORDS = new Set([
    'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return',
    'class', 'new', 'this', 'match', 'case', 'default', 'spawn', 'select',
    'async', 'await', 'yield', 'test', 'assert', 'assert_eq', 'forall',
    'snapshot', 'true', 'false', 'null'
]);

export const EDITOR_TYPES = new Set(['int', 'float', 'bool', 'string', 'void', 'channel']);

export const EDITOR_BUILTINS = new Set([
    'print', 'channel', 'ai', 'tensor', 'semantic', 'Embedding', 'Model',
    'Result', 'Option', 'Promise', 'Some', 'None', 'Ok', 'Err',
    'matmul', 'cosine_similarity', 'snapshot', 'ai_contract', 'enforce_contract',
]);

export const LINE_NUMBER_COLOR = '#606366';
export const LINE_NUMBER_ACTIVE_COLOR = '#a9b7c6';
export const CURRENT_LINE_HIGHLIGHT = 'rgba(255,255,255,0.045)';