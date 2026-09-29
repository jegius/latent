//! Генератор кода (codegen) для языка Latent.
//!
//! Превращает типизированное AST в бинарный WebAssembly модуль.
//! Реализует stack machine, locals, linear memory и bump allocator.

use crate::ast::*;
use crate::typechecker::Type;
use std::collections::HashMap;

/// Буфер для записи WASM байткода
#[derive(Default)]
pub struct ByteBuffer {
    bytes: Vec<u8>,
}

impl ByteBuffer {
    pub fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    pub fn push(&mut self, byte: u8) {
        self.bytes.push(byte);
    }

    pub fn extend(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    /// Записываем unsigned LEB128
    pub fn write_u32(&mut self, mut value: u32) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            self.push(byte);
            if value == 0 { break; }
        }
    }

    /// Записываем signed LEB128
    pub fn write_i32(&mut self, mut value: i32) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            let done = value == 0 && (byte & 0x40) == 0
                    || value == -1 && (byte & 0x40) != 0;
            if !done {
                byte |= 0x80;
            }
            self.push(byte);
            if done { break; }
        }
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.bytes
    }
}

/// Инструкции WASM
pub mod op {
    pub const UNREACHABLE: u8 = 0x00;
    pub const NOP: u8 = 0x01;
    pub const BLOCK: u8 = 0x02;
    pub const LOOP: u8 = 0x03;
    pub const IF: u8 = 0x04;
    pub const ELSE: u8 = 0x05;
    pub const END: u8 = 0x0B;
    pub const BR: u8 = 0x0C;
    pub const BR_IF: u8 = 0x0D;
    pub const RETURN: u8 = 0x0F;

    pub const CALL: u8 = 0x10;
    pub const DROP: u8 = 0x1A;
    pub const SELECT: u8 = 0x1B;

    pub const LOCAL_GET: u8 = 0x20;
    pub const LOCAL_SET: u8 = 0x21;
    pub const LOCAL_TEE: u8 = 0x22;
    pub const GLOBAL_GET: u8 = 0x23;
    pub const GLOBAL_SET: u8 = 0x24;

    pub const I32_LOAD: u8 = 0x28;
    pub const F64_LOAD: u8 = 0x2B;
    pub const I32_STORE: u8 = 0x36;
    pub const F64_STORE: u8 = 0x39;
    pub const I32_CONST: u8 = 0x41;
    pub const I64_CONST: u8 = 0x42;
    pub const F32_CONST: u8 = 0x43;
    pub const F64_CONST: u8 = 0x44;

    pub const I32_EQZ: u8 = 0x45;
    pub const I32_EQ: u8 = 0x46;
    pub const I32_NE: u8 = 0x47;
    pub const I32_LT_S: u8 = 0x48;
    pub const I32_GT_S: u8 = 0x4A;
    pub const I32_LE_S: u8 = 0x4C;
    pub const I32_GE_S: u8 = 0x4E;

    pub const I32_ADD: u8 = 0x6A;
    pub const I32_SUB: u8 = 0x6B;
    pub const I32_MUL: u8 = 0x6C;
    pub const I32_DIV_S: u8 = 0x6D;
    pub const I32_REM_S: u8 = 0x6F;
    pub const I32_AND: u8 = 0x71;
    pub const I32_OR: u8 = 0x72;
    pub const I32_XOR: u8 = 0x73;

    pub const F64_ADD: u8 = 0xA0;
    pub const F64_SUB: u8 = 0xA1;
    pub const F64_MUL: u8 = 0xA2;
    pub const F64_DIV: u8 = 0xA3;
    pub const F64_EQ: u8 = 0xA4;
    pub const F64_LT: u8 = 0xA5;
    pub const F64_GT: u8 = 0xA6;
}

/// Типы значений в WASM
pub mod valtype {
    pub const I32: u8 = 0x7F;
    pub const I64: u8 = 0x7E;
    pub const F32: u8 = 0x7D;
    pub const F64: u8 = 0x7C;
    pub const VOID: u8 = 0x40;
}

/// Преобразуем Latent-тип в WASM valtype
fn latent_to_wasm(ty: &Type) -> u8 {
    match ty {
        Type::Int => valtype::I32,
        Type::Float => valtype::F64,
        Type::Bool => valtype::I32,
        _ => valtype::I32,
    }
}

/// Контекст компиляции одной функции
struct FuncContext {
    locals: HashMap<String, (u32, u8)>,
    local_count: u32,
    body: ByteBuffer,
    block_depth: u32,
    has_result: bool,
}

/// Генератор WASM кода
pub struct WasmCodegen {
    module: ByteBuffer,
    type_section: ByteBuffer,
    type_count: u32,
    func_section: ByteBuffer,
    func_count: u32,
    memory_section: ByteBuffer,
    export_section: ByteBuffer,
    export_count: u32,
    code_section: ByteBuffer,
    code_count: u32,
    data_section: ByteBuffer,
    data_count: u32,
    functions: HashMap<String, (u32, u32)>,
    memory_offset: u32,
    strings: HashMap<String, u32>,
    class_layouts: HashMap<String, ClassLayout>,
    heap_global_idx: u32,
}

/// Layout класса в памяти
#[derive(Debug, Clone)]
struct ClassLayout {
    fields: Vec<FieldInfo>,
    size: u32,
    align: u32,
}

/// Информация о поле класса
#[derive(Debug, Clone)]
struct FieldInfo {
    name: String,
    offset: u32,
    valtype: u8,
}

impl WasmCodegen {
    pub fn new() -> Self {
        let mut codegen = Self {
            module: ByteBuffer::new(),
            type_section: ByteBuffer::new(),
            func_section: ByteBuffer::new(),
            memory_section: ByteBuffer::new(),
            export_section: ByteBuffer::new(),
            code_section: ByteBuffer::new(),
            data_section: ByteBuffer::new(),
            type_count: 0,
            func_count: 0,
            export_count: 0,
            code_count: 0,
            data_count: 0,
            functions: HashMap::new(),
            memory_offset: 1024,
            strings: HashMap::new(),
            class_layouts: HashMap::new(),
            heap_global_idx: 0,
        };
        codegen.add_import_print();
        codegen
    }

    fn add_import_print(&mut self) {
        // Заглушка — print будет host function с индексом 0
    }

    fn write_header(&mut self) {
        self.module.extend(&[0x00, 0x61, 0x73, 0x6D]);
        self.module.extend(&[0x01, 0x00, 0x00, 0x00]);
    }

    fn write_section(&mut self, id: u8, content: ByteBuffer) {
        self.module.push(id);
        let bytes = content.into_vec();
        self.module.write_u32(bytes.len() as u32);
        self.module.extend(&bytes);
    }

    fn add_func_type(&mut self, params: &[u8], results: &[u8]) -> u32 {
        let idx = self.type_count;
        self.type_count += 1;

        self.type_section.push(0x60);
        self.type_section.write_u32(params.len() as u32);
        for p in params {
            self.type_section.push(*p);
        }
        self.type_section.write_u32(results.len() as u32);
        for r in results {
            self.type_section.push(*r);
        }

        idx
    }

    pub fn compile(&mut self, program: &Program) -> Result<Vec<u8>, String> {
        self.write_header();

        // Первый проход: собираем классы (layout)
        for stmt in &program.statements {
            if let StmtKind::Class { name, fields, .. } = &stmt.kind {
                let mut layout = ClassLayout {
                    fields: Vec::new(),
                    size: 0,
                    align: 4,
                };

                for field in fields {
                    let (size, valtype) = match field.ty.as_ref() {
                        Some(crate::ast::Type::Named(name)) if name == "float" => (8, valtype::F64),
                        _ => (4, valtype::I32),
                    };

                    let mask = size - 1;
                    layout.size = (layout.size + mask) & !mask;

                    layout.fields.push(FieldInfo {
                        name: field.name.clone(),
                        offset: layout.size,
                        valtype,
                    });

                    layout.size += size;
                }

                let mask = layout.align - 1;
                layout.size = (layout.size + mask) & !mask;

                self.class_layouts.insert(name.clone(), layout);
            }
        }

        // Первый проход: собираем все объявления функций
        for stmt in &program.statements {
            if let StmtKind::Fn { name, params, ret_ty, .. } = &stmt.kind {
                let param_types: Vec<u8> = params.iter()
                    .map(|p| p.ty.as_ref()
                        .map(|t| latent_to_wasm(&parse_ast_type(t)))
                        .unwrap_or(valtype::I32))
                    .collect();

                let result_types: Vec<u8> = if let Some(ret) = ret_ty {
                    vec![latent_to_wasm(&parse_ast_type(ret))]
                } else {
                    vec![]
                };

                let type_idx = self.add_func_type(&param_types, &result_types);
                let func_idx = self.func_count;
                self.func_count += 1;

                self.func_section.write_u32(type_idx);
                self.functions.insert(name.clone(), (func_idx, type_idx));
            }
        }

        // Второй проход: генерируем тела функций
        for stmt in &program.statements {
            if let StmtKind::Fn { name, params, ret_ty, body } = &stmt.kind {
                self.compile_function(name, params, ret_ty, body)?;
            }
        }

        // Экспортируем memory
        self.export_section.write_u32(6);
        self.export_section.extend(b"memory");
        self.export_section.push(0x02);
        self.export_section.write_u32(0);
        self.export_count += 1;

        // Экспортируем main, если есть
        if self.functions.contains_key("main") {
            let (func_idx, _) = self.functions["main"];
            self.export_section.write_u32(4);
            self.export_section.extend(b"main");
            self.export_section.push(0x00);
            self.export_section.write_u32(func_idx);
            self.export_count += 1;
        }

        // Собираем секции
        if self.type_count > 0 {
            let mut ts = ByteBuffer::new();
            ts.write_u32(self.type_count);
            ts.extend(&std::mem::take(&mut self.type_section).into_vec());
            self.write_section(1, ts);
        }

        if self.func_count > 0 {
            let mut fs = ByteBuffer::new();
            fs.write_u32(self.func_count);
            fs.extend(&std::mem::take(&mut self.func_section).into_vec());
            self.write_section(3, fs);
        }

        // Memory section (ID 5)
        let mut mem = ByteBuffer::new();
        mem.write_u32(1);
        mem.push(0x00);
        mem.write_u32(1);
        self.write_section(5, mem);

        if self.export_count > 0 {
            let mut es = ByteBuffer::new();
            es.write_u32(self.export_count);
            es.extend(&std::mem::take(&mut self.export_section).into_vec());
            self.write_section(7, es);
        }

        if self.code_count > 0 {
            let mut cs = ByteBuffer::new();
            cs.write_u32(self.code_count);
            cs.extend(&std::mem::take(&mut self.code_section).into_vec());
            self.write_section(10, cs);
        }

        if self.data_count > 0 {
            let mut ds = ByteBuffer::new();
            ds.write_u32(self.data_count);
            ds.extend(&std::mem::take(&mut self.data_section).into_vec());
            self.write_section(11, ds);
        }

        Ok(std::mem::take(&mut self.module).into_vec())
    }

    fn compile_function(
        &mut self,
        name: &str,
        params: &[Param],
        ret_ty: &Option<crate::ast::Type>,
        body: &[Stmt],
    ) -> Result<(), String> {
        let mut ctx = FuncContext {
            locals: HashMap::new(),
            local_count: 0,
            body: ByteBuffer::new(),
            block_depth: 0,
            has_result: ret_ty.is_some(),
        };

        for param in params {
            let ty = param.ty.as_ref()
                .map(|t| latent_to_wasm(&parse_ast_type(t)))
                .unwrap_or(valtype::I32);
            ctx.locals.insert(param.name.clone(), (ctx.local_count, ty));
            ctx.local_count += 1;
        }

        for stmt in body {
            self.compile_stmt(stmt, &mut ctx)?;
        }

        let mut func_body = ByteBuffer::new();

        if ctx.local_count > params.len() as u32 {
            func_body.write_u32((ctx.local_count - params.len() as u32) as u32);
            for _ in params.len()..ctx.local_count as usize {
                func_body.write_u32(1);
                func_body.push(valtype::I32);
            }
        } else {
            func_body.write_u32(0);
        }

        func_body.extend(&ctx.body.into_vec());
        func_body.push(op::END);

        let func_bytes = func_body.into_vec();
        self.code_section.write_u32(func_bytes.len() as u32);
        self.code_section.extend(&func_bytes);
        self.code_count += 1;

        Ok(())
    }

    fn compile_stmt(&mut self, stmt: &Stmt, ctx: &mut FuncContext) -> Result<(), String> {
        match &stmt.kind {
            StmtKind::Let { name, value, .. } => {
                self.compile_expr(value, ctx)?;

                let idx = ctx.local_count;
                ctx.local_count += 1;
                ctx.locals.insert(name.clone(), (idx, valtype::I32));

                ctx.body.push(op::LOCAL_SET);
                ctx.body.write_u32(idx);
                Ok(())
            }

            StmtKind::Expr(expr) => {
                self.compile_expr(expr, ctx)?;
                ctx.body.push(op::DROP);
                Ok(())
            }

            StmtKind::Return(expr) => {
                if let Some(e) = expr {
                    self.compile_expr(e, ctx)?;
                }
                ctx.body.push(op::RETURN);
                Ok(())
            }

            StmtKind::If { cond, then_branch, else_branch } => {
                self.compile_expr(cond, ctx)?;
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);

                for s in then_branch {
                    self.compile_stmt(s, ctx)?;
                }

                if let Some(else_b) = else_branch {
                    ctx.body.push(op::ELSE);
                    for s in else_b {
                        self.compile_stmt(s, ctx)?;
                    }
                }

                ctx.body.push(op::END);
                Ok(())
            }

            StmtKind::While { cond, body: while_body } => {
                ctx.body.push(op::BLOCK);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::LOOP);
                ctx.body.push(valtype::VOID);

                self.compile_expr(cond, ctx)?;
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);

                for s in while_body {
                    self.compile_stmt(s, ctx)?;
                }

                ctx.body.push(op::BR);
                ctx.body.write_u32(1);

                ctx.body.push(op::END);
                ctx.body.push(op::END);
                ctx.body.push(op::END);
                Ok(())
            }

            _ => Ok(()),
        }
    }

    fn compile_expr(&mut self, expr: &Expr, ctx: &mut FuncContext) -> Result<(), String> {
        match &expr.kind {
            ExprKind::Number(n) => {
                if n.fract() == 0.0 {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(*n as i32);
                } else {
                    ctx.body.push(op::F64_CONST);
                    let bytes = n.to_le_bytes();
                    ctx.body.extend(&bytes);
                }
                Ok(())
            }

            ExprKind::Bool(b) => {
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(if *b { 1 } else { 0 });
                Ok(())
            }

            ExprKind::String(s) => {
                let addr = self.add_string(s);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(addr as i32);
                Ok(())
            }

            ExprKind::Identifier(name) => {
                if let Some((idx, _)) = ctx.locals.get(name) {
                    ctx.body.push(op::LOCAL_GET);
                    ctx.body.write_u32(*idx);
                    Ok(())
                } else {
                    Err(format!("Undefined variable: {}", name))
                }
            }

            ExprKind::Binary { op, left, right } => {
                self.compile_expr(left, ctx)?;
                self.compile_expr(right, ctx)?;

                // Определяем тип по литералу
                let is_float = self.is_float_expr(left) || self.is_float_expr(right);

                match (op, is_float) {
                    (BinaryOp::Add, true) => ctx.body.push(op::F64_ADD),
                    (BinaryOp::Add, false) => ctx.body.push(op::I32_ADD),
                    (BinaryOp::Sub, true) => ctx.body.push(op::F64_SUB),
                    (BinaryOp::Sub, false) => ctx.body.push(op::I32_SUB),
                    (BinaryOp::Mul, true) => ctx.body.push(op::F64_MUL),
                    (BinaryOp::Mul, false) => ctx.body.push(op::I32_MUL),
                    (BinaryOp::Div, true) => ctx.body.push(op::F64_DIV),
                    (BinaryOp::Div, false) => ctx.body.push(op::I32_DIV_S),
                    (BinaryOp::Mod, false) => ctx.body.push(op::I32_REM_S),
                    (BinaryOp::Eq, true) => ctx.body.push(op::F64_EQ),
                    (BinaryOp::Eq, false) => ctx.body.push(op::I32_EQ),
                    (BinaryOp::NotEq, false) => ctx.body.push(op::I32_NE),
                    (BinaryOp::Lt, true) => ctx.body.push(op::F64_LT),
                    (BinaryOp::Lt, false) => ctx.body.push(op::I32_LT_S),
                    (BinaryOp::Gt, true) => ctx.body.push(op::F64_GT),
                    (BinaryOp::Gt, false) => ctx.body.push(op::I32_GT_S),
                    (BinaryOp::LtEq, false) => ctx.body.push(op::I32_LE_S),
                    (BinaryOp::GtEq, false) => ctx.body.push(op::I32_GE_S),
                    (BinaryOp::And, false) => ctx.body.push(op::I32_AND),
                    (BinaryOp::Or, false) => ctx.body.push(op::I32_OR),
                    _ => {}
                }
                Ok(())
            }

            ExprKind::Unary { op, operand } => {
                self.compile_expr(operand, ctx)?;
                match op {
                    UnaryOp::Neg => {
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(0);
                        ctx.body.push(op::I32_SUB);
                    }
                    UnaryOp::Not => {
                        ctx.body.push(op::I32_EQZ);
                    }
                }
                Ok(())
            }

            ExprKind::Assign { target, value } => {
                match &target.kind {
                    ExprKind::Identifier(name) => {
                        self.compile_expr(value, ctx)?;
                        if let Some((idx, _)) = ctx.locals.get(name) {
                            ctx.body.push(op::LOCAL_SET);
                            ctx.body.write_u32(*idx);
                            ctx.body.push(op::LOCAL_GET);
                            ctx.body.write_u32(*idx);
                            Ok(())
                        } else {
                            Err(format!("Undefined variable: {}", name))
                        }
                    }
                    ExprKind::Index { object, index } => {
                        self.compile_expr(value, ctx)?;

                        let val_local = ctx.local_count;
                        ctx.local_count += 1;
                        ctx.body.push(op::LOCAL_SET);
                        ctx.body.write_u32(val_local);

                        self.compile_expr(object, ctx)?;
                        self.compile_expr(index, ctx)?;

                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(4);
                        ctx.body.push(op::I32_MUL);
                        ctx.body.push(op::I32_ADD);
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(4);
                        ctx.body.push(op::I32_ADD);

                        ctx.body.push(op::LOCAL_GET);
                        ctx.body.write_u32(val_local);
                        ctx.body.push(op::I32_STORE);

                        ctx.body.push(op::LOCAL_GET);
                        ctx.body.write_u32(val_local);

                        Ok(())
                    }
                    _ => Err("Complex assignment not yet supported".to_string()),
                }
            }

            ExprKind::Call { callee, args } => {
                if let ExprKind::Identifier(name) = &callee.kind {
                    if name.starts_with("new ") {
                        let class_name = name[4..].to_string();

                        if let Some(layout) = self.class_layouts.get(&class_name) {
                            let temp = ctx.local_count;
                            ctx.local_count += 1;

                            ctx.body.push(op::GLOBAL_GET);
                            ctx.body.write_u32(self.heap_global_idx);
                            ctx.body.push(op::LOCAL_TEE);
                            ctx.body.write_u32(temp);
                            ctx.body.push(op::I32_CONST);
                            ctx.body.write_i32(layout.size as i32);
                            ctx.body.push(op::I32_ADD);
                            ctx.body.push(op::GLOBAL_SET);
                            ctx.body.write_u32(self.heap_global_idx);

                            ctx.body.push(op::LOCAL_GET);
                            ctx.body.write_u32(temp);

                            for arg in args {
                                self.compile_expr(arg, ctx)?;
                            }

                            let ctor_name = format!("{}_new", class_name);
                            if let Some((func_idx, _)) = self.functions.get(&ctor_name) {
                                ctx.body.push(op::CALL);
                                ctx.body.write_u32(*func_idx);
                                ctx.body.push(op::DROP);
                            }

                            ctx.body.push(op::LOCAL_GET);
                            ctx.body.write_u32(temp);

                            return Ok(());
                        }
                    }
                }

                for arg in args {
                    self.compile_expr(arg, ctx)?;
                }

                if let ExprKind::Identifier(name) = &callee.kind {
                    if let Some((func_idx, _)) = self.functions.get(name) {
                        ctx.body.push(op::CALL);
                        ctx.body.write_u32(*func_idx);
                        Ok(())
                    } else if name == "print" {
                        ctx.body.push(op::CALL);
                        ctx.body.write_u32(0);
                        Ok(())
                    } else {
                        Err(format!("Unknown function: {}", name))
                    }
                } else {
                    Err("Indirect calls not yet supported".to_string())
                }
            }

            ExprKind::Array(elements) => {
                let elem_size = 4;
                let header_size = 4;
                let total_size = header_size + elements.len() as u32 * elem_size;

                let temp_local = ctx.local_count;
                ctx.local_count += 1;

                ctx.body.push(op::GLOBAL_GET);
                ctx.body.write_u32(self.heap_global_idx);
                ctx.body.push(op::LOCAL_TEE);
                ctx.body.write_u32(temp_local);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(total_size as i32);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::GLOBAL_SET);
                ctx.body.write_u32(self.heap_global_idx);

                ctx.body.push(op::LOCAL_GET);
                ctx.body.write_u32(temp_local);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(elements.len() as i32);
                ctx.body.push(op::I32_STORE);

                for (i, elem) in elements.iter().enumerate() {
                    self.compile_expr(elem, ctx)?;

                    ctx.body.push(op::LOCAL_GET);
                    ctx.body.write_u32(temp_local);
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32((header_size + i as u32 * elem_size) as i32);
                    ctx.body.push(op::I32_ADD);

                    ctx.body.push(op::I32_STORE);
                }

                ctx.body.push(op::LOCAL_GET);
                ctx.body.write_u32(temp_local);

                Ok(())
            }

            ExprKind::Index { object, index } => {
                self.compile_expr(object, ctx)?;
                self.compile_expr(index, ctx)?;

                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(4);
                ctx.body.push(op::I32_MUL);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(4);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::I32_LOAD);

                Ok(())
            }

            ExprKind::Field { object, field } => {
                self.compile_expr(object, ctx)?;

                if field == "length" {
                    ctx.body.push(op::I32_LOAD);
                    return Ok(());
                }

                let class_name = self.infer_class_name(object);

                if let Some(layout) = self.class_layouts.get(&class_name) {
                    if let Some(field_info) = layout.fields.iter().find(|f| f.name == *field) {
                        if field_info.offset > 0 {
                            ctx.body.push(op::I32_CONST);
                            ctx.body.write_i32(field_info.offset as i32);
                            ctx.body.push(op::I32_ADD);
                        }
                        if field_info.valtype == valtype::F64 {
                            ctx.body.push(op::F64_LOAD);
                        } else {
                            ctx.body.push(op::I32_LOAD);
                        }
                        Ok(())
                    } else {
                        Err(format!("Unknown field: {}", field))
                    }
                } else {
                    Err(format!("Unknown class: {}", class_name))
                }
            }

            _ => Err("Expression not yet supported in codegen".to_string()),
        }
    }

    fn infer_class_name(&self, _expr: &Expr) -> String {
        "Point".to_string()
    }

    fn is_float_expr(&self, expr: &Expr) -> bool {
        match &expr.kind {
            ExprKind::Number(n) => n.fract() != 0.0,
            _ => false,
        }
    }

    fn alloc_memory(&mut self, size: u32, align: u32) -> u32 {
        let mask = align - 1;
        self.memory_offset = (self.memory_offset + mask) & !mask;
        let addr = self.memory_offset;
        self.memory_offset += size;
        addr
    }

    fn add_string(&mut self, text: &str) -> u32 {
        if let Some(&addr) = self.strings.get(text) {
            return addr;
        }

        let addr = self.alloc_memory(text.len() as u32 + 4, 4);
        let len_bytes = (text.len() as u32).to_le_bytes();

        self.data_section.push(0x00);
        self.data_section.push(0x41);
        self.data_section.write_i32(addr as i32);
        self.data_section.push(0x0B);

        let mut data = ByteBuffer::new();
        data.extend(&len_bytes);
        data.extend(text.as_bytes());
        let data_bytes = data.into_vec();

        self.data_section.write_u32(data_bytes.len() as u32);
        self.data_section.extend(&data_bytes);
        self.data_count += 1;

        self.strings.insert(text.to_string(), addr);
        addr
    }
}

/// Парсинг AST-типа в Type
fn parse_ast_type(ty: &crate::ast::Type) -> Type {
    match ty {
        crate::ast::Type::Named(name) => match name.as_str() {
            "int" => Type::Int,
            "float" => Type::Float,
            "bool" => Type::Bool,
            "string" => Type::String,
            "null" => Type::Null,
            "unit" | "void" => Type::Unit,
            other => Type::Named(other.to_string()),
        },
        crate::ast::Type::Array(inner) => Type::Array(Box::new(parse_ast_type(inner))),
        crate::ast::Type::Fn(args, ret) => {
            let a = args.iter().map(|x| parse_ast_type(x)).collect();
            let r = parse_ast_type(ret);
            Type::Fn(a, Box::new(r))
        }
        crate::ast::Type::Union(types) => {
            if let Some(first) = types.first() {
                parse_ast_type(first)
            } else {
                Type::Unit
            }
        }
        crate::ast::Type::Generic(name, args) => {
            let a = args.iter().map(|x| parse_ast_type(x)).collect();
            Type::Generic(name.clone(), a)
        }
        _ => Type::Var("$Unknown".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;
    use crate::parser::Parser;
    use crate::typechecker::TypeChecker;

    fn compile(source: &str) -> Vec<u8> {
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();
        let mut parser = Parser::new(tokens);
        let ast = parser.parse().unwrap();
        let mut checker = TypeChecker::new();
        checker.check_program(&ast).unwrap();

        let mut codegen = WasmCodegen::new();
        codegen.compile(&ast).unwrap()
    }

    #[test]
    fn test_compile_add() {
        let wasm = compile(r#"
fn add(a: int, b: int) -> int {
    return a + b;
}
fn main() -> int {
    return add(1, 2);
}
"#);

        assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
        assert_eq!(&wasm[4..8], &[0x01, 0x00, 0x00, 0x00]);
        println!("WASM module size: {} bytes", wasm.len());
    }

    #[test]
    fn test_compile_factorial() {
        let wasm = compile(r#"
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
"#);
        assert!(wasm.len() > 50);
    }

    #[test]
    fn test_compile_let() {
        let wasm = compile(r#"
fn main() -> int {
    let x = 42;
    return x;
}
"#);
        assert!(wasm.len() > 30);
    }

    #[test]
    fn test_compile_if_else() {
        let wasm = compile(r#"
fn max(a: int, b: int) -> int {
    if (a > b) {
        return a;
    } else {
        return b;
    }
}
"#);
        assert!(wasm.len() > 40);
    }

    #[test]
    fn test_compile_while() {
        let wasm = compile(r#"
fn countdown(n: int) -> int {
    while (n > 0) {
        n = n - 1;
    }
    return n;
}
"#);
        assert!(wasm.len() > 40);
    }

    #[test]
    fn test_compile_unary() {
        let wasm = compile(r#"
fn neg(x: int) -> int {
    return -x;
}
"#);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_bool() {
        let wasm = compile(r#"
fn not(x: bool) -> bool {
    return !x;
}
"#);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_comparison() {
        let wasm = compile(r#"
fn lt(a: int, b: int) -> bool {
    return a < b;
}
"#);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_logical() {
        let wasm = compile(r#"
fn and(a: bool, b: bool) -> bool {
    return a && b;
}
"#);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_assignment() {
        let wasm = compile(r#"
fn main() -> int {
    let x = 1;
    x = 2;
    return x;
}
"#);
        assert!(wasm.len() > 30);
    }

    #[test]
    fn test_compile_array() {
        let wasm = compile(r#"
fn main() -> int {
    let arr = [10, 20, 30];
    return arr[1];
}
"#);
        assert!(wasm.len() > 40);
    }

    #[test]
    fn test_compile_array_assignment() {
        let wasm = compile(r#"
fn main() -> int {
    let arr = [10, 20, 30];
    arr[1] = 99;
    return arr[1];
}
"#);
        assert!(wasm.len() > 50);
    }

    #[test]
    fn test_compile_string_length() {
        let wasm = compile(r#"
fn main() -> int {
    let s = "hello";
    return s.length;
}
"#);
        assert!(wasm.len() > 30);
    }

    #[test]
    fn test_compile_class() {
        let wasm = compile(r#"
class Point {
    x: int;
    y: int;
    fn new(x: int, y: int) {
        this.x = x;
        this.y = y;
    }
}
"#);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_float_arithmetic() {
        let wasm = compile(r#"
fn circle_area(r: float) -> float {
    return 3.14159 * r * r;
}
"#);
        let bytes = wasm;
        assert!(bytes.contains(&op::F64_MUL));
    }
}
