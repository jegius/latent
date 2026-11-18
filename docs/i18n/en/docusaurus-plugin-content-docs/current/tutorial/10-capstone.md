---
title: "Chapter 10. Capstone: bank transactions"
sidebar_label: "10. Capstone"
sidebar_position: 11
description: The final project — classes, enums, match, higher-order functions, and tests in a single program.
---

# Chapter 10. Capstone: bank transactions

Let's put everything together: a class with methods, enum transactions, pattern
matching, logic split into functions, tests, and an entry point.

```latent
class Account {
    balance: int;

    fn init(start) {
        this.balance = start;
    }

    fn deposit(amount) -> int {
        this.balance = this.balance + amount;
        return amount;
    }

    fn withdraw(amount) -> int {
        if (amount > this.balance) {
            return 0;
        }
        this.balance = this.balance - amount;
        return amount;
    }
}

enum Tx { Deposit(int), Withdraw(int), Noop }

fn apply(acc: Account, tx: Tx) -> int {
    return match tx {
        // A 0-ary variant is checked by the tag value and must come before
        // variants with fields: for those the tag is read through the pointer.
        case Noop(): 0,
        case Deposit(n): acc.deposit(n),
        case Withdraw(n): acc.withdraw(n),
    };
}

fn fee(amount: int) -> int {
    return amount / 10;
}

fn run(acc: Account, txs: [Tx]) -> int {
    let applied = 0;
    for (let tx in txs) {
        applied = applied + apply(acc, tx);
    }
    return applied;
}

test "account basics" {
    let a = new Account(100);
    assert(a.deposit(50) == 50);
    assert_eq(a.balance, 150);
    assert_eq(a.withdraw(30), 30);
}

fn main() -> int {
    let acc = new Account(100);

    // The array is created as a literal: the Deposit/Withdraw constructors allocate
    // values, and the literal guarantees that slots already exist for them.
    let txs: [Tx] = [Deposit(100), Withdraw(30), Noop];

    let applied = run(acc, txs);
    print("applied:", applied);
    print("balance:", acc.balance);
    print("fee:", fee(applied));
    return acc.balance;
}
```

## Walkthrough

| Element | Where it is used |
|---|---|
| class `Account` | fields, `init`, the `deposit`/`withdraw` methods, `this` |
| `enum Tx` | a sum type: two transactions with data plus an empty one |
| `match` | dispatching a transaction by variant |
| `for-in` | iterating over the array of transactions |
| `[Tx]` | a typed array of enum values |
| `test` | checks of the class (executed by engine #1) |
| `main` | the scenario and the exit code (`balance`) |

The expected behavior: `applied = 100 + 30 + 0 = 130`, `balance = 100 + 100 -
30 = 170`, `fee = 13`; `main` returns `170`.

## How to run

1. **Engine #2 (Rust → WASM)** — compile and run it in Node.js:

```bash
./target/debug/latentc compile capstone.lat capstone.wasm
node run.mjs capstone.wasm
# applied:
# 130
# balance:
# 170
# fee:
# 13
```

(`run.mjs` is the host runtime from [hello-world](../getting-started/hello-world.md).)

2. **Engine #1 (playground, Run)** — the program will be executed by the
   interpreter, but `enum` is not supported by it, so this capstone is designed for
   engine #2. The test block will run after `main`; the result is not displayed in
   the UI.

## What is left out

- **Error handling**: `withdraw` returns `0` as a failure marker — you can replace
  it with `Err("insufficient funds")` and `match` on `Ok`/`Err`.
- **Lambdas**: the fee can be parameterized:
  `let fee_fn = fn(amount) => amount / 10;` and passed into `run`.
- **Engine #2 limitations**: you cannot use `float` fields, `channel`,
  `snapshot`/contracts; arrays are best created as literals, and `push` should be
  used with care (an unbounded bump allocator).

## Where to go next

- [The language guide](../guide/index.md) — the details of each topic.
- The **reference** section in the sidebar — built-in signatures, types, error
  messages, and the ABI.
- [Engine differences](../guide/wasm-and-execution.md#engine-differences) — to
  choose an engine deliberately.
