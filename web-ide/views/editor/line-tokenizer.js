// views/editor/line-tokenizer.js — построчная токенизация для подсветки.
// Единственная ответственность: превращение строки в раскрашенные токены.

import { EDITOR_KEYWORDS, EDITOR_TYPES, EDITOR_BUILTINS } from './editor-theme.js';

export function tokenizeLine(line) {
    const tokens = [];
    let i = 0;

    while (i < line.length) {
        // Comments
        if (line.slice(i, i + 2) === '//') {
            tokens.push({ text: line.slice(i), type: 'comment' });
            break;
        }

        // Strings
        if (line[i] === '"') {
            let j = i + 1;
            while (j < line.length && line[j] !== '"') {
                if (line[j] === '\\') j++;
                j++;
            }
            tokens.push({ text: line.slice(i, j + 1), type: 'string' });
            i = j + 1;
            continue;
        }

        // Numbers
        if (/\d/.test(line[i])) {
            let j = i;
            while (j < line.length && /[\d.]/.test(line[j])) j++;
            tokens.push({ text: line.slice(i, j), type: 'number' });
            i = j;
            continue;
        }

        // Identifiers and keywords
        if (/[a-zA-Z_]/.test(line[i])) {
            let j = i;
            while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
            const word = line.slice(i, j);

            if (EDITOR_KEYWORDS.has(word)) {
                tokens.push({ text: word, type: 'keyword' });
            } else if (EDITOR_TYPES.has(word)) {
                tokens.push({ text: word, type: 'type' });
            } else if (EDITOR_BUILTINS.has(word)) {
                tokens.push({ text: word, type: 'builtin' });
            } else {
                tokens.push({ text: word, type: 'variable' });
            }

            i = j;
            continue;
        }

        // Operators
        if (/[+\-*/=<>!&|]/.test(line[i])) {
            let j = i;
            while (j < line.length && /[+\-*/=<>!&|]/.test(line[j])) j++;
            tokens.push({ text: line.slice(i, j), type: 'operator' });
            i = j;
            continue;
        }

        // Whitespace
        if (/\s/.test(line[i])) {
            let j = i;
            while (j < line.length && /\s/.test(line[j])) j++;
            tokens.push({ text: line.slice(i, j), type: 'text' });
            i = j;
            continue;
        }

        // Other characters
        tokens.push({ text: line[i], type: 'text' });
        i++;
    }

    return tokens;
}