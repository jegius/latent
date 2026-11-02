// Единый корпус программ selfhost-компилятора для дифференциальных тестов и
// инструментального покрытия (tooling/selfhost-coverage).
//
// Данные лежат в corpus/*.mjs (файлы <300 строк), тесты и coverage-runner
// импортируют корпус только отсюда.
export { FEATURE_CASES } from "./corpus/feature-cases.mjs";
export { COVERAGE_CASES } from "./corpus/coverage-cases.mjs";
export { PARITY_OK_CASES, PARITY_ERROR_CASES } from "./corpus/parity-cases.mjs";
export { LEXER_SNIPPETS } from "./corpus/lexer-snippets.mjs";
export { SCOPING_PROGRAMS } from "./corpus/scoping-programs.mjs";
