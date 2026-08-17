// syntax-highlight.js — подсветка синтаксиса Latent для CodeMirror

CodeMirror.defineMode('latent', function() {
    const keywords = new Set([
        'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return',
        'class', 'new', 'this', 'match', 'case', 'spawn', 'select',
        'async', 'await', 'yield', 'true', 'false', 'null'
    ]);

    const types = new Set([
        'int', 'float', 'bool', 'string', 'void'
    ]);

    const builtins = new Set([
        'print', 'channel', 'ai', 'Embedding', 'Model', 'Result',
        'Option', 'Promise', 'Some', 'None', 'Ok', 'Err'
    ]);

    return {
        startState: function() {
            return { inString: false, inComment: false };
        },

        token: function(stream, state) {
            // Комментарии
            if (stream.match('//')) {
                stream.skipToEnd();
                return 'comment';
            }

            if (stream.match('/*')) {
                state.inComment = true;
                return 'comment';
            }

            if (state.inComment) {
                if (stream.match('*/')) {
                    state.inComment = false;
                } else {
                    stream.next();
                }
                return 'comment';
            }

            // Строки
            if (stream.match('"')) {
                state.inString = !state.inString;
                return 'string';
            }

            if (state.inString) {
                stream.next();
                return 'string';
            }

            // Числа
            if (stream.match(/^\d+(\.\d+)?/)) {
                return 'number';
            }

            // Идентификаторы и ключевые слова
            if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
                const word = stream.current();

                if (keywords.has(word)) return 'keyword';
                if (types.has(word)) return 'type';
                if (builtins.has(word)) return 'builtin';

                return 'variable';
            }

            // Операторы
            if (stream.match(/^[+\-*/=<>!&|]+/)) {
                return 'operator';
            }

            stream.next();
            return null;
        }
    };
});
