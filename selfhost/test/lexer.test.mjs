// Атомарные тесты лексера shc.lat (функция tokenize и её помощники).
//
// Коды токенов заданы в shc.lat (kw_code/punct_kind):
//   0=EOF 1=число 2=идентификатор 3=строка
//   10=let 11=fn 12=if 13=else 14=while 15=return 16=for 90=true 91=false
//   20=( 21=) 22={ 23=} 24=, 25=; 26=: 27== 28=-> 30=+ 31=- 32=* 33=/ 34=%
//   40==== 41=!= 42=< 43=> 44=<= 45=>= 46=&& 47=|| 48=& 49=| 50=^ 51=<< 52=>> 53=!

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SELFHOST, buildStage1, readTokens } from "./harness.mjs";

const T = {
  EOF: 0,
  INT: 1,
  IDENT: 2,
  STR: 3,
  LET: 10,
  FN: 11,
  IF: 12,
  ELSE: 13,
  WHILE: 14,
  RETURN: 15,
  FOR: 16,
  TRUE: 90,
  FALSE: 91,
  LPAREN: 20,
  RPAREN: 21,
  LBRACE: 22,
  RBRACE: 23,
  COMMA: 24,
  SEMI: 25,
  COLON: 26,
  ASSIGN: 27,
  ARROW: 28,
  PLUS: 30,
  MINUS: 31,
  STAR: 32,
  SLASH: 33,
  PERCENT: 34,
  EQ: 40,
  NEQ: 41,
  LT: 42,
  GT: 43,
  LE: 44,
  GE: 45,
  AND: 46,
  OR: 47,
  AMP: 48,
  PIPE: 49,
  CARET: 50,
  SHL: 51,
  SHR: 52,
  BANG: 53,
};

function kindOf(source) {
  const stage1 = readFileSync(join(SELFHOST, "stage1.wasm"));
  return readTokens(stage1, source);
}

describe("tokenize: базовые категории", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });
  const kinds = (src) => readTokens(stage1, src).kinds;

  test("числовой литерал", () => {
    assert.deepEqual(kinds("123"), [T.INT, T.EOF]);
  });

  test("многоразрядное число", () => {
    assert.deepEqual(kinds("624485"), [T.INT, T.EOF]);
  });

  test("идентификатор", () => {
    assert.deepEqual(kinds("foo"), [T.IDENT, T.EOF]);
  });

  test("идентификатор с цифрами и _", () => {
    assert.deepEqual(kinds("x_1"), [T.IDENT, T.EOF]);
  });

  test("ключевые слова", () => {
    assert.deepEqual(kinds("let"), [T.LET, T.EOF]);
    assert.deepEqual(kinds("fn"), [T.FN, T.EOF]);
    assert.deepEqual(kinds("if"), [T.IF, T.EOF]);
    assert.deepEqual(kinds("else"), [T.ELSE, T.EOF]);
    assert.deepEqual(kinds("while"), [T.WHILE, T.EOF]);
    assert.deepEqual(kinds("return"), [T.RETURN, T.EOF]);
    assert.deepEqual(kinds("for"), [T.FOR, T.EOF]);
  });

  test("логические литералы", () => {
    assert.deepEqual(kinds("true"), [T.TRUE, T.EOF]);
    assert.deepEqual(kinds("false"), [T.FALSE, T.EOF]);
  });

  test("строковый литерал", () => {
    assert.deepEqual(kinds('"hello"'), [T.STR, T.EOF]);
  });
});

describe("tokenize: пунктуация", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });
  const kinds = (src) => readTokens(stage1, src).kinds;
  const single = (ch, kind) => {
    test(`пункт ${JSON.stringify(ch)} -> ${kind}`, () => {
      assert.deepEqual(kinds(ch), [kind, T.EOF]);
    });
  };

  single("(", T.LPAREN);
  single(")", T.RPAREN);
  single("{", T.LBRACE);
  single("}", T.RBRACE);
  single(",", T.COMMA);
  single(";", T.SEMI);
  single(":", T.COLON);
  single("=", T.ASSIGN);
  single("+", T.PLUS);
  single("-", T.MINUS);
  single("*", T.STAR);
  single("/", T.SLASH);
  single("%", T.PERCENT);
  single("<", T.LT);
  single(">", T.GT);
  single("&", T.AMP);
  single("|", T.PIPE);
  single("^", T.CARET);
  single("!", T.BANG);

  const twin = (ch, kind) => {
    test(`пункт ${JSON.stringify(ch)} -> ${kind}`, () => {
      assert.deepEqual(kinds(ch), [kind, T.EOF]);
    });
  };
  twin("==", T.EQ);
  twin("!=", T.NEQ);
  twin("<=", T.LE);
  twin(">=", T.GE);
  twin("&&", T.AND);
  twin("||", T.OR);
  twin("<<", T.SHL);
  twin(">>", T.SHR);
  twin("->", T.ARROW);
});

describe("tokenize: комментарии и пробелы", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });
  const kinds = (src) => readTokens(stage1, src).kinds;

  test("строчный комментарий пропускается", () => {
    assert.deepEqual(kinds("// comment\n42"), [T.INT, T.EOF]);
  });

  test("пробелы и переводы строк пропускаются", () => {
    assert.deepEqual(kinds("  \t\n 7 \n"), [T.INT, T.EOF]);
  });
});

describe("tokenize: поток типичной программы", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });

  test("fn main() -> int { return 7; }", () => {
    const { kinds } = readTokens(stage1, "fn main() -> int { return 7; }");
    assert.deepEqual(kinds, [
      T.FN,
      T.IDENT,
      T.LPAREN,
      T.RPAREN,
      T.ARROW,
      T.IDENT,
      T.LBRACE,
      T.RETURN,
      T.INT,
      T.SEMI,
      T.RBRACE,
      T.EOF,
    ]);
  });
});