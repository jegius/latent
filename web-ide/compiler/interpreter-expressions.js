// compiler/interpreter-expressions.js — вычисление выражений AST движка №1.
// Единственная ответственность: evaluate(interp, expr, env).

import { isTruthy, deepEqual, callMethod, formatValue } from './value-utils.js';
import { isInstance } from './oop.js';
import { ReturnSignal } from './environment.js';

/**
 * Вычисляет выражение AST.
 * @param {import('./interpreter.js').Interpreter} interp
 * @param {object} expr
 * @param {import('./environment.js').Environment} env
 * @returns {any}
 */
export function evaluate(interp, expr, env) {
    switch (expr.type) {
        case 'Number': return expr.value;
        case 'String': return expr.value;
        case 'Bool': return expr.value;
        case 'Null': return null;
        case 'Array': return expr.elements.map(e => evaluate(interp, e, env));
        case 'Ident': return env.get(expr.name);
        case 'This': return env.get('this');

        case 'Unary': {
            const operand = evaluate(interp, expr.operand, env);
            if (expr.op === '-') return -operand;
            if (expr.op === '!') return !isTruthy(operand);
            throw new Error(`Unknown unary operator: ${expr.op}`);
        }

        case 'Binary': {
            // Короткое замыкание для && и ||
            if (expr.op === '&&') {
                const left = evaluate(interp, expr.left, env);
                if (!isTruthy(left)) return false;
                return isTruthy(evaluate(interp, expr.right, env));
            }
            if (expr.op === '||') {
                const left = evaluate(interp, expr.left, env);
                if (isTruthy(left)) return true;
                return isTruthy(evaluate(interp, expr.right, env));
            }

            const left = evaluate(interp, expr.left, env);
            const right = evaluate(interp, expr.right, env);

            switch (expr.op) {
                case '+':
                    if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
                    if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
                    return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/': return left / right;
                case '%': return left % right;
                case '==': return deepEqual(left, right);
                case '!=': return !deepEqual(left, right);
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
                const obj = evaluate(interp, expr.callee.object, env);
                const method = expr.callee.name;
                const args = expr.args.map(a => evaluate(interp, a, env));
                // Экземпляр класса → ищем метод в классе (связывая this)
                if (isInstance(obj)) return interp.callMethod(obj, method, args);
                return callMethod(obj, method, args);
            }
            // Прямой вызов функции по имени: f(args)
            if (expr.callee.type === 'Ident') {
                const args = expr.args.map(a => evaluate(interp, a, env));
                // Если имя — переменная, хранящая лямбду/функцию, вызываем её
                if (env.has(expr.callee.name)) {
                    const fnVal = env.get(expr.callee.name);
                    if (typeof fnVal === 'function') return fnVal(...args);
                }
                return interp.callFunction(expr.callee.name, args);
            }
            // Вызов результата выражения (например, лямбды)
            const callee = evaluate(interp, expr.callee, env);
            if (typeof callee === 'function') {
                return callee(...expr.args.map(a => evaluate(interp, a, env)));
            }
            throw new Error('Not a function');
        }

        case 'New': {
            const args = expr.args.map(a => evaluate(interp, a, env));
            return interp.instantiate(expr.className, args);
        }

        case 'Index': {
            const obj = evaluate(interp, expr.object, env);
            const index = evaluate(interp, expr.index, env);
            if (obj && obj.__semantic) return obj.vector[index];
            return obj[index];
        }

        case 'Member': {
            const obj = evaluate(interp, expr.object, env);
            if (isInstance(obj)) return obj.get(expr.name);
            if (Array.isArray(obj)) {
                if (expr.name === 'length' || expr.name === 'len') return obj.length;
            }
            if (typeof obj === 'string') {
                if (expr.name === 'length' || expr.name === 'len') return obj.length;
            }
            if (obj && obj.__tag && expr.name === 'value') return obj.value;
            return obj?.[expr.name];
        }

        case 'Await': {
            const v = evaluate(interp, expr.expr, env);
            return interp.awaitValue(v);
        }

        case 'Send': {
            const ch = evaluate(interp, expr.channel, env);
            const value = evaluate(interp, expr.value, env);
            if (!ch || typeof ch.send !== 'function') {
                throw new Error('send target is not a channel');
            }
            ch.send(value);
            return null;
        }

        case 'Lambda': {
            return makeClosure(interp, expr, env);
        }

        case 'SelectExpr': {
            return interp.selectValue(expr, env);
        }

        case 'Match': {
            return evaluateMatch(interp, expr, env);
        }

        case 'BlockExpr': {
            // Блок как выражение: исполняем, значение — последний return
            return evaluateBlockExpr(interp, expr.block, env);
        }

        default:
            throw new Error(`Unknown expression type: ${expr.type}`);
    }
}

/**
 * Сопоставляет значение с паттернами match и вычисляет тело совпавшей ветки.
 */
function evaluateMatch(interp, expr, env) {
    const scrutinee = evaluate(interp, expr.scrutinee, env);

    for (const arm of expr.arms) {
        const binds = new (env.constructor)(env);
        if (matchPattern(arm.pattern, scrutinee, binds)) {
            return evaluate(interp, arm.body, binds);
        }
    }
    throw new Error(`match: no arm matched value ${formatValue(scrutinee)}`);
}

/** true, если паттерн соответствует значению; попутно связывает переменные. */
function matchPattern(pattern, value, binds) {
    switch (pattern.kind) {
        case 'Wildcard':
            return true;
        case 'Literal':
            return deepEqual(pattern.value, value);
        case 'Identifier':
            // Связка: всегда совпадает, имя связывается со значением
            binds.define(pattern.name, value);
            return true;
        case 'Constructor': {
            if (!(value && value.__tag === pattern.name)) return false;
            if (pattern.args.length === 1) {
                return matchPattern(pattern.args[0], value.value, binds);
            }
            return true;
        }
        default:
            return false;
    }
}

/** Вычисляет блок как выражение, перехватывая return. */
function evaluateBlockExpr(interp, block, env) {
    const local = new (env.constructor)(env);
    try {
        for (const stmt of block.statements) {
            interp.execute(stmt, local);
        }
    } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value;
        throw signal;
    }
    return null;
}

/**
 * Создаёт замыкание из лямбды. Возвращает JS-функцию, захватившую окружение.
 * @returns {function(...any): any}
 */
function makeClosure(interp, expr, env) {
    const closure = (...args) => {
        const local = new (env.constructor)(env);
        expr.params.forEach((p, i) => local.define(p, args[i]));
        if (expr.isBlock) {
            try {
                for (const stmt of expr.body.statements) interp.execute(stmt, local);
            } catch (signal) {
                if (signal instanceof ReturnSignal) return signal.value;
                throw signal;
            }
            return null;
        }
        return evaluate(interp, expr.body, local);
    };
    return closure;
}