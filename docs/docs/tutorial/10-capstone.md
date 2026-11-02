---
title: "Глава 10. Capstone: банковские транзакции"
sidebar_label: "10. Capstone"
sidebar_position: 11
description: Итоговый проект — классы, enum, match, функции высшего порядка и тесты в одной программе.
---

# Глава 10. Capstone: банковские транзакции

Соберём всё вместе: класс с методами, enum-транзакции, pattern matching,
разделение логики на функции, тесты и точку входа.

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
        // 0-арный вариант проверяется по значению-тегу и должен идти раньше
        // вариантов с полями: у тех тег читается по указателю.
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

    // Массив создаётся литералом: конструкторы Deposit/Withdraw аллоцируют
    // значения, и литерал гарантирует, что для них уже есть слоты.
    let txs: [Tx] = [Deposit(100), Withdraw(30), Noop];

    let applied = run(acc, txs);
    print("applied:", applied);
    print("balance:", acc.balance);
    print("fee:", fee(applied));
    return acc.balance;
}
```

## Разбор

| Элемент | Где используется |
|---|---|
| класс `Account` | поля, `init`, методы `deposit`/`withdraw`, `this` |
| `enum Tx` | sum-тип: две транзакции с данными + пустая |
| `match` | диспетчеризация транзакции по варианту |
| `for-in` | проход по массиву транзакций |
| `[Tx]` | типизированный массив enum-значений |
| `test` | проверки класса (исполняются движком №1) |
| `main` | сценарий и код возврата (`balance`) |

Ожидаемое поведение: `applied = 100 + 30 + 0 = 130`, `balance = 100 + 100 -
30 = 170`, `fee = 13`; `main` возвращает `170`.

## Как запустить

1. **Движок №2 (Rust → WASM)** — скомпилируйте и запустите в Node.js:

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

(`run.mjs` — host-рантайм из [hello-world](../getting-started/hello-world.md).)

2. **Движок №1 (playground, Run)** — программа выполнится интерпретатором, но
   `enum` им не поддерживается, поэтому этот capstone рассчитан на движок №2.
   Тест-блок исполнится после `main`; результат не отображается в UI.

## Что осталось за кадром

- **Обработка ошибок**: `withdraw` возвращает `0` как признак отказа — можно
  заменить на `Err("insufficient funds")` и `match` по `Ok`/`Err`.
- **Лямбды**: комиссию можно параметризовать:
  `let fee_fn = fn(amount) => amount / 10;` и передать в `run`.
- **Ограничения движка №2**: нельзя использовать `float`-поля, `channel`,
  `snapshot`/контракты; массивы лучше создавать литералами, а `push` —
  использовать осторожно (bump-аллокатор без границ).

## Куда дальше

- [Руководство по языку](../guide/index.md) — детали каждой темы.
- Раздел **справочник** в боковом меню — сигнатуры встроенных функций, типы,
  тексты ошибок и ABI.
- [Различия движков](../guide/wasm-and-execution.md#различия-движков) — чтобы
  осознанно выбирать движок.
