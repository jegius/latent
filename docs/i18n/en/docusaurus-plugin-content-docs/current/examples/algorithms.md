---
title: "Algorithms: recursion and sorting"
sidebar_label: Algorithms
sidebar_position: 3
description: "Walkthroughs of the recursion.lat and sorting.lat examples: recursion, mutual recursion, bubble sort, binary search; the output in the web IDE."
---

# Algorithms

## `recursion.lat` — recursion and mutual recursion

`web-ide/examples/recursion.lat`:

```latent
// Recursive functions: factorial, fibonacci, ackermann

fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

fn fib(n: int) -> int {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

fn ackermann(m: int, n: int) -> int {
    if (m == 0) {
        return n + 1;
    }
    if (n == 0) {
        return ackermann(m - 1, 1);
    }
    return ackermann(m - 1, ackermann(m, n - 1));
}

fn main() -> int {
    print("factorial(10) =", factorial(10));
    print("fib(20) =", fib(20));
    print("ackermann(2, 3) =", ackermann(2, 3));

    // Mutual recursion: is_even / is_odd
    print("is_even(10) =", is_even(10));
    print("is_odd(7) =", is_odd(7));

    return 0;
}

fn is_even(n: int) -> bool {
    if (n == 0) {
        return true;
    }
    return is_odd(n - 1);
}

fn is_odd(n: int) -> bool {
    if (n == 0) {
        return false;
    }
    return is_even(n - 1);
}
```

Output in the web IDE (engine #1):

```text
factorial(10) = 3628800
fib(20) = 6765
ackermann(2, 3) = 9
is_even(10) = true
is_odd(7) = true
```

Analysis:

- functions are **hoisted**: `main` calls `is_even`/`is_odd`, which are declared
  after it — that is fine for engine #2 as well;
- mutual recursion works (the signatures of both functions are registered before
  the bodies are parsed);
- `bool` return: engine #1 prints `true`/`false`, #2 prints `1`/`0`;
- recursion without a return annotation is also allowed, but then the function
  yields an `i32` result (see [types](../reference/types.md)).

Engine #2: the example compiles to valid WASM; arithmetic and comparisons behave
as described in [operators](../reference/operators.md).

## `sorting.lat` — sorting and binary search

`web-ide/examples/sorting.lat`:

```latent
// Classic algorithms: bubble sort + binary search

fn bubble_sort(arr: [int]) -> [int] {
    let n = arr.length;
    for (let i = 0; i < n; i = i + 1) {
        for (let j = 0; j < n - i - 1; j = j + 1) {
            if (arr[j] > arr[j + 1]) {
                let tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    return arr;
}

fn binary_search(arr: [int], target: int) -> int {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
        let mid = (lo + hi) / 2;
        if (arr[mid] == target) {
            return mid;
        }
        if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

fn main() -> int {
    let data = [64, 34, 25, 12, 22, 11, 90];
    print("original:", data);

    let sorted = bubble_sort(data);
    print("sorted:  ", sorted);

    let idx = binary_search(sorted, 22);
    print("binary_search(22) -> index", idx);

    let missing = binary_search(sorted, 100);
    print("binary_search(100) -> index", missing);

    return 0;
}
```

Output (engine #1):

```text
original: [64, 34, 25, 12, 22, 11, 90]
sorted:   [11, 12, 22, 25, 34, 64, 90]
binary_search(22) -> index 2
binary_search(100) -> index -1
```

Analysis:

- the array is passed by reference and mutated in place: `bubble_sort(data)` sorts
  `data` and returns the same pointer;
- `arr[j] = arr[j + 1]` — an assignment into an index (in #2 — `i32.store`);
- `(lo + hi) / 2` — an important detail: in engine #1 division is always float,
  but in this example the sums `lo + hi` are even, so `mid` comes out an integer
  and the search works. In the general case, with an odd sum, `arr[1.5]` has an
  `undefined` effect and the search breaks. In engine #2 division is integer
  (`i32.div_s`) and there is no such problem; for portable code rely on #2
  semantics or use an `int(...)` cast in #1;
- `-1` standing for "not found" is a convention of the example.

Engine #2: the example compiles; the array is printed as a pointer (see
[engines](../specs/engines.md)). If you need readable output in #2, print the
elements in a loop.

## Notes for porting to engine #2

- The division `(lo + hi) / 2` in #2 is integer; make sure that is the behavior
  you want.
- Array comparison with `==` in #2 is by pointer; for a search, compare element by
  element.
- `print(arr)` in #2 prints the pointer, not the contents.

## Related sections

- [Basics](./basics.md) — arrays, loops, functions.
- [Functional style](./functional.md) — map/filter/reduce.
- [Operators](../reference/operators.md) — division and comparisons.
