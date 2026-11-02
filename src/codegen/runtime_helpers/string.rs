//! Операции над строками: длина, конкатенация, сравнение, символ, парсинг.
//!
//! Формат строки в линейной памяти един для всего компилятора:
//! `[len u32 LE][utf8 bytes...]`. Все функции работают с указателем на
//! заголовок, поэтому длина читается по смещению 0, а байты — с +4.

use super::*;

impl WasmCodegen {
    /// str_len(ptr)->i32: читает длину из заголовка.
    pub(super) fn emit_str_len_body(&mut self) {
        let mut b = self.begin_body(0);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_LOAD); b.write_u32(2); b.write_u32(0);
        self.finish_body(b);
    }

    /// str_concat(a,b)->ptr.
    /// locals: params 0 a, 1 b; declared 2 $alen,3 $blen,4 $p
    pub(super) fn emit_str_concat_body(&mut self) {
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
    pub(super) fn emit_str_eq_body(&mut self) {
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
    pub(super) fn emit_str_char_at_body(&mut self) {
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

    /// str_to_i32(ptr)->i32: парсит ASCII-число (опциональный '-').
    /// params 0 ptr; locals 1 $len,2 $i,3 $neg,4 $acc,5 $c
    pub(super) fn emit_str_to_i32_body(&mut self) {
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
