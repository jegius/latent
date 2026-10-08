//! Рантайм-хелперы, эмитируемые прямо в WASM (без host-импортов).
//!
//! Закрывает блокеры селф-хостинга, невыразимые на уровне AST:
//! * байтовый доступ и сдвиги (`i32.load8_u`/`i32.store8`, `shl`/`shr`);
//! * рост памяти (`memory.grow`/`memory.size`);
//! * операции над строками (длина, конкатенация, сравнение, символ);
//! * преобразования `int`↔`string` и `float`→`string`.
//!
//! Строковое представление едино для всего компилятора: `[len u32 LE][utf8]`.
//! Все хелперы — обычные функции модуля, доступные по индексу.

use super::bytecode::{op, valtype, ByteBuffer};
use super::module_builder::WasmCodegen;

/// Имена рантайм-хелперов (ключи в [`WasmCodegen::helpers`]).
pub(super) const ALLOC: &str = "__latent_alloc";
pub(super) const MEM_COPY: &str = "__latent_mem_copy";
pub(super) const STR_LEN: &str = "__latent_str_len";
pub(super) const STR_CONCAT: &str = "__latent_str_concat";
pub(super) const STR_EQ: &str = "__latent_str_eq";
pub(super) const STR_CHAR_AT: &str = "__latent_str_char_at";
pub(super) const I32_TO_STR: &str = "__latent_i32_to_str";
pub(super) const F64_TO_STR: &str = "__latent_f64_to_str";
pub(super) const STR_TO_I32: &str = "__latent_str_to_i32";

const PAGE: i32 = 65536;

impl WasmCodegen {
    /// Регистрирует сигнатуры всех рантайм-хелперов. Вызывается после
    /// регистрации пользовательских функций, чтобы индексы были стабильны.
    pub(super) fn register_helpers(&mut self) {
        let alloc_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(ALLOC, alloc_ty);

        let copy_ty = self.add_func_type(&[valtype::I32, valtype::I32, valtype::I32], &[]);
        self.register_helper(MEM_COPY, copy_ty);

        let len_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(STR_LEN, len_ty);

        let concat_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_CONCAT, concat_ty);

        let eq_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_EQ, eq_ty);

        let char_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_CHAR_AT, char_ty);

        let i32s_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(I32_TO_STR, i32s_ty);

        let f64s_ty = self.add_func_type(&[valtype::F64], &[valtype::I32]);
        self.register_helper(F64_TO_STR, f64s_ty);

        let s2i_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(STR_TO_I32, s2i_ty);
    }

    fn register_helper(&mut self, name: &str, type_idx: u32) {
        let func_idx = self.import_count + self.func_count;
        self.func_count += 1;
        self.func_section.write_u32(type_idx);
        self.helpers.insert(name.to_string(), (func_idx, type_idx));
    }

    /// Индекс хелпера (гарантированно зарегистрирован).
    pub(super) fn helper_idx(&self, name: &str) -> u32 {
        self.helpers.get(name).map(|(i, _)| *i).unwrap_or(0)
    }

    /// Эмитит тела всех хелперов в code-секцию (в том же порядке, что и
    /// записи в func-секции). Вызывается после тел пользовательских функций.
    pub(super) fn emit_helper_bodies(&mut self) {
        self.emit_alloc_body();
        self.emit_mem_copy_body();
        self.emit_str_len_body();
        self.emit_str_concat_body();
        self.emit_str_eq_body();
        self.emit_str_char_at_body();
        self.emit_i32_to_str_body();
        self.emit_f64_to_str_body();
        self.emit_str_to_i32_body();
    }

    /// Начинает тело функции с `n` i32-локалями (все хелперы используют i32,
    /// кроме f64-хелпера, который задаёт локали сам).
    fn begin_body(&mut self, extra_locals: u32) -> ByteBuffer {
        let mut b = ByteBuffer::new();
        if extra_locals > 0 {
            b.write_u32(1);
            b.write_u32(extra_locals);
            b.push(valtype::I32);
        } else {
            b.write_u32(0);
        }
        b
    }

    fn finish_body(&mut self, b: ByteBuffer) {
        let mut body = b;
        body.push(op::END);
        let bytes = body.into_vec();
        self.code_section.write_u32(bytes.len() as u32);
        self.code_section.extend(&bytes);
        self.code_count += 1;
    }

    fn g_heap(&self, b: &mut ByteBuffer) {
        b.push(op::GLOBAL_GET);
        b.write_u32(self.heap_global_idx);
    }

    fn i32c(&self, b: &mut ByteBuffer, v: i32) {
        b.push(op::I32_CONST);
        b.write_i32(v);
    }

    fn call(&self, b: &mut ByteBuffer, name: &str) {
        b.push(op::CALL);
        b.write_u32(self.helper_idx(name));
    }

    /// alloc(size)->ptr: bump-аллокатор с ростом памяти.
    /// param 0 = size; declared local 1 = ptr, 2 = need_pages, 3 = cur.
    fn emit_alloc_body(&mut self) {
        let mut b = self.begin_body(3);
        // ptr = heap
        self.g_heap(&mut b);
        b.push(op::LOCAL_SET); b.write_u32(1);
        // heap = heap + size  (param 0 = size)
        self.g_heap(&mut b);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_ADD);
        b.push(op::GLOBAL_SET); b.write_u32(self.heap_global_idx);
        // need_pages = (heap + 65535) / 65536
        self.g_heap(&mut b);
        self.i32c(&mut b, PAGE - 1);
        b.push(op::I32_ADD);
        self.i32c(&mut b, PAGE);
        b.push(op::I32_DIV_U);
        b.push(op::LOCAL_SET); b.write_u32(2);
        // cur = memory.size
        b.push(op::MEMORY_SIZE); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        // if cur < need_pages { grow(need-cur) drop }
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_LT_U);
        b.push(op::IF); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_SUB);
        b.push(op::MEMORY_GROW); b.write_u32(0);
        b.push(op::DROP);
        b.push(op::END);
        b.push(op::LOCAL_GET); b.write_u32(1); // return ptr
        self.finish_body(b);
    }

    /// mem_copy(dst, src, len): побайтовое копирование.
    /// params: 0 dst, 1 src, 2 len; declared locals: 3 $i
    fn emit_mem_copy_body(&mut self) {
        let mut b = self.begin_body(1);
        // i = 0
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        // if i >= len break
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_GE_U);
        b.push(op::BR_IF); b.write_u32(1);
        // dst[i] = src[i]
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        // i++
        b.push(op::LOCAL_GET); b.write_u32(3);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        self.finish_body(b);
    }

    /// str_len(ptr)->i32: читает длину из заголовка.
    fn emit_str_len_body(&mut self) {
        let mut b = self.begin_body(0);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        self.finish_body(b);
    }

    /// str_concat(a,b)->ptr.
    /// locals: params 0 a, 1 b; declared 2 $alen,3 $blen,4 $p
    fn emit_str_concat_body(&mut self) {
        let mut b = self.begin_body(3);
        // alen = load(a)
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(2);
        // blen = load(b)
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        // p = alloc(alen+blen+4)
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        self.call(&mut b, ALLOC);
        b.push(op::LOCAL_SET); b.write_u32(4);
        // store len
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::I32_STORE); b.write_u32(2); b.write_u32(0);
        // mem_copy(p+4, a+4, alen)
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.call(&mut b, MEM_COPY);
        // mem_copy(p+4+alen, b+4, blen)
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(3);
        self.call(&mut b, MEM_COPY);
        // return p
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.finish_body(b);
    }

    /// str_eq(a,b)->i32 (1/0).
    /// locals: params 0 a,1 b; declared 2 $i,3 $len
    fn emit_str_eq_body(&mut self) {
        let mut b = self.begin_body(2);
        // if a == b return 1
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_EQ);
        b.push(op::IF); b.push(valtype::I32);
        self.i32c(&mut b, 1);
        b.push(op::ELSE);
        // len = load(a); if len != load(b) return 0
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::I32_NE);
        b.push(op::IF); b.push(valtype::I32);
        self.i32c(&mut b, 0);
        b.push(op::ELSE);
        // i = 0
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        // if i >= len break
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_GE_U);
        b.push(op::BR_IF); b.write_u32(1);
        // if a[4+i] != b[4+i] return 0
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(1);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::I32_NE);
        b.push(op::IF); b.push(valtype::VOID);
        self.i32c(&mut b, 0);
        b.push(op::RETURN);
        b.push(op::END);
        // i++
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        // return 1
        self.i32c(&mut b, 1);
        b.push(op::END); // if len !=
        b.push(op::END); // if a==b
        self.finish_body(b);
    }

    /// str_char_at(ptr, index)->i32: байт по индексу (0..len), иначе -1.
    fn emit_str_char_at_body(&mut self) {
        let mut b = self.begin_body(0);
        // if index < 0 || index >= len return -1
        b.push(op::LOCAL_GET); b.write_u32(1);
        self.i32c(&mut b, 0);
        b.push(op::I32_LT_S);
        b.push(op::IF); b.push(valtype::I32);
        self.i32c(&mut b, -1);
        b.push(op::ELSE);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::I32_GE_U);
        b.push(op::IF); b.push(valtype::I32);
        self.i32c(&mut b, -1);
        b.push(op::ELSE);
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        self.finish_body(b);
    }

    /// i32_to_str(n)->ptr.
    /// params: 0 n; declared: 1 $neg,2 $v,3 $digits,4 $i,5 $p
    fn emit_i32_to_str_body(&mut self) {
        let mut b = self.begin_body(5);
        // neg = n < 0
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 0);
        b.push(op::I32_LT_S);
        b.push(op::LOCAL_SET); b.write_u32(1);
        // v = abs(n)
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::IF); b.push(valtype::VOID);
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_SUB);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::ELSE);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::END);
        // digits = 1
        self.i32c(&mut b, 1);
        b.push(op::LOCAL_SET); b.write_u32(3);
        // i = v
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_SET); b.write_u32(4);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 10);
        b.push(op::I32_LT_U);
        b.push(op::BR_IF); b.write_u32(1);
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 10);
        b.push(op::I32_DIV_U);
        b.push(op::LOCAL_SET); b.write_u32(4);
        b.push(op::LOCAL_GET); b.write_u32(3);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        // total = digits + neg
        // p = alloc(4 + total)
        self.i32c(&mut b, 4);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        self.call(&mut b, ALLOC);
        b.push(op::LOCAL_SET); b.write_u32(5);
        // store len = digits + neg
        b.push(op::LOCAL_GET); b.write_u32(5);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        b.push(op::I32_STORE); b.write_u32(2); b.write_u32(0);
        // if neg store '-' at p+4
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::IF); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        self.i32c(&mut b, b'-' as i32);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        b.push(op::END);
        // i = digits ; write from end
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_SET); b.write_u32(4);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_EQZ);
        b.push(op::BR_IF); b.write_u32(1);
        // i--
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 1);
        b.push(op::I32_SUB);
        b.push(op::LOCAL_SET); b.write_u32(4);
        // p + 4 + neg + i = '0' + v%10
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 10);
        b.push(op::I32_REM_U);
        self.i32c(&mut b, b'0' as i32);
        b.push(op::I32_ADD);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        // v /= 10
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 10);
        b.push(op::I32_DIV_U);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.finish_body(b);
    }

    /// f64_to_str(n)->ptr: "<int>.<6 дробных цифр>" (фиксированные 6 знаков).
    /// params: 0 n(f64); i32-локали: 1 $neg,2 $p,3 $ipart,4 $s,5 $i,6 $digit;
    /// f64-локаль: 7 $frac.
    fn emit_f64_to_str_body(&mut self) {
        let mut b = ByteBuffer::new();
        b.write_u32(2);
        b.write_u32(6); // 6 i32-локалей (индексы 1..6)
        b.push(valtype::I32);
        b.write_u32(1); // 1 f64-локаль (индекс 7)
        b.push(valtype::F64);
        // neg = n < 0.0
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::F64_CONST);
        b.extend(&0f64.to_le_bytes());
        b.push(op::F64_LT);
        b.push(op::LOCAL_SET); b.write_u32(1);
        // if neg n = -n
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::IF); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::F64_NEG);
        b.push(op::LOCAL_SET); b.write_u32(0);
        b.push(op::END);
        // ipart = trunc(n) as i32
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_TRUNC_F64_S);
        b.push(op::LOCAL_SET); b.write_u32(3);
        // p = alloc(4 + 1 + 11 + 1 + 6) = alloc(23)
        self.i32c(&mut b, 23);
        self.call(&mut b, ALLOC);
        b.push(op::LOCAL_SET); b.write_u32(2);
        // s = i32_to_str(ipart)
        b.push(op::LOCAL_GET); b.write_u32(3);
        self.call(&mut b, I32_TO_STR);
        b.push(op::LOCAL_SET); b.write_u32(4);
        // mem_copy(p+4, s+4, load(s))
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        self.call(&mut b, MEM_COPY);
        // '.' at p + 4 + neg + load(s)
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::I32_ADD);
        self.i32c(&mut b, b'.' as i32);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        // frac = n - convert(ipart)
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::F64_CONVERT_I32_S);
        b.push(op::F64_SUB);
        b.push(op::LOCAL_SET); b.write_u32(7);
        // i = 0
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(5);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, 6);
        b.push(op::I32_GE_S);
        b.push(op::BR_IF); b.write_u32(1);
        // frac *= 10
        b.push(op::LOCAL_GET); b.write_u32(7);
        b.push(op::F64_CONST);
        b.extend(&10f64.to_le_bytes());
        b.push(op::F64_MUL);
        b.push(op::LOCAL_SET); b.write_u32(7);
        // digit = trunc(frac)
        b.push(op::LOCAL_GET); b.write_u32(7);
        b.push(op::I32_TRUNC_F64_S);
        b.push(op::LOCAL_SET); b.write_u32(6);
        // frac -= convert(digit)
        b.push(op::LOCAL_GET); b.write_u32(7);
        b.push(op::LOCAL_GET); b.write_u32(6);
        b.push(op::F64_CONVERT_I32_S);
        b.push(op::F64_SUB);
        b.push(op::LOCAL_SET); b.write_u32(7);
        // p + 4 + neg + load(s) + 1 + i = '0'+digit
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::I32_ADD);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(5);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(6);
        self.i32c(&mut b, b'0' as i32);
        b.push(op::I32_ADD);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        // i++
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(5);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        // len = neg + load(s) + 1 + 6 ; store at p
        b.push(op::LOCAL_GET); b.write_u32(2);   // addr = p
        b.push(op::LOCAL_GET); b.write_u32(1);   // neg
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::I32_ADD);
        self.i32c(&mut b, 7);
        b.push(op::I32_ADD);                     // value = neg+len+7
        b.push(op::I32_STORE); b.write_u32(2); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.finish_body(b);
    }

    /// str_to_i32(ptr)->i32: парсит ASCII-число (опциональный '-').
    /// params 0 ptr; locals 1 $len,2 $i,3 $neg,4 $acc,5 $c
    fn emit_str_to_i32_body(&mut self) {
        let mut b = self.begin_body(5);
        // len = load(ptr)
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(1);
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(2);
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(4);
        // if len>0 && ptr[4]=='-' { neg=1; i=1 }
        b.push(op::LOCAL_GET); b.write_u32(1);
        self.i32c(&mut b, 0);
        b.push(op::I32_GT_S);
        b.push(op::IF); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        self.i32c(&mut b, b'-' as i32);
        b.push(op::I32_EQ);
        b.push(op::IF); b.push(valtype::VOID);
        self.i32c(&mut b, 1);
        b.push(op::LOCAL_SET); b.write_u32(3);
        self.i32c(&mut b, 1);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::END);
        b.push(op::END);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::I32_GE_U);
        b.push(op::BR_IF); b.write_u32(1);
        // c = ptr[4+i]
        b.push(op::LOCAL_GET); b.write_u32(0);
        self.i32c(&mut b, 4);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(5);
        // if c < '0' break
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, b'0' as i32);
        b.push(op::I32_LT_U);
        b.push(op::BR_IF); b.write_u32(1);
        // if c > '9' break
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, b'9' as i32);
        b.push(op::I32_GT_U);
        b.push(op::BR_IF); b.write_u32(1);
        // acc = acc*10 + (c-'0')
        b.push(op::LOCAL_GET); b.write_u32(4);
        self.i32c(&mut b, 10);
        b.push(op::I32_MUL);
        b.push(op::LOCAL_GET); b.write_u32(5);
        self.i32c(&mut b, b'0' as i32);
        b.push(op::I32_SUB);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(4);
        // i++
        b.push(op::LOCAL_GET); b.write_u32(2);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(2);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        // if neg acc = -acc
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::IF); b.push(valtype::I32);
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::I32_SUB);
        b.push(op::ELSE);
        b.push(op::LOCAL_GET); b.write_u32(4);
        b.push(op::END);
        self.finish_body(b);
    }
}