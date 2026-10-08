// compiler/interpreter-statements.js — исполнение инструкций AST движка №1.
// Единственная ответственность: execute(interp, stmt, env) и прогон тестов.

import { ReturnSignal } from './environment.js';
import { isTruthy, formatValue } from './value-utils.js';
import { evaluate } from './interpreter-expressions.js';
import { isInstance } from './oop.js';

/**
 * Исполняет инструкцию AST.
 * @param {import('./interpreter.js').Interpreter} interp
 * @param {object} stmt
 * @param {import('./environment.js').Environment} env
 */
export function execute(interp, stmt, env) {
    switch (stmt.type) {
        case 'Let': {
            const value = evaluate(interp, stmt.value, env);
            env.define(stmt.name, value);
            break;
        }
        case 'ExprStmt': {
            evaluate(interp, stmt.expr, env);
            break;
        }
        case 'If': {
            if (isTruthy(evaluate(interp, stmt.condition, env))) {
                executeBlock(interp, stmt.thenBranch, env);
            } else if (stmt.elseBranch) {
                if (stmt.elseBranch.type === 'If') {
                    execute(interp, stmt.elseBranch, env);
                } else {
                    executeBlock(interp, stmt.elseBranch, env);
                }
            }
            break;
        }
        case 'While': {
            let guard = 0;
            while (isTruthy(evaluate(interp, stmt.condition, env))) {
                executeBlock(interp, stmt.body, env);
                if (++guard > 1_000_000) throw new Error('Loop iteration limit exceeded');
            }
            break;
        }
        case 'For': {
            execute(interp, stmt.init, env);
            let guard = 0;
            while (isTruthy(evaluate(interp, stmt.condition, env))) {
                executeBlock(interp, stmt.body, env);
                if (stmt.update.type === 'Assign' || stmt.update.type === 'IndexAssign') {
                    execute(interp, stmt.update, env);
                } else {
                    evaluate(interp, stmt.update, env);
                }
                if (++guard > 1_000_000) throw new Error('Loop iteration limit exceeded');
            }
            break;
        }
        case 'ForEach': {
            const iterable = evaluate(interp, stmt.iterable, env);
            const items = toIterable(iterable);
            for (const item of items) {
                env.define(stmt.var, item);
                executeBlock(interp, stmt.body, env);
            }
            break;
        }
        case 'Assign': {
            const value = evaluate(interp, stmt.value, env);
            env.set(stmt.name, value);
            break;
        }
        case 'FieldAssign': {
            const obj = env.get(stmt.object);
            const value = evaluate(interp, stmt.value, env);
            if (!isInstance(obj)) throw new Error(`Cannot assign field on non-instance '${stmt.object}'`);
            obj.set(stmt.field, value);
            break;
        }
        case 'IndexAssign': {
            const obj = evaluate(interp, stmt.object.object, env);
            const index = evaluate(interp, stmt.object.index, env);
            const value = evaluate(interp, stmt.value, env);
            if (obj && obj.__semantic) { obj.vector[index] = value; break; }
            obj[index] = value;
            break;
        }
        case 'Return': {
            throw new ReturnSignal(evaluate(interp, stmt.value, env));
        }
        case 'Print': {
            const values = stmt.args.map(a => evaluate(interp, a, env));
            const text = values.map(v => formatValue(v)).join(' ');
            interp.output(text);
            break;
        }
        case 'Spawn': {
            const call = stmt.call;
            if (call.callee.type !== 'Ident') {
                throw new Error('spawn supports only direct function calls');
            }
            const fnName = call.callee.name;
            const args = call.args.map(a => evaluate(interp, a, env));
            interp.spawnTask(() => interp.callFunction(fnName, args));
            break;
        }
        case 'SpawnBlock': {
            // Анонимная горутина: захватываем окружение на момент spawn
            interp.spawnTask(() => executeBlock(interp, stmt.block, env));
            break;
        }
        case 'Yield': {
            // Уступаем планировщику одну задачу (кооперативная многозадачность)
            interp.stepScheduler();
            break;
        }
        case 'Select': {
            executeSelect(interp, stmt, env);
            break;
        }
        case 'Function': {
            // Вложенное объявление функции — регистрируем в таблице
            interp.functions[stmt.name] = stmt;
            break;
        }
        case 'Class': {
            interp.classes[stmt.name] = stmt;
            break;
        }
        case 'Assert': {
            const args = stmt.args.map(a => evaluate(interp, a, env));
            if (!isTruthy(args[0])) {
                throw new Error(`assertion failed${args[1] !== undefined ? ': ' + formatValue(args[1]) : ''}`);
            }
            break;
        }
        case 'AssertEq': {
            const args = stmt.args.map(a => evaluate(interp, a, env));
            if (!looseEqual(args[0], args[1])) {
                throw new Error(
                    `assert_eq failed: ${formatValue(args[0])} != ${formatValue(args[1])}` +
                    (args[2] !== undefined ? `: ${formatValue(args[2])}` : ''));
            }
            break;
        }
        case 'Test': {
            // Тесты вне контекста runTests просто игнорируются здесь
            break;
        }
        default:
            throw new Error(`Unknown statement type: ${stmt.type}`);
    }
}

/**
 * select: ждёт первый готовый канал. Пробует все каналы без блокировки,
 * затем уступает планировщику и повторяет; при наличии default —
 * выполняет его, если сразу ничего не готово.
 */
function executeSelect(interp, stmt, env) {
    const evaluated = stmt.arms.map(arm => ({
        varName: arm.varName,
        channel: evaluate(interp, arm.channel, env),
        body: arm.body,
    }));

    let guard = 0;
    while (true) {
        for (const arm of evaluated) {
            const value = arm.channel.tryRecv();
            if (value !== undefined) {
                if (arm.varName) env.define(arm.varName, value);
                executeBlock(interp, arm.body, env);
                return;
            }
        }
        if (stmt.defaultBody) {
            executeBlock(interp, stmt.defaultBody, env);
            return;
        }
        // Ничего не готово — уступаем другим горутинам
        if (!interp.stepScheduler()) {
            throw new Error('Deadlock: select with no ready channel and no runnable goroutines');
        }
        if (++guard > 10_000_000) throw new Error('select wait limit exceeded');
    }
}

/** Разворачивает значение в массив для for-in. */
function toIterable(v) {
    if (Array.isArray(v)) return v;
    if (v && v.__semantic) return v.vector;
    if (v && typeof v === 'object' && v.__tag) return [v.value];
    if (typeof v === 'string') return v.split('');
    if (v && isInstance(v)) return [...v.fields.values()];
    throw new Error(`Value is not iterable: ${formatValue(v)}`);
}

function looseEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => looseEqual(v, b[i]));
    }
    return false;
}

/**
 * Прогоняет тестовые блоки и возвращает список результатов.
 * Каждый тест исполняется; ошибка assert фиксируется как failed,
 * но не прерывает остальные тесты.
 * @returns {Array<{name:string,passed:boolean,error?:string}>}
 */
export function runTests(interp, tests) {
    const results = [];
    for (const t of tests) {
        const env = new (interp.globals.constructor)(interp.globals);
        try {
            executeBlock(interp, t.body, env);
            results.push({ name: t.name, passed: true });
        } catch (e) {
            results.push({ name: t.name, passed: false, error: e.message });
        }
    }
    return results;
}

/**
 * Исполняет блок инструкций.
 * @param {import('./interpreter.js').Interpreter} interp
 * @param {object} block
 * @param {import('./environment.js').Environment} env
 */
export function executeBlock(interp, block, env) {
    for (const stmt of block.statements) {
        execute(interp, stmt, env);
    }
}