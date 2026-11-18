//! `int`→`string`: `__latent_i32_to_str(n)->ptr`.

use super::*;

impl WasmCodegen {
    /// i32_to_str(n)->ptr.
    /// params: 0 n; declared: 1 $neg,2 $v,3 $digits,4 $i,5 $p
    pub(super) fn emit_i32_to_str_body(&mut self) {
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
}
