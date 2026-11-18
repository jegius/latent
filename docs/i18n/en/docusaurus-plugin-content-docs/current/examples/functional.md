---
title: "Functional style: map/filter/reduce and lambdas"
sidebar_label: Functional style
sidebar_position: 6
description: "Walkthrough of fp_patterns.lat and lambdas.lat: map/filter/reduce, composition, lambdas in both forms, closures, higher-order functions, for-in."
---

# Functional style

## `fp_patterns.lat` — map / filter / reduce

`web-ide/examples/fp_patterns.lat`:

```latent
// Functional patterns: map, filter, reduce over arrays

fn map_double(arr: [int]) -> [int] {
    let result = [];
    for (let i = 0; i < arr.length; i = i + 1) {
        result.push(arr[i] * 2);
    }
    return result;
}

fn filter_even(arr: [int]) -> [int] {
    let result = [];
    for (let i = 0; i < arr.length; i = i + 1) {
        if (arr[i] % 2 == 0) {
            result.push(arr[i]);
        }
    }
    return result;
}

fn reduce_sum(arr: [int]) -> int {
    let acc = 0;
    for (let i = 0; i < arr.length; i = i + 1) {
        acc = acc + arr[i];
    }
    return acc;
}

fn main() -> int {
    let numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    print("numbers:", numbers);

    let doubled = map_double(numbers);
    print("doubled: ", doubled);

    let evens = filter_even(numbers);
    print("evens:   ", evens);

    let total = reduce_sum(numbers);
    print("sum:     ", total);

    // Composition: sum of doubled evens
    let pipeline = reduce_sum(map_double(filter_even(numbers)));
    print("sum of doubled evens:", pipeline);

    return pipeline;
}
```

Output (engine #1):

```text
numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
doubled:  [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
evens:    [2, 4, 6, 8, 10]
sum:      55
sum of doubled evens: 60
```

Analysis: these are "manual" map/filter/reduce built on loops and `push` — without
closures. The composition `reduce_sum(map_double(filter_even(numbers)))` is an
ordinary call of nested functions.

Engine #2: it compiles; `print(arr)` prints a pointer (see
[engines](../specs/engines.md)).

## `lambdas.lat` — lambdas, closures, higher order

`web-ide/examples/lambdas.lat`:

```latent
// First-class functions & lambdas: closures, higher-order functions, for-in.

fn apply_twice(f, x) {
    return f(f(x));
}

fn map_arr(arr, f) {
    let r = [];
    for (let item in arr) {
        r.push(f(item));
    }
    return r;
}

fn main() -> int {
    // lambda with expression body
    let double = fn(x) => x * 2;
    print("double(21) =", double(21));

    // lambda with block body
    let scale = fn(x) {
        let y = x + 1;
        return y * 10;
    };
    print("scale(4) =", scale(4));

    // higher-order: pass lambda to function
    let squared = map_arr([1, 2, 3, 4], fn(x) => x * x);
    print("squared =", squared);

    // nested application
    print("apply_twice(double, 5) =", apply_twice(double, 5));

    return squared[3];
}
```

Output (engine #1):

```text
double(21) = 42
scale(4) = 50
squared = [1, 4, 9, 16]
apply_twice(double, 5) = 20
```

`main` returns `16` (`squared[3]`).

Analysis:

- two forms of a lambda: `fn(x) => expr` and `fn(x) { ... }`;
- lambdas are values: they are passed into functions (`map_arr`, `apply_twice`);
- `for (let item in arr)` — iterating over an array;
- closures: a lambda may use variables from the enclosing scope.

Engine #2: the example compiles to valid WASM (lambdas → functions +
`call_indirect`, an env with the captures), but **execution on #2 is not supported
in the IDE**; besides, `print` of arrays prints a pointer, and `main` may return an
unexpected value in #2 — lambdas in #2 only have an `i32` result, and float
results/captures break. For portable code use lambdas with integer
parameters/results and no float captures.

## What to keep in mind

- Higher-order functions in Latent work through function values (a pointer to a
  closure); in engine #2 that is `[table_slot][env_ptr]` and `call_indirect`.
- `print` of a lambda/array in #2 gives a pointer — do not use it as "data output".
- A lambda return annotation (`fn(x) -> int { ... }`) is syntactically allowed, but
  in #2 the result is always `i32` (see
  [codegen internals](../specs/internals-codegen.md#lambdas-and-closures)).

## Related sections

- [Basics](./basics.md) · [Algorithms](./algorithms.md)
- [Types → lambdas](../reference/types.md) ·
  [Operators](../reference/operators.md)
- [Engines](../specs/engines.md)
