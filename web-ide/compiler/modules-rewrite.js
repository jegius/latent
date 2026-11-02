// compiler/modules-rewrite.js — переписывание AST при линковке модулей.
// Единственная ответственность: подменить ссылки на импортированные символы
// и top-level объявления их мангленными именами (`m0$square`), не задевая
// локальные переменные/параметры/поля.
//
// Функции модуля мутируют переданный AST (линковщик передаёт клон из кэша).

const DECLARATIONS = new Set(['Function', 'Class', 'Enum']);

/** Подменяет имя, если оно не перекрыто локальной областью видимости. */
export function resolveName(name, bindings, shadow) {
    if (shadow.has(name)) return name;
    return bindings.get(name) ?? name;
}

/** Переименовывает top-level объявления (fn/class/enum и варианты enum). */
export function renameTopDeclaration(node, info) {
    if (!node) return;
    if (node.type === 'Decorator') { renameTopDeclaration(node.target, info); return; }
    if (!DECLARATIONS.has(node.type)) return;
    const decl = info.decls.get(node.name);
    if (decl) node.name = decl.mangled;
    if (node.type === 'Enum') {
        for (const variant of node.variants || []) {
            const v = info.variants.get(variant.name);
            if (v) variant.name = v.mangled;
        }
    }
}

/** Добавляет в область видимости имена, связываемые паттерном match. */
function addPatternBinds(pattern, shadow) {
    if (!pattern) return;
    if (pattern.kind === 'Identifier') shadow.add(pattern.name);
    if (pattern.kind === 'Constructor') {
        for (const arg of pattern.args || []) addPatternBinds(arg, shadow);
    }
}

/** Переписывает имена конструкторов в паттерне (имена связок не трогаем). */
function rewritePattern(pattern, bindings, shadow) {
    if (!pattern) return;
    if (pattern.kind === 'Constructor') {
        pattern.name = resolveName(pattern.name, bindings, shadow);
        for (const arg of pattern.args || []) rewritePattern(arg, bindings, shadow);
    }
}

function rewriteFunction(fn, bindings, shadow, isTop) {
    const local = new Set(shadow);
    if (!isTop) local.add(fn.name);
    for (const param of fn.params || []) local.add(param);
    fn.body = rewriteBlock(fn.body, bindings, local);
}

function rewriteClass(cls, bindings, shadow, isTop) {
    const local = new Set(shadow);
    if (!isTop) local.add(cls.name);
    for (const method of cls.methods || []) rewriteFunction(method, bindings, local, false);
}

/** Переписывает блок инструкций; Let/вложенные объявления расширяют область. */
export function rewriteBlock(block, bindings, shadow = new Set()) {
    if (!block) return block;
    const local = new Set(shadow);
    for (const stmt of block.statements || []) rewriteStmt(stmt, bindings, local);
    return block;
}

/** Переписывает одну инструкцию (мутирует её). */
export function rewriteStmt(stmt, bindings, shadow = new Set()) {
    if (!stmt) return;
    switch (stmt.type) {
        case 'Let':
            rewriteExpr(stmt.value, bindings, shadow);
            shadow.add(stmt.name);
            break;
        case 'ExprStmt':
            rewriteExpr(stmt.expr, bindings, shadow);
            break;
        case 'If':
            rewriteExpr(stmt.condition, bindings, shadow);
            rewriteBlock(stmt.thenBranch, bindings, shadow);
            if (stmt.elseBranch) {
                if (stmt.elseBranch.type === 'If') rewriteStmt(stmt.elseBranch, bindings, shadow);
                else rewriteBlock(stmt.elseBranch, bindings, shadow);
            }
            break;
        case 'While':
            rewriteExpr(stmt.condition, bindings, shadow);
            rewriteBlock(stmt.body, bindings, shadow);
            break;
        case 'For':
            rewriteStmt(stmt.init, bindings, shadow);
            rewriteExpr(stmt.condition, bindings, shadow);
            if (stmt.update && (stmt.update.type === 'Assign' || stmt.update.type === 'IndexAssign')) {
                rewriteStmt(stmt.update, bindings, shadow);
            } else {
                rewriteExpr(stmt.update, bindings, shadow);
            }
            rewriteBlock(stmt.body, bindings, shadow);
            break;
        case 'ForEach': {
            rewriteExpr(stmt.iterable, bindings, shadow);
            const local = new Set(shadow);
            local.add(stmt.var);
            rewriteBlock(stmt.body, bindings, local);
            break;
        }
        case 'Assign':
            rewriteExpr(stmt.value, bindings, shadow);
            stmt.name = resolveName(stmt.name, bindings, shadow);
            break;
        case 'FieldAssign':
            stmt.object = resolveName(stmt.object, bindings, shadow);
            rewriteExpr(stmt.value, bindings, shadow);
            break;
        case 'IndexAssign':
            rewriteExpr(stmt.object, bindings, shadow);
            rewriteExpr(stmt.value, bindings, shadow);
            break;
        case 'Return':
            rewriteExpr(stmt.value, bindings, shadow);
            break;
        case 'Print':
            for (const arg of stmt.args || []) rewriteExpr(arg, bindings, shadow);
            break;
        case 'Spawn':
            rewriteExpr(stmt.call, bindings, shadow);
            break;
        case 'SpawnBlock':
            rewriteBlock(stmt.block, bindings, shadow);
            break;
        case 'Select': {
            for (const arm of stmt.arms || []) {
                rewriteExpr(arm.channel, bindings, shadow);
                const local = new Set(shadow);
                if (arm.varName) local.add(arm.varName);
                rewriteBlock(arm.body, bindings, local);
            }
            if (stmt.defaultBody) rewriteBlock(stmt.defaultBody, bindings, shadow);
            break;
        }
        case 'Function':
            rewriteFunction(stmt, bindings, shadow, false);
            shadow.add(stmt.name);
            break;
        case 'Class':
            rewriteClass(stmt, bindings, shadow, false);
            shadow.add(stmt.name);
            break;
        case 'Enum':
            for (const variant of stmt.variants || []) shadow.add(variant.name);
            shadow.add(stmt.name);
            break;
        case 'Assert':
        case 'AssertEq':
            for (const arg of stmt.args || []) rewriteExpr(arg, bindings, shadow);
            break;
        case 'Test':
            stmt.body = rewriteBlock(stmt.body, bindings, shadow);
            break;
        case 'Decorator':
            rewriteStmt(stmt.target, bindings, shadow);
            break;
        default:
            break;
    }
}

/** Переписывает выражение (мутирует его). */
export function rewriteExpr(expr, bindings, shadow = new Set()) {
    if (!expr || typeof expr !== 'object') return;
    switch (expr.type) {
        case 'Ident':
            expr.name = resolveName(expr.name, bindings, shadow);
            break;
        case 'Unary':
            rewriteExpr(expr.operand, bindings, shadow);
            break;
        case 'Binary':
            rewriteExpr(expr.left, bindings, shadow);
            rewriteExpr(expr.right, bindings, shadow);
            break;
        case 'Call':
            rewriteExpr(expr.callee, bindings, shadow);
            for (const arg of expr.args || []) rewriteExpr(arg, bindings, shadow);
            break;
        case 'New':
            expr.className = resolveName(expr.className, bindings, shadow);
            for (const arg of expr.args || []) rewriteExpr(arg, bindings, shadow);
            break;
        case 'Index':
            rewriteExpr(expr.object, bindings, shadow);
            rewriteExpr(expr.index, bindings, shadow);
            break;
        case 'Member':
            rewriteExpr(expr.object, bindings, shadow);
            break;
        case 'Await':
            rewriteExpr(expr.expr, bindings, shadow);
            break;
        case 'Send':
            rewriteExpr(expr.channel, bindings, shadow);
            rewriteExpr(expr.value, bindings, shadow);
            break;
        case 'Lambda': {
            const local = new Set(shadow);
            for (const param of expr.params || []) local.add(param);
            if (expr.isBlock) rewriteBlock(expr.body, bindings, local);
            else rewriteExpr(expr.body, bindings, local);
            break;
        }
        case 'SelectExpr':
            for (const arm of expr.arms || []) {
                rewriteExpr(arm.channel, bindings, shadow);
                const local = new Set(shadow);
                if (arm.varName) local.add(arm.varName);
                rewriteBlock(arm.body, bindings, local);
            }
            if (expr.defaultBody) rewriteBlock(expr.defaultBody, bindings, shadow);
            break;
        case 'Match':
            rewriteExpr(expr.scrutinee, bindings, shadow);
            for (const arm of expr.arms || []) {
                const local = new Set(shadow);
                addPatternBinds(arm.pattern, local);
                rewritePattern(arm.pattern, bindings, shadow);
                rewriteExpr(arm.body, bindings, local);
            }
            break;
        case 'BlockExpr':
            rewriteBlock(expr.block, bindings, shadow);
            break;
        case 'Array':
            for (const el of expr.elements || []) rewriteExpr(el, bindings, shadow);
            break;
        default:
            break;
    }
}
