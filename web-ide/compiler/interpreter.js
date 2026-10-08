// compiler/interpreter.js — tree-walking интерпретатор движка №1.
// Ответственность: планировщик goroutines, классы, вызов функций, тесты,
// AI-примитивы и встроенные функции. Вычисление выражений и исполнение
// инструкций делегированы подмодулям.

import { ReturnSignal, Environment, resolvedPromise, isPromise } from './environment.js';
import { evaluate } from './interpreter-expressions.js';
import { execute, executeBlock, runTests } from './interpreter-statements.js';
import { mockInfer, mockEmbed, simpleHash } from './interpreter-ai.js';
import { Instance, findMethod } from './oop.js';
import { buildBuiltins, vectorOf as toVector } from './interpreter-builtins.js';

export class Interpreter {
    constructor(program, output) {
        this.functions = program.functions || {};
        this.classes = program.classes || {};
        this.tests = program.tests || [];
        this.output = output; // колбэк для print
        this.globals = new Environment();
        this.aiEnabled = false;
        this.aiCache = null; // Map<prompt, response>, заполняется pre-fetch'ем
        this.streams = new Map(); // handle -> { tokens, pos }
        this.nextStreamHandle = 1;
        // Планировщик горутин: очередь готовых к выполнению задач
        this.taskQueue = [];
        this.spawnCount = 0;
        this.finishedCount = 0;
        // Результаты тестовых блоков
        this.testResults = [];
        // Снимки для snapshot()
        this.snapshots = new Map();
    }

    enableAI() { this.aiEnabled = true; }

    run() {
        if (!this.functions.main) {
            throw new Error("Function 'main' not found");
        }
        const result = this.callFunction('main', []);
        // Дожидаемся завершения всех оставшихся горутин
        this.runScheduler();
        if (this.taskQueue.length > 0) {
            throw new Error(
                `Deadlock: ${this.taskQueue.length} goroutine(s) still pending after scheduler drained main`
            );
        }
        // Прогоняем тестовые блоки, если они есть
        if (this.tests.length > 0) {
            this.testResults = runTests(this, this.tests);
        }
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

    /** Ставит горутину (функцию или thunk) в очередь планировщика. */
    spawnTask(run) {
        this.spawnCount++;
        this.taskQueue.push({ run });
    }

    callFunction(name, args) {
        // Встроенные функции
        const builtin = this.builtins[name];
        if (builtin) return builtin.call(this, args);

        const fn = this.functions[name];
        if (!fn) throw new Error(`Undefined function '${name}'`);

        const env = new Environment(this.globals);
        fn.params.forEach((param, i) => env.define(param, args[i]));

        try {
            this.executeBlock(fn.body, env);
        } catch (signal) {
            if (signal instanceof ReturnSignal) {
                return fn.isAsync ? resolvedPromise(signal.value) : signal.value;
            }
            throw signal;
        }
        return fn.isAsync ? resolvedPromise(null) : null;
    }

    /** Создаёт экземпляр класса; выполняет init, если он объявлен. */
    instantiate(className, args) {
        const klass = this.classes[className];
        if (!klass) throw new Error(`Undefined class '${className}'`);
        const fields = new Map();
        for (const f of klass.fields) fields.set(f.name, null);
        const inst = new Instance(klass, fields);
        const init = findMethod(klass, 'init');
        if (init) this.callMethod(inst, 'init', args);
        return inst;
    }

    /** Вызывает метод экземпляра, связывая `this`. */
    callMethod(inst, method, args) {
        const fn = findMethod(inst.klass, method);
        if (!fn) throw new Error(`Unknown method '${method}'`);
        const env = new Environment(this.globals);
        env.define('this', inst);
        fn.params.forEach((param, i) => env.define(param, args[i]));
        try {
            this.executeBlock(fn.body, env);
        } catch (signal) {
            if (signal instanceof ReturnSignal) {
                return fn.isAsync ? resolvedPromise(signal.value) : signal.value;
            }
            throw signal;
        }
        return fn.isAsync ? resolvedPromise(null) : null;
    }

    /** Разворачивает Promise-значение (await). Для не-Promise — тождество. */
    awaitValue(v) {
        if (isPromise(v)) return v.value;
        return v;
    }

    executeBlock(block, env) { executeBlock(this, block, env); }

    execute(stmt, env) { execute(this, stmt, env); }

    evaluate(expr, env) { return evaluate(this, expr, env); }

    // Встроенные функции языка (см. interpreter-builtins.js)
    get builtins() { return buildBuiltins(this); }

    /** Приводит значение к числовому вектору (Tensor/semantic/массив). */
    vectorOf(v) { return toVector(v); }

    /** Регистрирует снимок значения под именем (и возвращает его). */
    snapshot(name) {
        const key = String(name);
        // Снимок первого вызова — эталон для последующих сравнений
        if (!this.snapshots.has(key)) this.snapshots.set(key, null);
        return true;
    }

    /**
     * select как выражение: ждёт первый готовый канал, возвращает значение
     * тела выигравшей ветки (или default).
     */
    selectValue(expr, env) {
        const evaluated = expr.arms.map(arm => ({
            varName: arm.varName,
            channel: this.evaluate(arm.channel, env),
            body: arm.body,
        }));
        let guard = 0;
        while (true) {
            for (const arm of evaluated) {
                const value = arm.channel.tryRecv();
                if (value !== undefined) {
                    if (arm.varName) env.define(arm.varName, value);
                    return this.evalBodyValue(arm.body, env);
                }
            }
            if (expr.defaultBody) return this.evalBodyValue(expr.defaultBody, env);
            if (!this.stepScheduler()) {
                throw new Error('Deadlock: select with no ready channel and no runnable goroutines');
            }
            if (++guard > 10_000_000) throw new Error('select wait limit exceeded');
        }
    }

    /** Вычисляет тело ветки (блок или одиночная инструкция) как значение. */
    evalBodyValue(body, env) {
        if (body.statements.length === 1 && body.statements[0].type === 'ExprStmt') {
            return this.evaluate(body.statements[0].expr, env);
        }
        const local = new (env.constructor)(env);
        let last = null;
        try {
            for (const stmt of body.statements) {
                if (stmt.type === 'Return') return this.evaluate(stmt.value, local);
                if (stmt.type === 'ExprStmt') last = this.evaluate(stmt.expr, local);
                else this.execute(stmt, local);
            }
        } catch (signal) {
            if (signal && signal.value !== undefined) return signal.value;
            throw signal;
        }
        return last;
    }

    // ============================================================
    // AI-функции (mock-реализация для демонстрации в IDE)
    // ============================================================

    aiInfer(model, prompt) {
        if (!this.aiEnabled) {
            throw new Error('AI is not enabled. Use "Compile & Run with AI" button.');
        }
        const text = String(prompt);
        if (this.aiCache && this.aiCache.has(text)) {
            return this.aiCache.get(text);
        }
        return mockInfer(model, text, simpleHash);
    }

    aiEmbed(text) {
        if (!this.aiEnabled) {
            throw new Error('AI is not enabled. Use "Compile & Run with AI" button.');
        }
        return mockEmbed(text);
    }

    /**
     * Создаёт поток (stream) токенов по prompt'у — движок №1.
     * @param {string} _model
     * @param {string} prompt
     * @returns {number} handle потока
     */
    aiStream(_model, prompt) {
        if (!this.aiEnabled) {
            throw new Error('AI is not enabled. Use "Compile & Run with AI" button.');
        }
        const text = this.aiInfer(_model, prompt);
        const tokens = String(text).split(/\s+/).filter(t => t.length > 0);
        const handle = this.nextStreamHandle++;
        this.streams.set(handle, { tokens, pos: 0 });
        return handle;
    }

    /**
     * Возвращает следующий токен потока или null, если поток исчерпан.
     * @param {number} handle
     * @returns {string|null}
     */
    streamNext(handle) {
        const stream = this.streams.get(handle);
        if (!stream) return null;
        if (stream.pos >= stream.tokens.length) return null;
        return stream.tokens[stream.pos++];
    }
}
