// Формирование отчёта о покрытии: JSON (машиночитаемый) + Markdown (для людей).

function pct(covered, total) {
  if (total === 0) return 100;
  return Math.round((covered / total) * 10000) / 100;
}

function byPart(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.part)) map.set(it.part, { part: it.part, total: 0, covered: 0 });
    map.get(it.part).total++;
    if (it.hits > 0) map.get(it.part).covered++;
  }
  return [...map.values()]
    .map((p) => ({ ...p, percent: pct(p.covered, p.total) }))
    .sort((a, b) => a.part.localeCompare(b.part));
}

/**
 * @param {{
 *   source:{path:string, mode:string, parts:string[], bytes:number, sha256:string},
 *   builder:{kind:string, path:string|null, bytes:number, stale?:boolean, reason?:string},
 *   instrumentation:{lines:boolean, functions:number, lineCounters:number,
 *                    counterBase:number, lineCounterBase:number, bytes:number},
 *   functions:{id:number,name:string,part:string,file:string,line:number,endLine:number}[],
 *   functionHits:number[],
 *   lines:{id:number,functionId:number,functionName:string,part:string,line:number,text:string}[],
 *   lineHits:number[],
 *   corpus:{name:string,kind:string,ok:boolean,trapped:boolean,error?:string}[],
 *   fidelity:{checked:number,mismatches:{name:string,reason:string}[]},
 *   gate:{min:number},
 * }} data
 */
export function buildReport(data) {
  const functions = data.functions.map((f, i) => ({ ...f, hits: data.functionHits[i] ?? 0 }));
  const fnSummary = {
    total: functions.length,
    covered: functions.filter((f) => f.hits > 0).length,
    uncovered: functions.filter((f) => f.hits === 0).map(({ id, name, part, file, line }) => ({ id, name, part, file, line })),
  };
  fnSummary.percent = pct(fnSummary.covered, fnSummary.total);
  fnSummary.byPart = byPart(functions);

  let lineSummary = null;
  if (data.lines.length > 0) {
    const lines = data.lines.map((l, i) => ({ ...l, hits: data.lineHits[i] ?? 0 }));
    lineSummary = {
      total: lines.length,
      covered: lines.filter((l) => l.hits > 0).length,
      uncovered: lines
        .filter((l) => l.hits === 0)
        .map(({ id, functionName, part, line, text }) => ({ id, functionName, part, line, text })),
    };
    lineSummary.percent = pct(lineSummary.covered, lineSummary.total);
    lineSummary.byPart = byPart(lines);
  }

  const corpus = {
    total: data.corpus.length,
    byKind: {},
    ok: data.corpus.filter((c) => c.ok).length,
    failed: data.corpus.filter((c) => !c.ok).length,
    trapped: data.corpus.filter((c) => c.trapped).length,
    timedOut: data.corpus.filter((c) => c.timeout).length,
  };
  for (const c of data.corpus) corpus.byKind[c.kind] = (corpus.byKind[c.kind] ?? 0) + 1;

  const passed = fnSummary.percent >= data.gate.min;
  return {
    tool: "selfhost-coverage",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: data.source,
    builder: data.builder,
    instrumentation: data.instrumentation,
    corpus,
    functions: fnSummary,
    lines: lineSummary,
    fidelity: data.fidelity,
    gate: { min: data.gate.min, metric: "functions", passed },
    corpusCases: data.corpus,
    notes: [
      "Покрытие функций: счётчик в начале каждой функции верхнего уровня shc.lat; вызов ≥1 раз = функция покрыта.",
      "Счётчики лежат в линейной памяти по адресам 32768..65535 (см. README инструмента).",
      "Ошибочные программы корпуса тоже дают покрытие: компилятор проходит лексер/парсер/тайп-чек.",
      "Строчное покрытие (при --lines) приблизительное: счётчик ставится в начало инструкции верхнего уровня функции.",
    ],
  };
}

function bar(percent) {
  const n = Math.round(percent / 5);
  return `\`${"#".repeat(n)}${".".repeat(20 - n)}\` ${percent}%`;
}

export function renderMarkdown(report, commands = {}) {
  const l = [];
  l.push("# Покрытие self-hosted компилятора Latent");
  l.push("");
  l.push("> Отчёт сгенерирован `tooling/selfhost-coverage/run.mjs`. Не редактировать вручную.");
  l.push("");
  l.push(`* Исходник: \`${report.source.path}\` (${report.source.bytes} байт, sha256 \`${report.source.sha256.slice(0, 16)}…\`, режим \`${report.source.mode}\`)`);
  l.push(`* Сборщик инструментированного компилятора: \`${report.builder.kind}\`${report.builder.path ? ` (\`${report.builder.path}\`)` : ""}, ${report.builder.bytes} байт`);
  if (report.builder.stale) l.push(`* ВНИМАНИЕ: ${report.builder.reason}`);
  l.push(`* Инструментация: функций ${report.instrumentation.functions}, строчных счётчиков ${report.instrumentation.lineCounters}, база ${report.instrumentation.counterBase}${report.instrumentation.lines ? `, строки с ${report.instrumentation.lineCounterBase}` : ""}`);
  l.push(`* Корпус: ${report.corpus.total} программ (${Object.entries(report.corpus.byKind).map(([k, v]) => `${k}=${v}`).join(", ")}); успешно ${report.corpus.ok}, с ошибкой компиляции ${report.corpus.failed}, трапов ${report.corpus.trapped}, таймаутов ${report.corpus.timedOut}`);
  l.push(`* Fidelity инструментации: проверено ${report.fidelity.checked}, расхождений ${report.fidelity.mismatches.length}`);
  l.push("");
  l.push("## Функции");
  l.push("");
  l.push(`**Покрыто ${report.functions.covered} из ${report.functions.total} (${report.functions.percent}%)**`);
  l.push("");
  l.push(`Порог --min ${report.gate.min}%: ${report.gate.passed ? "PASS" : "FAIL"}`);
  l.push("");
  l.push("| Часть | Покрыто | Всего | % |");
  l.push("|---|---:|---:|---:|");
  for (const p of report.functions.byPart) {
    l.push(`| \`${p.part}\` | ${p.covered} | ${p.total} | ${p.percent}% |`);
  }
  l.push("");
  l.push("```");
  l.push(`function coverage ${bar(report.functions.percent)}`);
  if (report.lines) l.push(`line coverage     ${bar(report.lines.percent)}`);
  l.push("```");
  l.push("");

  if (report.lines) {
    l.push("## Строки (приблизительно)");
    l.push("");
    l.push(`**Покрыто ${report.lines.covered} из ${report.lines.total} (${report.lines.percent}%)** — счётчик стоит в начале инструкции; многострочные выражения считаются по первой строке.`);
    l.push("");
  }

  l.push("## Непокрытые функции");
  l.push("");
  if (report.functions.uncovered.length === 0) {
    l.push("Все функции вызваны хотя бы один раз.");
  } else {
    l.push("| Функция | Часть | Строка |");
    l.push("|---|---|---:|");
    for (const f of report.functions.uncovered) {
      l.push(`| \`${f.name}\` | \`${f.part}\` | ${f.line} |`);
    }
  }
  l.push("");

  if (report.fidelity.mismatches.length > 0) {
    l.push("## Расхождения fidelity (инструментация изменила вывод!)");
    l.push("");
    for (const m of report.fidelity.mismatches) l.push(`* ${m.name}: ${m.reason}`);
    l.push("");
  }

  l.push("## Корпус");
  l.push("");
  const byKind = {};
  for (const c of report.corpusCases) {
    byKind[c.kind] ??= [];
    byKind[c.kind].push(c);
  }
  for (const [kind, cases] of Object.entries(byKind)) {
    const ok = cases.filter((c) => c.ok).length;
    l.push(`* **${kind}**: ${cases.length} (ok ${ok}, fail ${cases.length - ok})`);
  }
  l.push("");
  l.push("## Команды");
  l.push("");
  l.push("```sh");
  l.push(commands.run ?? "node tooling/selfhost-coverage/run.mjs");
  l.push("```");
  l.push("");
  l.push("Методика и ограничения: `tooling/selfhost-coverage/README.md`.");
  l.push("");
  return l.join("\n");
}
