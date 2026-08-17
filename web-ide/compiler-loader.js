// compiler-loader.js — загрузка компилятора Latent в браузере
//
// Реализация: JS-интерпретатор подмножества языка Latent.
// Поддерживает: fn, let, if/else, while, for, массивы, рекурсию,
// print, return, арифметику, сравнения, конкатенацию массивов,
// встроенные AI-функции (ai_infer, ai_embed).

// ============================================================
// Лексер
// ============================================================

const TokenType = {
    Number: 'Number',
    String: 'String',
    Ident: 'Ident',
    Keyword: 'Keyword',
    Op: 'Op',
    Punct: 'Punct',
    EOF: 'EOF',
};

const KEYWORDS = new Set([
    'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return',
    'true', 'false', 'null', 'print', 'ai', 'spawn', 'channel',
]);

function tokenize(source) {
    const tokens = [];
    let i = 0;
    let line = 1;

    const peek = (offset = 0) => source[i + offset];
    const advance = () => source[i++];

    while (i < source.length) {
        const ch = source[i];

        if (ch === '\n') { line++; i++; continue; }
        if (/\s/.test(ch)) { i++; continue; }

        // Комментарии
        if (ch === '/' && peek(1) === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }

        // Числа
        if (/\d/.test(ch)) {
            let num = '';
            while (i < source.length && /[\d.]/.test(source[i])) num += advance();
            tokens.push({ type: TokenType.Number, value: parseFloat(num), line });
            continue;
        }

        // Строки
        if (ch === '"') {
            advance(); // opening quote
            let str = '';
            while (i < source.length && source[i] !== '"') {
                if (source[i] === '\\') {
                    advance();
                    const esc = advance();
                    if (esc === 'n') str += '\n';
                    else if (esc === 't') str += '\t';
                    else str += esc;
                } else {
                    str += advance();
                }
            }
            advance(); // closing quote
            tokens.push({ type: TokenType.String, value: str, line });
            continue;
        }

        // Идентификаторы и ключевые слова
        if (/[a-zA-Z_]/.test(ch)) {
            let word = '';
            while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) word += advance();
            const type = KEYWORDS.has(word) ? TokenType.Keyword : TokenType.Ident;
            tokens.push({ type, value: word, line });
            continue;
        }

        // Двухсимвольные операторы
        const two = source.slice(i, i + 2);
        if (['==', '!=', '<=', '>=', '&&', '||', '->'].includes(two)) {
            tokens.push({ type: TokenType.Op, value: two, line });
            i += 2;
            continue;
        }

        // Односимвольные операторы
        if ('+-*/%<>=!'.includes(ch)) {
            tokens.push({ type: TokenType.Op, value: ch, line });
            i++;
            continue;
        }

        // Пунктуация
        if ('(){}[];,:.'.includes(ch)) {
            tokens.push({ type: TokenType.Punct, value: ch, line });
            i++;
            continue;
        }

        throw new Error(`Unexpected character '${ch}' at line ${line}`);
    }

    tokens.push({ type: TokenType.EOF, value: null, line });
    return tokens;
}

// ============================================================
// Парсер (рекурсивный спуск)
// ============================================================

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek(offset = 0) { return this.tokens[this.pos + offset]; }
    advance() { return this.tokens[this.pos++]; }
    check(type, value) {
        const t = this.peek();
        return t.type === type && (value === undefined || t.value === value);
    }
    match(type, value) {
        if (this.check(type, value)) { this.advance(); return true; }
        return false;
    }
    expect(type, value) {
        const t = this.peek();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new Error(`Expected ${value || type} but got '${t.value}' at line ${t.line}`);
        }
        return this.advance();
    }

    parseProgram() {
        const functions = {};
        while (!this.check(TokenType.EOF)) {
            const fn = this.parseFunction();
            functions[fn.name] = fn;
        }
        return { type: 'Program', functions };
    }

    parseFunction() {
        this.expect(TokenType.Keyword, 'fn');
        const name = this.expect(TokenType.Ident).value;
        this.expect(TokenType.Punct, '(');
        const params = [];
        if (!this.check(TokenType.Punct, ')')) {
            do {
                const paramName = this.expect(TokenType.Ident).value;
                // Пропускаем аннотацию типа: name: Type
                if (this.match(TokenType.Punct, ':')) {
                    this.parseTypeAnnotation();
                }
                params.push(paramName);
            } while (this.match(TokenType.Punct, ','));
        }
        this.expect(TokenType.Punct, ')');
        // Пропускаем возвращаемый тип: -> Type
        if (this.match(TokenType.Op, '->')) {
            this.parseTypeAnnotation();
        }
        const body = this.parseBlock();
        return { type: 'Function', name, params, body };
    }

    parseTypeAnnotation() {
        // Простой разбор типа: ident, [ident], (ident, ident)
        if (this.match(TokenType.Punct, '[')) {
            this.parseTypeAnnotation();
            this.expect(TokenType.Punct, ']');
            return;
        }
        if (this.match(TokenType.Punct, '(')) {
            if (!this.check(TokenType.Punct, ')')) {
                do { this.parseTypeAnnotation(); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ')');
            return;
        }
        // ident или встроенный тип
        if (this.check(TokenType.Ident) || this.check(TokenType.Keyword)) {
            this.advance();
            return;
        }
        throw new Error(`Invalid type annotation at line ${this.peek().line}`);
    }

    parseBlock() {
        this.expect(TokenType.Punct, '{');
        const statements = [];
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            statements.push(this.parseStatement());
        }
        this.expect(TokenType.Punct, '}');
        return { type: 'Block', statements };
    }

    parseStatement() {
        if (this.check(TokenType.Keyword, 'let')) return this.parseLet();
        if (this.check(TokenType.Keyword, 'if')) return this.parseIf();
        if (this.check(TokenType.Keyword, 'while')) return this.parseWhile();
        if (this.check(TokenType.Keyword, 'for')) return this.parseFor();
        if (this.check(TokenType.Keyword, 'return')) return this.parseReturn();
        if (this.check(TokenType.Keyword, 'print')) return this.parsePrint();
        if (this.check(TokenType.Keyword, 'spawn')) return this.parseSpawn();

        // Присваивание: ident = expr; или ident[index] = expr;
        if (this.check(TokenType.Ident)) {
            const next = this.peek(1);
            const next2 = this.peek(2);
            if (next.type === TokenType.Op && next.value === '=') {
                const name = this.advance().value;
                this.advance(); // '='
                const value = this.parseExpression();
                this.match(TokenType.Punct, ';');
                return { type: 'Assign', name, value };
            }
            if (next.type === TokenType.Punct && next.value === '[') {
                // Проверяем, есть ли '=' после закрывающей ']'
                let depth = 0;
                let j = this.pos + 1;
                while (j < this.tokens.length) {
                    const t = this.tokens[j];
                    if (t.type === TokenType.Punct && t.value === '[') depth++;
                    if (t.type === TokenType.Punct && t.value === ']') {
                        depth--;
                        if (depth === 0) {
                            const after = this.tokens[j + 1];
                            if (after && after.type === TokenType.Op && after.value === '=') {
                                const object = this.parsePostfix();
                                this.expect(TokenType.Op, '=');
                                const value = this.parseExpression();
                                this.match(TokenType.Punct, ';');
                                return { type: 'IndexAssign', object, value };
                            }
                            break;
                        }
                    }
                    j++;
                }
            }
        }

        const expr = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'ExprStmt', expr };
    }

    parseLet() {
        this.expect(TokenType.Keyword, 'let');
        const name = this.expect(TokenType.Ident).value;
        if (this.match(TokenType.Punct, ':')) {
            this.parseTypeAnnotation();
        }
        this.expect(TokenType.Op, '=');
        const value = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'Let', name, value };
    }

    parseIf() {
        this.expect(TokenType.Keyword, 'if');
        this.expect(TokenType.Punct, '(');
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ')');
        const thenBranch = this.parseBlock();
        let elseBranch = null;
        if (this.match(TokenType.Keyword, 'else')) {
            if (this.check(TokenType.Keyword, 'if')) {
                elseBranch = this.parseIf();
            } else {
                elseBranch = this.parseBlock();
            }
        }
        return { type: 'If', condition, thenBranch, elseBranch };
    }

    parseWhile() {
        this.expect(TokenType.Keyword, 'while');
        this.expect(TokenType.Punct, '(');
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ')');
        const body = this.parseBlock();
        return { type: 'While', condition, body };
    }

    parseFor() {
        this.expect(TokenType.Keyword, 'for');
        this.expect(TokenType.Punct, '(');
        // for (let i = 0; i < n; i = i + 1)
        const init = this.parseLet();
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ';');
        // update: присваивание вида i = i + 1 (без точки с запятой)
        let update;
        if (this.check(TokenType.Ident) && this.peek(1).type === TokenType.Op && this.peek(1).value === '=') {
            const name = this.advance().value;
            this.advance(); // '='
            const value = this.parseExpression();
            update = { type: 'Assign', name, value };
        } else {
            update = this.parseExpression();
        }
        this.expect(TokenType.Punct, ')');
        const body = this.parseBlock();
        return { type: 'For', init, condition, update, body };
    }

    parseReturn() {
        this.expect(TokenType.Keyword, 'return');
        const value = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'Return', value };
    }

    parsePrint() {
        this.expect(TokenType.Keyword, 'print');
        this.expect(TokenType.Punct, '(');
        const args = [this.parseExpression()];
        while (this.match(TokenType.Punct, ',')) {
            args.push(this.parseExpression());
        }
        this.expect(TokenType.Punct, ')');
        this.match(TokenType.Punct, ';');
        return { type: 'Print', args };
    }

    parseSpawn() {
        this.expect(TokenType.Keyword, 'spawn');
        // spawn f(args) — вызов функции как горутины
        const call = this.parsePostfix();
        if (call.type !== 'Call') {
            throw new Error(`spawn requires a function call at line ${this.peek().line}`);
        }
        this.match(TokenType.Punct, ';');
        return { type: 'Spawn', call };
    }

    // Приоритеты: || < && < ==/!= < </<=/>/>= < +/- < *//% < unary < call/index < primary
    parseExpression() { return this.parseOr(); }

    parseOr() {
        let left = this.parseAnd();
        while (this.match(TokenType.Op, '||')) {
            left = { type: 'Binary', op: '||', left, right: this.parseAnd() };
        }
        return left;
    }

    parseAnd() {
        let left = this.parseEquality();
        while (this.match(TokenType.Op, '&&')) {
            left = { type: 'Binary', op: '&&', left, right: this.parseEquality() };
        }
        return left;
    }

    parseEquality() {
        let left = this.parseComparison();
        while (true) {
            if (this.match(TokenType.Op, '==')) {
                left = { type: 'Binary', op: '==', left, right: this.parseComparison() };
            } else if (this.match(TokenType.Op, '!=')) {
                left = { type: 'Binary', op: '!=', left, right: this.parseComparison() };
            } else break;
        }
        return left;
    }

    parseComparison() {
        let left = this.parseAdditive();
        while (true) {
            if (this.match(TokenType.Op, '<')) {
                left = { type: 'Binary', op: '<', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '<=')) {
                left = { type: 'Binary', op: '<=', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '>')) {
                left = { type: 'Binary', op: '>', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '>=')) {
                left = { type: 'Binary', op: '>=', left, right: this.parseAdditive() };
            } else break;
        }
        return left;
    }

    parseAdditive() {
        let left = this.parseMultiplicative();
        while (true) {
            if (this.match(TokenType.Op, '+')) {
                left = { type: 'Binary', op: '+', left, right: this.parseMultiplicative() };
            } else if (this.match(TokenType.Op, '-')) {
                left = { type: 'Binary', op: '-', left, right: this.parseMultiplicative() };
            } else break;
        }
        return left;
    }

    parseMultiplicative() {
        let left = this.parseUnary();
        while (true) {
            if (this.match(TokenType.Op, '*')) {
                left = { type: 'Binary', op: '*', left, right: this.parseUnary() };
            } else if (this.match(TokenType.Op, '/')) {
                left = { type: 'Binary', op: '/', left, right: this.parseUnary() };
            } else if (this.match(TokenType.Op, '%')) {
                left = { type: 'Binary', op: '%', left, right: this.parseUnary() };
            } else break;
        }
        return left;
    }

    parseUnary() {
        if (this.match(TokenType.Op, '-')) {
            return { type: 'Unary', op: '-', operand: this.parseUnary() };
        }
        if (this.match(TokenType.Op, '!')) {
            return { type: 'Unary', op: '!', operand: this.parseUnary() };
        }
        return this.parsePostfix();
    }

    parsePostfix() {
        let expr = this.parsePrimary();
        while (true) {
            if (this.match(TokenType.Punct, '(')) {
                // Вызов функции
                const args = [];
                if (!this.check(TokenType.Punct, ')')) {
                    do { args.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
                }
                this.expect(TokenType.Punct, ')');
                expr = { type: 'Call', callee: expr, args };
            } else if (this.match(TokenType.Punct, '[')) {
                // Индексация
                const index = this.parseExpression();
                this.expect(TokenType.Punct, ']');
                expr = { type: 'Index', object: expr, index };
            } else if (this.match(TokenType.Punct, '.')) {
                // Доступ к полю/методу
                const name = this.expect(TokenType.Ident).value;
                expr = { type: 'Member', object: expr, name };
            } else break;
        }
        return expr;
    }

    parsePrimary() {
        const t = this.peek();

        if (t.type === TokenType.Number) { this.advance(); return { type: 'Number', value: t.value }; }
        if (t.type === TokenType.String) { this.advance(); return { type: 'String', value: t.value }; }
        if (t.type === TokenType.Keyword && t.value === 'true') { this.advance(); return { type: 'Bool', value: true }; }
        if (t.type === TokenType.Keyword && t.value === 'false') { this.advance(); return { type: 'Bool', value: false }; }
        if (t.type === TokenType.Keyword && t.value === 'null') { this.advance(); return { type: 'Null' }; }

        if (t.type === TokenType.Ident) { this.advance(); return { type: 'Ident', name: t.value }; }

        // Встроенный конструктор канала: channel()
        if (t.type === TokenType.Keyword && t.value === 'channel') {
            this.advance();
            return { type: 'Ident', name: 'channel' };
        }

        if (this.match(TokenType.Punct, '(')) {
            const expr = this.parseExpression();
            this.expect(TokenType.Punct, ')');
            return expr;
        }

        if (this.match(TokenType.Punct, '[')) {
            // Литерал массива
            const elements = [];
            if (!this.check(TokenType.Punct, ']')) {
                do { elements.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ']');
            return { type: 'Array', elements };
        }

        throw new Error(`Unexpected token '${t.value}' at line ${t.line}`);
    }
}

// ============================================================
// AI Provider Abstraction — позволяет подключать любой гейтвей
// ============================================================

/**
 * Глобальная конфигурация AI. Изменяется через configureAI().
 * provider: 'mock' | 'ollama' | 'openai-compatible'
 * baseUrl: базовый URL гейтвея (для ollama — http://localhost:11434)
 * model: имя модели (для ollama — например 'qwen3-coder:14b')
 * apiKey: ключ API (для openai-compatible гейтвеев, опционально)
 */
const AIConfig = {
    provider: 'mock',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    apiKey: '',
    timeout: 120000,
};

/**
 * Настраивает AI-провайдера. Вызывается из IDE при изменении настроек.
 * @param {Partial<typeof AIConfig>} cfg
 */
export function configureAI(cfg) {
    Object.assign(AIConfig, cfg);
}

export function getAIConfig() {
    return { ...AIConfig };
}

/**
 * Проверяет доступность гейтвея. Для ollama — GET /api/tags.
 * @returns {Promise<{ok: boolean, models?: string[], error?: string}>}
 */
export async function checkAIGateway() {
    if (AIConfig.provider === 'mock') {
        return { ok: true, models: ['mock-model'] };
    }
    if (AIConfig.provider === 'ollama') {
        try {
            const res = await fetch(`${AIConfig.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { ok: true, models: (data.models || []).map(m => m.name) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    if (AIConfig.provider === 'openai-compatible') {
        try {
            const res = await fetch(`${AIConfig.baseUrl}/models`, {
                headers: AIConfig.apiKey ? { 'Authorization': `Bearer ${AIConfig.apiKey}` } : {},
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { ok: true, models: (data.data || []).map(m => m.id) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: false, error: `Unknown provider: ${AIConfig.provider}` };
}

/**
 * Выполняет inference через настроенный гейтвей.
 * При ошибке сети — fallback на детерминированный мок.
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function aiInferRemote(model, prompt) {
    // Для ollama и openai-compatible модель берётся из конфигурации гейтвея (поле Model в UI),
    // а не из литерала в коде — пользователь настраивает свою модель.
    // Литерал в коде (например "gpt-4") игнорируется при реальном гейтвее.
    const effectiveModel = AIConfig.model || model;

    if (AIConfig.provider === 'ollama') {
        const res = await fetch(`${AIConfig.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: effectiveModel,
                prompt: String(prompt),
                stream: false,
                options: { temperature: 0.2 },
            }),
            signal: AbortSignal.timeout(AIConfig.timeout),
        });
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
        const data = await res.json();
        // Убираем think-блоки из ответов reasoning-моделей (qwen3 и т.п.)
        let text = data.response || '';
        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return text;
    }

    if (AIConfig.provider === 'openai-compatible') {
        const res = await fetch(`${AIConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(AIConfig.apiKey ? { 'Authorization': `Bearer ${AIConfig.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: effectiveModel,
                messages: [{ role: 'user', content: String(prompt) }],
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(AIConfig.timeout),
        });
        if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
    }

    // provider === 'mock' — обрабатывается вызывающей стороной
    throw new Error('mock provider');
}

// ============================================================
// Интерпретатор
// ============================================================

class ReturnSignal {
    constructor(value) { this.value = value; }
}

// Канал для коммуникации между горутинами (CSP-style)
class Channel {
    constructor(scheduler) {
        this.queue = [];
        this.scheduler = scheduler; // колбэк: прогнать другие горутины
    }
    send(value) {
        this.queue.push(value);
    }
    recv() {
        // Активное ожидание: пока канал пуст, уступаем другим горутинам
        let guard = 0;
        while (this.queue.length === 0) {
            if (!this.scheduler || !this.scheduler()) {
                throw new Error('Deadlock: recv on empty channel with no runnable goroutines');
            }
            if (++guard > 10_000_000) throw new Error('recv wait limit exceeded');
        }
        return this.queue.shift();
    }
}

class Environment {
    constructor(parent = null) {
        this.vars = new Map();
        this.parent = parent;
    }
    define(name, value) { this.vars.set(name, value); }
    get(name) {
        if (this.vars.has(name)) return this.vars.get(name);
        if (this.parent) return this.parent.get(name);
        throw new Error(`Undefined variable '${name}'`);
    }
    set(name, value) {
        if (this.vars.has(name)) { this.vars.set(name, value); return; }
        if (this.parent) { this.parent.set(name, value); return; }
        throw new Error(`Undefined variable '${name}'`);
    }
}

class Interpreter {
    constructor(program, output) {
        this.functions = program.functions;
        this.output = output; // колбэк для print
        this.globals = new Environment();
        this.aiEnabled = false;
        // Планировщик горутин: очередь готовых к выполнению задач
        this.taskQueue = [];
        this.spawnCount = 0;
        this.finishedCount = 0;
    }

    enableAI() { this.aiEnabled = true; }

    run() {
        if (!this.functions.main) {
            throw new Error("Function 'main' not found");
        }
        const result = this.callFunction('main', []);
        // Дожидаемся завершения всех оставшихся горутин
        this.runScheduler();
        return result;
    }

    // Выполняет одну задачу из очереди. Возвращает false, если очередь пуста.
    stepScheduler() {
        if (this.taskQueue.length === 0) return false;
        const task = this.taskQueue.shift();
        task.run();
        this.finishedCount++;
        return true;
    }

    // Кооперативный планировщик: выполняет задачи из очереди до опустошения.
    runScheduler() {
        let guard = 0;
        while (this.taskQueue.length > 0) {
            this.stepScheduler();
            if (++guard > 10_000_000) throw new Error('Scheduler iteration limit exceeded (possible deadlock)');
        }
    }

    callFunction(name, args) {
        // Встроенные функции
        if (name === 'print') {
            const text = args.map(a => this.formatValue(a)).join(' ');
            this.output(text);
            return null;
        }
        if (name === 'len') return args[0].length;
        if (name === 'push') { args[0].push(args[1]); return args[0]; }
        if (name === 'channel') return new Channel(() => this.stepScheduler());
        if (name === 'ai_infer') return this.aiInfer(args[0], args[1]);
        if (name === 'ai_embed') return this.aiEmbed(args[0]);

        const fn = this.functions[name];
        if (!fn) throw new Error(`Undefined function '${name}'`);

        const env = new Environment(this.globals);
        fn.params.forEach((param, i) => env.define(param, args[i]));

        try {
            this.executeBlock(fn.body, env);
        } catch (signal) {
            if (signal instanceof ReturnSignal) return signal.value;
            throw signal;
        }
        return null;
    }

    executeBlock(block, env) {
        for (const stmt of block.statements) {
            this.execute(stmt, env);
        }
    }

    execute(stmt, env) {
        switch (stmt.type) {
            case 'Let': {
                const value = this.evaluate(stmt.value, env);
                env.define(stmt.name, value);
                break;
            }
            case 'ExprStmt': {
                this.evaluate(stmt.expr, env);
                break;
            }
            case 'If': {
                if (this.isTruthy(this.evaluate(stmt.condition, env))) {
                    this.executeBlock(stmt.thenBranch, env);
                } else if (stmt.elseBranch) {
                    if (stmt.elseBranch.type === 'If') {
                        this.execute(stmt.elseBranch, env);
                    } else {
                        this.executeBlock(stmt.elseBranch, env);
                    }
                }
                break;
            }
            case 'While': {
                let guard = 0;
                while (this.isTruthy(this.evaluate(stmt.condition, env))) {
                    this.executeBlock(stmt.body, env);
                    if (++guard > 1_000_000) throw new Error('Loop iteration limit exceeded');
                }
                break;
            }
            case 'For': {
                this.execute(stmt.init, env);
                let guard = 0;
                while (this.isTruthy(this.evaluate(stmt.condition, env))) {
                    this.executeBlock(stmt.body, env);
                    if (stmt.update.type === 'Assign' || stmt.update.type === 'IndexAssign') {
                        this.execute(stmt.update, env);
                    } else {
                        this.evaluate(stmt.update, env);
                    }
                    if (++guard > 1_000_000) throw new Error('Loop iteration limit exceeded');
                }
                break;
            }
            case 'Assign': {
                const value = this.evaluate(stmt.value, env);
                env.set(stmt.name, value);
                break;
            }
            case 'IndexAssign': {
                const obj = this.evaluate(stmt.object.object, env);
                const index = this.evaluate(stmt.object.index, env);
                const value = this.evaluate(stmt.value, env);
                obj[index] = value;
                break;
            }
            case 'Return': {
                throw new ReturnSignal(this.evaluate(stmt.value, env));
            }
            case 'Print': {
                const values = stmt.args.map(a => this.evaluate(a, env));
                const text = values.map(v => this.formatValue(v)).join(' ');
                this.output(text);
                break;
            }
            case 'Spawn': {
                // Вычисляем аргументы в текущем окружении, затем ставим горутину в очередь
                const call = stmt.call;
                if (call.callee.type !== 'Ident') {
                    throw new Error('spawn supports only direct function calls');
                }
                const fnName = call.callee.name;
                const args = call.args.map(a => this.evaluate(a, env));
                this.spawnCount++;
                this.taskQueue.push({
                    run: () => this.callFunction(fnName, args),
                });
                break;
            }
            default:
                throw new Error(`Unknown statement type: ${stmt.type}`);
        }
    }

    evaluate(expr, env) {
        switch (expr.type) {
            case 'Number': return expr.value;
            case 'String': return expr.value;
            case 'Bool': return expr.value;
            case 'Null': return null;
            case 'Array': return expr.elements.map(e => this.evaluate(e, env));
            case 'Ident': return env.get(expr.name);

            case 'Unary': {
                const operand = this.evaluate(expr.operand, env);
                if (expr.op === '-') return -operand;
                if (expr.op === '!') return !this.isTruthy(operand);
                throw new Error(`Unknown unary operator: ${expr.op}`);
            }

            case 'Binary': {
                // Короткое замыкание для && и ||
                if (expr.op === '&&') {
                    const left = this.evaluate(expr.left, env);
                    if (!this.isTruthy(left)) return false;
                    return this.isTruthy(this.evaluate(expr.right, env));
                }
                if (expr.op === '||') {
                    const left = this.evaluate(expr.left, env);
                    if (this.isTruthy(left)) return true;
                    return this.isTruthy(this.evaluate(expr.right, env));
                }

                const left = this.evaluate(expr.left, env);
                const right = this.evaluate(expr.right, env);

                switch (expr.op) {
                    case '+':
                        if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
                        if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
                        return left + right;
                    case '-': return left - right;
                    case '*': return left * right;
                    case '/': return left / right;
                    case '%': return left % right;
                    case '==': return this.deepEqual(left, right);
                    case '!=': return !this.deepEqual(left, right);
                    case '<': return left < right;
                    case '<=': return left <= right;
                    case '>': return left > right;
                    case '>=': return left >= right;
                    default: throw new Error(`Unknown binary operator: ${expr.op}`);
                }
            }

            case 'Call': {
                // Вызов метода: obj.method(args)
                if (expr.callee.type === 'Member') {
                    const obj = this.evaluate(expr.callee.object, env);
                    const method = expr.callee.name;
                    const args = expr.args.map(a => this.evaluate(a, env));
                    return this.callMethod(obj, method, args);
                }
                // Прямой вызов функции по имени: f(args)
                if (expr.callee.type === 'Ident') {
                    const args = expr.args.map(a => this.evaluate(a, env));
                    return this.callFunction(expr.callee.name, args);
                }
                throw new Error('Not a function');
            }

            case 'Index': {
                const obj = this.evaluate(expr.object, env);
                const index = this.evaluate(expr.index, env);
                return obj[index];
            }

            case 'Member': {
                const obj = this.evaluate(expr.object, env);
                if (Array.isArray(obj)) {
                    if (expr.name === 'length') return obj.length;
                }
                if (typeof obj === 'string') {
                    if (expr.name === 'length') return obj.length;
                }
                return obj?.[expr.name];
            }

            default:
                throw new Error(`Unknown expression type: ${expr.type}`);
        }
    }

    callMethod(obj, method, args) {
        if (obj instanceof Channel) {
            if (method === 'send') { obj.send(args[0]); return null; }
            if (method === 'recv') return obj.recv();
        }
        if (Array.isArray(obj)) {
            if (method === 'push') { obj.push(args[0]); return obj; }
            if (method === 'pop') return obj.pop();
            if (method === 'length') return obj.length;
        }
        if (typeof obj === 'string') {
            if (method === 'length') return obj.length;
        }
        throw new Error(`Unknown method '${method}'`);
    }

    isTruthy(value) {
        if (value === null || value === undefined || value === false) return false;
        if (value === 0) return false;
        return true;
    }

    deepEqual(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((v, i) => this.deepEqual(v, b[i]));
        }
        return false;
    }

    formatValue(value) {
        if (value === null || value === undefined) return 'null';
        if (Array.isArray(value)) return '[' + value.map(v => this.formatValue(v)).join(', ') + ']';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return String(value);
    }

    // ============================================================
    // AI-функции (mock-реализация для демонстрации в IDE)
    // ============================================================

    aiInfer(model, prompt) {
        if (!this.aiEnabled) {
            throw new Error('AI is not enabled. Use "Compile & Run with AI" button.');
        }
        const text = String(prompt);
        // Если результат был предзагружен из реального гейтвея — возвращаем его
        if (this.aiCache && this.aiCache.has(text)) {
            return this.aiCache.get(text);
        }
        // Иначе — контекстно-зависимый mock
        return this.mockInfer(model, text);
    }

    // Контекстно-зависимый mock-инференс (fallback и offline-режим)
    mockInfer(model, text) {
        const numbers = text.match(/-?\d+(\.\d+)?/g);
        const insights = [];

        if (numbers && numbers.length > 0) {
            const nums = numbers.map(Number);
            const sum = nums.reduce((a, b) => a + b, 0);
            const mean = sum / nums.length;
            const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
            insights.push(`detected ${nums.length} numeric values (sum=${sum}, mean=${mean.toFixed(2)}, std=${Math.sqrt(variance).toFixed(2)})`);
        }
        if (/sort|order|partition/i.test(text)) {
            insights.push('sorting pattern recognized — comparison-based, lower bound O(n log n)');
        }
        if (/sum|total|reduce|aggregate/i.test(text)) {
            insights.push('reduction pattern — parallelizable via map-reduce');
        }
        if (/recursive|recursion/i.test(text)) {
            insights.push('recursion detected — verify base case reachability and stack depth');
        }
        if (/error|edge|empty|null/i.test(text)) {
            insights.push('consider explicit handling of empty input and boundary values');
        }

        if (insights.length === 0) {
            const hash = this.simpleHash(text);
            const generic = [
                'the code implements an efficient algorithm with good asymptotic behavior',
                'consider adding error handling for edge cases',
                'the structure is sound; profile before optimizing further',
                'the algorithm correctly partitions the input data',
            ];
            insights.push(generic[hash % generic.length]);
        }

        return `[${model}] ${insights.join('; ')}.`;
    }

    aiEmbed(text) {
        if (!this.aiEnabled) {
            throw new Error('AI is not enabled. Use "Compile & Run with AI" button.');
        }
        // Детерминированный mock-embedding (8 измерений для наглядности)
        const str = String(text);
        const embedding = [];
        for (let i = 0; i < 8; i++) {
            let h = 0;
            for (let j = 0; j < str.length; j++) {
                h = ((h << 5) - h + str.charCodeAt(j) * (i + 1)) | 0;
            }
            embedding.push(((h % 2000) - 1000) / 1000);
        }
        return embedding;
    }

    simpleHash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }
}

// ============================================================
// AI-анализ исходного кода (для вкладки AST / AI Insights)
// ============================================================

export function analyzeCode(source) {
    const tokens = tokenize(source);
    const stats = {
        functions: 0,
        loops: 0,
        conditionals: 0,
        arrays: 0,
        recursiveCalls: 0,
        aiCalls: 0,
        lines: source.split('\n').length,
        tokens: tokens.length,
    };

    const functionNames = new Set();
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === TokenType.Keyword && t.value === 'fn') {
            stats.functions++;
            if (tokens[i + 1]) functionNames.add(tokens[i + 1].value);
        }
        if (t.type === TokenType.Keyword && (t.value === 'for' || t.value === 'while')) stats.loops++;
        if (t.type === TokenType.Keyword && t.value === 'if') stats.conditionals++;
        if (t.type === TokenType.Punct && t.value === '[') stats.arrays++;
        if (t.type === TokenType.Keyword && t.value === 'ai') stats.aiCalls++;
    }

    // Определяем рекурсию: функция вызывает сама себя
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type === TokenType.Ident && functionNames.has(tokens[i].value)) {
            if (tokens[i + 1] && tokens[i + 1].value === '(') {
                // Проверяем, находимся ли мы внутри тела этой же функции (упрощённо)
                stats.recursiveCalls++;
            }
        }
    }

    // Оценка сложности
    let complexity = 'O(1)';
    if (stats.loops > 0) complexity = 'O(n)';
    if (stats.loops > 1) complexity = 'O(n²)';
    if (stats.recursiveCalls > 0 && stats.loops > 0) complexity = 'O(n log n)';
    else if (stats.recursiveCalls > 0) complexity = 'O(log n) — O(n)';

    return {
        ...stats,
        complexity,
        functionNames: [...functionNames],
    };
}

// ============================================================
// Публичный API (совместим с прежним интерфейсом)
// ============================================================

let compilerModule = null;

export async function loadCompiler() {
    if (compilerModule) return compilerModule;

    compilerModule = {
        compile: (source) => {
            // Возвращаем исходник как "байткод" — интерпретатор выполнит его напрямую
            return new TextEncoder().encode(source);
        },
        check_syntax: (source) => {
            // Реальная проверка синтаксиса через парсер
            const tokens = tokenize(source);
            const parser = new Parser(tokens);
            parser.parseProgram();
            return true;
        },
        version: () => '0.1.0-js-interp',
    };

    return compilerModule;
}

export async function compile(source) {
    const compiler = await loadCompiler();
    return compiler.compile(source);
}

export async function checkSyntax(source) {
    const compiler = await loadCompiler();
    return compiler.check_syntax(source);
}

export async function getVersion() {
    const compiler = await loadCompiler();
    return compiler.version();
}

/**
 * Рекурсивно собирает строковые литералы — аргументы prompt вызовов ai_infer.
 * @param {object} node — узел AST
 * @param {Set<string>} prompts — аккумулятор промптов
 */
function collectAIPrompts(node, prompts) {
    if (!node || typeof node !== 'object') return;

    // Вызов ai_infer(model, prompt) со строковым литералом prompt
    if (node.type === 'Call' &&
        node.callee && node.callee.type === 'Ident' &&
        node.callee.name === 'ai_infer' &&
        node.args && node.args.length >= 2 &&
        node.args[1].type === 'String') {
        prompts.add(node.args[1].value);
    }

    // Рекурсивный обход всех полей
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) collectAIPrompts(item, prompts);
        } else if (child && typeof child === 'object') {
            collectAIPrompts(child, prompts);
        }
    }
}

/**
 * Выполняет исходный код Latent и возвращает { result, output }.
 * Если включён AI и настроен реальный гейтвей (provider !== 'mock'),
 * предзагружает ответы ai_infer из гейтвея (pre-fetch), иначе — мок.
 * @param {string} source — исходный код
 * @param {boolean} withAI — включить AI-функции
 * @returns {{ result: any, output: string[] }}
 */
export async function runLatent(source, withAI = false) {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    const program = parser.parseProgram();

    const output = [];
    const interpreter = new Interpreter(program, (text) => output.push(text));
    if (withAI) interpreter.enableAI();

    // Pre-fetch: если настроен реальный гейтвей, загружаем ответы ai_infer заранее
    if (withAI && AIConfig.provider !== 'mock') {
        const prompts = new Set();
        for (const fn of Object.values(program.functions)) {
            collectAIPrompts(fn.body, prompts);
        }
        if (prompts.size > 0) {
            interpreter.aiCache = new Map();
            output.push(`[AI] Fetching ${prompts.size} inference(s) from ${AIConfig.provider} (${AIConfig.baseUrl})...`);
            for (const prompt of prompts) {
                try {
                    const response = await aiInferRemote(null, prompt);
                    interpreter.aiCache.set(prompt, response);
                } catch (e) {
                    output.push(`[AI] Gateway error: ${e.message} — falling back to mock`);
                    // Не кэшируем — aiInfer использует mock
                }
            }
        }
    }

    const result = interpreter.run();
    return { result, output };
}
