// examples.js — коллекция примеров кода на языке Latent.
// Каждый пример демонстрирует одну или несколько реализованных фич языка.
// Используется контроллером IDE для заполнения выпадающего списка «Examples».

/**
 * @typedef {Object} Example
 * @property {string} id — машинный идентификатор
 * @property {string} title — название в списке
 * @property {string} description — краткое описание фичи
 * @property {string} code — исходный код примера
 * @property {boolean} [needsAI] — требуется ли кнопка «Compile & Run with AI»
 */

/** @type {Example[]} */
export const EXAMPLES = [
    {
        id: 'parallel-sum',
        title: '⚡ Parallel Map-Reduce (spawn + channel)',
        description: 'Параллельная сумма квадратов через 4 горутины и канал',
        code: `// Parallel sum of squares across 4 goroutines (spawn + channel)

fn worker(data: [int], start: int, end: int, ch: channel) {
    let sum = 0;
    for (let i = start; i < end; i = i + 1) {
        sum = sum + data[i] * data[i];
    }
    ch.send(sum);
}

fn main() -> int {
    // Build a large array: [1, 2, ..., 1000]
    let data = [];
    for (let i = 1; i <= 1000; i = i + 1) {
        data.push(i);
    }

    let ch = channel();
    let workers = 4;
    let chunk = data.length / workers;

    // Spawn 4 goroutines, each sums squares of its chunk
    for (let w = 0; w < workers; w = w + 1) {
        let start = w * chunk;
        let end = start + chunk;
        spawn worker(data, start, end, ch);
    }

    // Collect partial sums from all workers
    let total = 0;
    for (let w = 0; w < workers; w = w + 1) {
        let partial = ch.recv();
        print("Worker", w, "partial sum of squares:", partial);
        total = total + partial;
    }

    print("Total sum of squares 1^2..1000^2:", total);
    return total;
}
`,
    },

    {
        id: 'recursion',
        title: '🔁 Recursion (factorial, fibonacci, ackermann)',
        description: 'Рекурсивные функции: факториал, Фибоначчи, Аккерман',
        code: `// Recursive functions: factorial, fibonacci, ackermann

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
`,
    },

    {
        id: 'arrays',
        title: '📊 Arrays & Methods (push, pop, length, concat)',
        description: 'Литералы, индексация, методы push/pop/length, конкатенация',
        code: `// Arrays: literals, indexing, methods, concatenation

fn main() -> int {
    // Array literal and indexing
    let primes = [2, 3, 5, 7, 11, 13];
    print("primes:", primes);
    print("primes[0] =", primes[0]);
    print("primes.length =", primes.length);

    // Index assignment
    primes[0] = 17;
    print("after primes[0] = 17:", primes);

    // push / pop
    let stack = [];
    stack.push(1);
    stack.push(2);
    stack.push(3);
    print("stack after pushes:", stack);
    let top = stack.pop();
    print("popped:", top, "stack:", stack);

    // Array concatenation with +
    let a = [1, 2, 3];
    let b = [4, 5, 6];
    let c = a + b;
    print("a + b =", c);

    // Nested arrays
    let matrix = [[1, 2], [3, 4], [5, 6]];
    print("matrix[1][0] =", matrix[1][0]);

    // Build array in a loop
    let squares = [];
    for (let i = 1; i <= 10; i = i + 1) {
        squares.push(i * i);
    }
    print("squares 1..10:", squares);

    // Sum via while loop
    let sum = 0;
    let i = 0;
    while (i < squares.length) {
        sum = sum + squares[i];
        i = i + 1;
    }
    print("sum of squares:", sum);

    return sum;
}
`,
    },

    {
        id: 'strings',
        title: '🔤 Strings (concat, length, comparison)',
        description: 'Строковые литералы, конкатенация, длина, сравнение',
        code: `// Strings: literals, concatenation, length, comparison

fn greet(name: string) -> string {
    return "Hello, " + name + "!";
}

fn main() -> int {
    let greeting = greet("Latent");
    print(greeting);

    // String concatenation with numbers
    let version = "v" + 1 + "." + 0;
    print("version:", version);

    // String length
    let text = "functional vibes";
    print("length of", "\"" + text + "\" =", text.length);

    // String comparison
    let a = "apple";
    let b = "banana";
    if (a == b) {
        print("strings are equal");
    } else {
        print(a, "!=", b);
    }

    // Building strings in a loop
    let stars = "";
    for (let i = 0; i < 5; i = i + 1) {
        stars = stars + "*";
    }
    print("stars:", stars);

    // Escape sequences
    print("line1\\nline2\\t(tabbed)");

    return 0;
}
`,
    },

    {
        id: 'control-flow',
        title: '🔀 Control Flow (if/else, while, for, logic ops)',
        description: 'Условия, циклы, логические операторы && || !',
        code: `// Control flow: if/else if/else, while, for, logical operators

fn classify(n: int) -> string {
    if (n < 0) {
        return "negative";
    } else if (n == 0) {
        return "zero";
    } else if (n < 10) {
        return "small positive";
    } else {
        return "large positive";
    }
}

fn fizzbuzz(n: int) {
    for (let i = 1; i <= n; i = i + 1) {
        if (i % 15 == 0) {
            print("FizzBuzz");
        } else if (i % 3 == 0) {
            print("Fizz");
        } else if (i % 5 == 0) {
            print("Buzz");
        } else {
            print(i);
        }
    }
}

fn main() -> int {
    print(classify(-5));
    print(classify(0));
    print(classify(7));
    print(classify(42));

    // Logical operators: && || !
    let x = 7;
    if (x > 0 && x < 10) {
        print(x, "is a single-digit positive number");
    }
    if (x < 0 || x > 5) {
        print(x, "is either negative or greater than 5");
    }
    if (!(x == 0)) {
        print(x, "is not zero");
    }

    // While loop: collatz sequence length
    let n = 27;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    print("collatz(27) reaches 1 in", steps, "steps");

    // FizzBuzz up to 15
    fizzbuzz(15);

    return steps;
}
`,
    },

    {
        id: 'sorting',
        title: '🔢 Sorting (bubble sort, binary search)',
        description: 'Классические алгоритмы: пузырьковая сортировка и бинарный поиск',
        code: `// Classic algorithms: bubble sort + binary search

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
`,
    },

    {
        id: 'channels',
        title: '📡 Channels & Goroutines (producer/consumer)',
        description: 'CSP-примитивы: channel, send, recv, spawn',
        code: `// CSP-style concurrency: producer/consumer via channels

fn producer(ch: channel, count: int) {
    for (let i = 1; i <= count; i = i + 1) {
        print("producing", i);
        ch.send(i * i);
    }
}

fn consumer(ch: channel, count: int) {
    let received = 0;
    let sum = 0;
    while (received < count) {
        let v = ch.recv();
        print("consumed", v);
        sum = sum + v;
        received = received + 1;
    }
    print("consumer finished:", received, "items, sum =", sum);
}

fn main() -> int {
    let ch = channel();

    spawn producer(ch, 5);
    spawn consumer(ch, 5);

    // Fan-in: multiple producers, one channel
    let results = channel();
    spawn worker(results, 10);
    spawn worker(results, 20);
    spawn worker(results, 30);

    let total = 0;
    for (let i = 0; i < 3; i = i + 1) {
        total = total + results.recv();
    }
    print("fan-in total:", total);

    return total;
}

fn worker(ch: channel, n: int) {
    let sum = 0;
    for (let i = 1; i <= n; i = i + 1) {
        sum = sum + i;
    }
    ch.send(sum);
}
`,
    },

    {
        id: 'ai-infer',
        title: '🤖 AI Inference (ai_infer)',
        description: 'Вызов AI-модели для анализа данных',
        needsAI: true,
        code: `// AI inference: ask the model to analyze computed results
// Run with "🤖 Compile & Run with AI"

fn main() -> int {
    // Compute some statistics
    let data = [12, 45, 7, 89, 23, 56, 91, 34];
    let sum = 0;
    for (let i = 0; i < data.length; i = i + 1) {
        sum = sum + data[i];
    }
    let mean = sum / data.length;
    print("data:", data);
    print("mean:", mean);

    // AI inference: analyze the dataset
    let analysis = ai_infer("gpt-4", "Analyze this dataset: [12, 45, 7, 89, 23, 56, 91, 34] with mean 44.625");
    print("AI analysis:", analysis);

    // AI inference: suggest an algorithm
    let suggestion = ai_infer("gpt-4", "Suggest a sorting algorithm for nearly-sorted data");
    print("AI suggestion:", suggestion);

    return 0;
}
`,
    },

    {
        id: 'ai-embed',
        title: '🧬 AI Embeddings (ai_embed)',
        description: 'Векторные представления текста и косинусное сходство',
        needsAI: true,
        code: `// AI embeddings: vector representations + cosine similarity
// Run with "🤖 Compile & Run with AI"

fn dot(a: [float], b: [float]) -> float {
    let sum = 0;
    for (let i = 0; i < a.length; i = i + 1) {
        sum = sum + a[i] * b[i];
    }
    return sum;
}

fn magnitude(v: [float]) -> float {
    let sum = 0;
    for (let i = 0; i < v.length; i = i + 1) {
        sum = sum + v[i] * v[i];
    }
    // sqrt approximation via Newton's method
    let x = sum;
    let guess = x / 2;
    for (let i = 0; i < 20; i = i + 1) {
        guess = (guess + x / guess) / 2;
    }
    return guess;
}

fn cosine_similarity(a: [float], b: [float]) -> float {
    return dot(a, b) / (magnitude(a) * magnitude(b));
}

fn main() -> int {
    let v1 = ai_embed("parallel map-reduce sum of squares");
    let v2 = ai_embed("concurrent reduction with goroutines");
    let v3 = ai_embed("recipe for chocolate cake");

    print("embedding dims:", v1.length);
    print("v1[0..3]: [", v1[0], v1[1], v1[2], v1[3], "]");

    let sim_related = cosine_similarity(v1, v2);
    let sim_unrelated = cosine_similarity(v1, v3);

    print("similarity(related texts):  ", sim_related);
    print("similarity(unrelated texts):", sim_unrelated);

    return 0;
}
`,
    },

    {
        id: 'ai-agents',
        title: '🤖⚡ AI + Goroutines (parallel AI pipeline)',
        description: 'Комбинация AI-вызовов и параллельных вычислений',
        needsAI: true,
        code: `// AI + Goroutines: parallel computation with AI-powered analysis
// Run with "🤖 Compile & Run with AI"

fn worker(data: [int], start: int, end: int, ch: channel) {
    let sum = 0;
    for (let i = start; i < end; i = i + 1) {
        sum = sum + data[i] * data[i];
    }
    ch.send(sum);
}

fn main() -> int {
    // Build a large array: [1, 2, ..., 1000]
    let data = [];
    for (let i = 1; i <= 1000; i = i + 1) {
        data.push(i);
    }

    // Parallel sum of squares across 4 goroutines
    let ch = channel();
    let workers = 4;
    let chunk = data.length / workers;
    for (let w = 0; w < workers; w = w + 1) {
        let start = w * chunk;
        let end = start + chunk;
        spawn worker(data, start, end, ch);
    }

    let total = 0;
    for (let w = 0; w < workers; w = w + 1) {
        let partial = ch.recv();
        print("Worker", w, "partial sum of squares:", partial);
        total = total + partial;
    }
    print("Total sum of squares 1^2..1000^2:", total);

    // AI inference: ask AI to analyze the computed result
    let insight = ai_infer("gpt-4", "Analyze parallel sum of squares result 333833500");
    print("AI Insight:", insight);

    // AI embeddings: vector representation of the algorithm description
    let vec = ai_embed("parallel map-reduce sum of squares");
    print("Embedding (first 4 dims): [", vec[0], vec[1], vec[2], vec[3], "]");

    return total;
}
`,
    },

    {
        id: 'fp-patterns',
        title: 'λ FP Patterns (map, filter, reduce)',
        description: 'Функциональные паттерны: map, filter, reduce над массивами',
        code: `// Functional patterns: map, filter, reduce over arrays

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
`,
    },

    {
        id: 'edge-cases',
        title: '🧪 Edge Cases (empty arrays, null, unary ops)',
        description: 'Граничные случаи: пустые массивы, null, унарные операторы',
        code: `// Edge cases: empty arrays, null handling, unary operators

fn safe_sum(arr: [int]) -> int {
    if (arr.length == 0) {
        print("warning: empty array, returning 0");
        return 0;
    }
    let sum = 0;
    for (let i = 0; i < arr.length; i = i + 1) {
        sum = sum + arr[i];
    }
    return sum;
}

fn main() -> int {
    // Empty array
    let empty = [];
    print("empty array:", empty, "length:", empty.length);
    print("safe_sum(empty):", safe_sum(empty));

    // Null value
    let nothing = null;
    print("null value:", nothing);
    if (nothing == null) {
        print("nothing is null");
    }

    // Unary operators
    let x = 5;
    print("-x =", -x);
    print("!true =", !true);
    print("!false =", !false);
    print("!0 =", !0);
    print("!1 =", !1);

    // Boolean logic short-circuit
    let result = false && (1 / 0 > 0);
    print("false && (1/0 > 0):", result, "(short-circuit, no error)");

    result = true || (1 / 0 > 0);
    print("true || (1/0 > 0):", result, "(short-circuit, no error)");

    // Deep equality of arrays
    let a = [1, [2, 3], 4];
    let b = [1, [2, 3], 4];
    let c = [1, [2, 3], 5];
    print("a == b:", a == b);
    print("a == c:", a == c);
    print("a != c:", a != c);

    // Modulo and integer division
    print("17 % 5 =", 17 % 5);
    print("17 / 5 =", 17 / 5);

    return 0;
}
`,
    },
];

/**
 * Возвращает пример по идентификатору.
 * @param {string} id
 * @returns {Example|undefined}
 */
export function getExampleById(id) {
    return EXAMPLES.find(e => e.id === id);
}
