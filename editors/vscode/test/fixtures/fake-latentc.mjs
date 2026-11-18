#!/usr/bin/env node
// Фейковый CLI latentc для тестов runner.compileWithCli.
//
// Использование: node fake-latentc.mjs compile <in.lat> <out.wasm>
// Если исходник содержит CLI_ERROR, печатает русскую ошибку с позицией и
// завершается с кодом 1. Иначе пишет минимальный валидный WASM (8 байт).

import fs from 'node:fs';
import process from 'node:process';

const [command, input, output] = process.argv.slice(2);

if (command !== 'compile') {
    process.stderr.write(`неизвестная команда: ${command}\n`);
    process.exit(2);
}
if (!input || !fs.existsSync(input)) {
    process.stderr.write(`cannot read ${input}\n`);
    process.exit(1);
}
if (!output) {
    process.stderr.write('не задан выходной файл\n');
    process.exit(1);
}

const source = fs.readFileSync(input, 'utf8');
if (source.includes('CLI_ERROR')) {
    process.stderr.write("error: Несовпадение типов на строке 2:5: ожидалось 'float', найдено 'string'\n");
    process.exit(1);
}
if (source.includes('NO_OUTPUT')) {
    process.stdout.write('компиляция прошла, но файл не создан\n');
    process.exit(0);
}

fs.writeFileSync(output, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
process.stdout.write(`${input} -> ${output} (8 bytes)\n`);
