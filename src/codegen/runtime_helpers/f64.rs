//! `float`→`string`: `__latent_f64_to_str(n)->ptr` (6 знаков после точки).

use super::*;

impl WasmCodegen {
    /// f64_to_str(n)->ptr: "<int>.<6 дробных цифр>" (фиксированные 6 знаков).
    /// params: 0 n(f64); i32-локали: 1 $neg,2 $p,3 $ipart,4 $s,5 $i,6 $digit;
    /// f64-локаль: 7 $frac.
    pub(super) fn emit_f64_to_str_body(&mut self) {
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
}
