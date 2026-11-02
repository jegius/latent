// killer-programs.js — the exact Latent sources executed by engine #1 in the
// concurrency demo, plus the JavaScript equivalents shown side by side.
// They are kept as strings (not fetched .lat files) so the page works offline
// from any sub-path and build-demos never tries to compile host-only code with
// engine #2.

export const LATENT = {
  fanin: `// CSP-style concurrency: producer/consumer via channels

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

fn worker(ch: channel, n: int) {
    let sum = 0;
    for (let i = 1; i <= n; i = i + 1) {
        sum = sum + i;
    }
    ch.send(sum);
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
}`,

  parallel: `// Map-reduce: 4 воркера считают сумму квадратов своего куска.
fn worker(data: [int], start: int, end: int, ch: channel) {
    let sum = 0;
    let i = start;
    while (i < end) {
        sum = sum + data[i] * data[i];
        i = i + 1;
        if (i % 50 == 0) { yield; }
    }
    ch.send(sum);
}

fn main() -> int {
    let data = [];
    for (let i = 1; i <= 400; i = i + 1) {
        data.push(i);
    }
    let ch = channel();
    let workers = 4;
    let chunk = data.length / workers;
    for (let w = 0; w < workers; w = w + 1) {
        spawn worker(data, w * chunk, w * chunk + chunk, ch);
    }
    let total = 0;
    for (let w = 0; w < workers; w = w + 1) {
        let partial = ch.recv();
        print("worker", w, "partial:", partial);
        total = total + partial;
    }
    print("total sum of squares:", total);
    return total;
}`,

  pool: `// Worker pool: N воркеров берут задачи из общего канала.
fn worker(id: int, jobs: channel, results: channel) {
    let done = 0;
    while (done < 3) {
        let job = jobs.recv();
        let acc = 0;
        let i = 0;
        while (i < job * 50) {
            acc = acc + i;
            i = i + 1;
            if (i % 25 == 0) { yield; }
        }
        results.send(id * 1000 + acc);
        done = done + 1;
    }
    print("worker", id, "finished");
}

fn main() -> int {
    let jobs = channel();
    let results = channel();
    let workers = 4;
    for (let w = 0; w < workers; w = w + 1) {
        spawn worker(w, jobs, results);
    }
    let j = 0;
    while (j < workers * 3) {
        jobs.send(j);
        j = j + 1;
    }
    let got = 0;
    while (got < workers * 3) {
        let r = results.recv();
        got = got + 1;
    }
    print("results collected:", got);
    return got;
}`,

  select: `// Select: ожидание сразу нескольких каналов.
fn producer(ch: channel, n: int, base: int) {
    let i = 0;
    while (i < n) {
        ch.send(base + i);
        i = i + 1;
    }
    print("producer", base, "done");
}

fn main() -> int {
    let a = channel();
    let b = channel();
    spawn producer(a, 6, 0);
    spawn producer(b, 6, 100);
    let sa = 0;
    let sb = 0;
    let n = 0;
    while (n < 12) {
        select {
            case v <- a: { sa = sa + 1; }
            case v <- b: { sb = sb + 1; }
        }
        n = n + 1;
    }
    print("select counts: A =", sa, "B =", sb);
    return sa;
}`,

  hello: `// 1000 горутин: каждая отправляет свой id в общий канал.
fn hello(ch: channel, id: int) {
    ch.send(id);
}

fn main() -> int {
    let ch = channel();
    let n = 1000;
    for (let i = 0; i < n; i = i + 1) {
        spawn hello(ch, i);
    }
    let count = 0;
    let sum = 0;
    while (count < n) {
        sum = sum + ch.recv();
        count = count + 1;
    }
    print("goroutines:", count, "sum:", sum);
    return count;
}`,

  deadlock: `// Дедлок: потребитель ждёт сообщение, которое никто не отправит.
fn consumer(ch: channel) {
    let v = ch.recv();
    print("never printed:", v);
}

fn main() -> int {
    let ch = channel();
    spawn consumer(ch);
    print("main: waiting for a message nobody sends");
    return 0;
}`,

  yield: `// yield: кооперативная передача управления другой задаче.
fn worker(id: int) {
    let i = 0;
    while (i < 3) {
        print("worker", id, "step", i);
        yield;
        i = i + 1;
    }
}

fn main() -> int {
    spawn worker(1);
    spawn worker(2);
    spawn worker(3);
    yield;
    print("main: after yield");
    return 0;
}`,
};

export const JAVASCRIPT = {
  fanin: `// JS: канал — это массив + опрос; горутины — промисы.
const queue = [];

async function producer(count) {
  for (let i = 1; i <= count; i += 1) {
    console.log('producing', i);
    queue.push(i * i);
  }
}

async function consumer(count) {
  let received = 0;
  let sum = 0;
  while (received < count) {
    if (queue.length === 0) {
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    const v = queue.shift();
    console.log('consumed', v);
    sum += v;
    received += 1;
  }
  console.log(\`consumer finished: \${received} items, sum = \${sum}\`);
}

async function worker(n) {
  let sum = 0;
  for (let i = 1; i <= n; i += 1) sum += i;
  return sum;
}

await Promise.all([producer(5), consumer(5)]);
const total = (await Promise.all([worker(10), worker(20), worker(30)]))
  .reduce((a, b) => a + b, 0);
console.log('fan-in total:', total);`,

  parallel: `// JS: те же 4 куска, но планировщик — event loop.
const data = Array.from({ length: 400 }, (_, i) => i + 1);
const WORKERS = 4;
const chunk = data.length / WORKERS;

function partial(start, end) {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += data[i] * data[i];
  return sum;
}

const parts = await Promise.all(
  Array.from({ length: WORKERS }, (_, w) =>
    new Promise((resolve) => resolve(partial(w * chunk, (w + 1) * chunk)))),
);
const total = parts.reduce((a, b) => a + b, 0);
console.log('total sum of squares:', total);`,

  pool: `// JS: worker pool на промисах и общем курсоре задач.
const jobs = Array.from({ length: 12 }, (_, i) => i);
let cursor = 0;
const results = [];

async function worker(id) {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    let acc = 0;
    for (let i = 0; i < job * 50; i += 1) acc += i;
    results.push(id * 1000 + acc);
    if (results.length % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  console.log(\`worker \${id} finished\`);
}

await Promise.all([0, 1, 2, 3].map((id) => worker(id)));
console.log('results collected:', results.length);`,

  select: `// JS: select приходится собирать из Promise.race и наблюдателей.
function channel() {
  const queue = [];
  const waiters = [];
  return {
    send(v) {
      if (waiters.length) waiters.shift()(v);
      else queue.push(v);
    },
    recv() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    ready() {
      return queue.length ? Promise.resolve(queue.shift()) : new Promise(() => {});
    },
  };
}

const a = channel();
const b = channel();
const producer = async (ch, n, base) => {
  for (let i = 0; i < n; i += 1) {
    ch.send(base + i);
    await new Promise((r) => setTimeout(r, 0));
  }
};
const pa = producer(a, 6, 0);
const pb = producer(b, 6, 100);
let sa = 0;
let sb = 0;
for (let n = 0; n < 12; n += 1) {
  const winner = await Promise.race([
    a.ready().then(() => 'a'), b.ready().then(() => 'b'),
  ]);
  if (winner === 'a') sa += 1; else sb += 1;
}
console.log('select counts: A =', sa, 'B =', sb);
await Promise.all([pa, pb]);`,

  hello: `// JS: 1000 «горутин» — это 1000 промисов в Promise.all.
const received = [];
async function hello(id) {
  await new Promise((r) => setTimeout(r, 0));
  received.push(id);
}
await Promise.all(Array.from({ length: 1000 }, (_, i) => hello(i)));
console.log('goroutines:', received.length,
  'sum:', received.reduce((a, b) => a + b, 0));`,

  deadlock: `// JS: ожидание недоступного ресурса не детектируется —
// промис просто висит, пока процесс не завершат извне.
function consumer() {
  return new Promise(() => {
    // никогда не resolve: эквивалент recv() на пустом канале
  });
}
consumer();
console.log('main: waiting for a message nobody sends');
// процесса не будет: deadlock не виден рантайму`,

  yield: `// JS: yield — это await, а очередь задач — микротаски event loop.
async function worker(id) {
  for (let i = 0; i < 3; i += 1) {
    console.log(\`worker \${id} step \${i}\`);
    await new Promise((r) => setTimeout(r, 0));
  }
}
const all = [worker(1), worker(2), worker(3)];
await new Promise((r) => setTimeout(r, 0));
console.log('main: after yield');
await Promise.all(all);`,
};
