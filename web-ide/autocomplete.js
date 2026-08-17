// autocomplete.js — автодополнение для Latent

const completions = [
    // Ключевые слова
    { text: 'fn', displayText: 'fn name(params) -> type { }', hint: 'Function' },
    { text: 'let', displayText: 'let name: type = value;', hint: 'Variable' },
    { text: 'if', displayText: 'if (cond) { } else { }', hint: 'Conditional' },
    { text: 'while', displayText: 'while (cond) { }', hint: 'Loop' },
    { text: 'for', displayText: 'for (let i = 0; i < n; i = i + 1) { }', hint: 'For loop' },
    { text: 'match', displayText: 'match expr { case pattern: ... }', hint: 'Pattern match' },
    { text: 'spawn', displayText: 'spawn { ... }', hint: 'Goroutine' },
    { text: 'class', displayText: 'class Name { ... }', hint: 'Class' },

    // Типы
    { text: 'int', hint: 'Type' },
    { text: 'float', hint: 'Type' },
    { text: 'bool', hint: 'Type' },
    { text: 'string', hint: 'Type' },

    // AI
    { text: 'ai.load', displayText: 'ai.load("model-name")', hint: 'Load AI model' },
    { text: 'ai.infer', displayText: 'ai.infer(model, input)', hint: 'AI inference' },
    { text: 'ai.embed', displayText: 'ai.embed(text)', hint: 'Get embedding' },
    { text: 'ai.agent', displayText: 'ai.agent(name, config)', hint: 'Create AI agent' },
    { text: 'ai_generate!', displayText: 'ai_generate!("prompt")', hint: 'Compile-time codegen' },

    // Встроенные функции
    { text: 'print', displayText: 'print(value)', hint: 'Print to console' },
    { text: 'channel', displayText: 'channel<T>()', hint: 'Create channel' },
];

export function setupAutocomplete(editor) {
    editor.on('inputRead', function(cm, change) {
        if (change.text[0].match(/[a-zA-Z]/)) {
            CodeMirror.commands.autocomplete(cm, null, {
                completeSingle: false
            });
        }
    });

    CodeMirror.registerHelper('hint', 'latent', function(cm) {
        const cursor = cm.getCursor();
        const token = cm.getTokenAt(cursor);
        const start = token.start;
        const end = cursor.ch;
        const currentWord = token.string;

        const list = completions.filter(item =>
            item.text.startsWith(currentWord)
        );

        return {
            list: list,
            from: CodeMirror.Pos(cursor.line, start),
            to: CodeMirror.Pos(cursor.line, end)
        };
    });
}
