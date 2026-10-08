// autocomplete.js — автодополнение для Latent

const completions = [
    // Ключевые слова
    { text: 'fn', displayText: 'fn name(params) -> type { }', hint: 'Function' },
    { text: 'let', displayText: 'let name: type = value;', hint: 'Variable' },
    { text: 'if', displayText: 'if (cond) { } else { }', hint: 'Conditional' },
    { text: 'while', displayText: 'while (cond) { }', hint: 'Loop' },
    { text: 'for', displayText: 'for (let i = 0; i < n; i = i + 1) { }', hint: 'For loop' },
    { text: 'for-in', displayText: 'for (let item in items) { }', hint: 'Iterate array' },
    { text: 'match', displayText: 'match expr { case pattern: ... default: ... }', hint: 'Pattern match' },
    { text: 'spawn', displayText: 'spawn { ... }', hint: 'Goroutine' },
    { text: 'select', displayText: 'select { case v <- ch: ... default: ... }', hint: 'Channel select' },
    { text: 'yield', displayText: 'yield;', hint: 'Yield to scheduler' },
    { text: 'class', displayText: 'class Name { field: Type; fn init() { } }', hint: 'Class' },
    { text: 'new', displayText: 'new Name(args)', hint: 'Instantiate class' },
    { text: 'this', displayText: 'this.field', hint: 'Current instance' },
    { text: 'async', displayText: 'async fn name() { }', hint: 'Async function' },
    { text: 'await', displayText: 'await expr', hint: 'Await promise' },
    { text: 'lambda', displayText: 'fn(x) => x * 2', hint: 'Lambda' },
    { text: 'test', displayText: 'test "name" { assert(true); }', hint: 'Test block' },
    { text: 'assert', displayText: 'assert(cond)', hint: 'Assertion' },
    { text: 'assert_eq', displayText: 'assert_eq(a, b)', hint: 'Assert equality' },

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
    { text: 'tensor', displayText: 'tensor(data, shape)', hint: 'Create tensor' },
    { text: 'semantic', displayText: 'semantic("text")', hint: 'Semantic vector' },
    { text: 'matmul', displayText: 'matmul(a, b)', hint: 'Matrix multiply' },
    { text: 'cosine_similarity', displayText: 'cosine_similarity(a, b)', hint: 'Cosine similarity' },
    { text: 'Ok', displayText: 'Ok(value)', hint: 'Result Ok' },
    { text: 'Err', displayText: 'Err(error)', hint: 'Result Err' },
    { text: 'Some', displayText: 'Some(value)', hint: 'Option Some' },
    { text: 'None', displayText: 'None()', hint: 'Option None' },
    { text: 'snapshot', displayText: 'snapshot("name")', hint: 'Snapshot value' },
    { text: 'ai_contract', displayText: 'ai_contract("name")', hint: 'AI contract' },
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
