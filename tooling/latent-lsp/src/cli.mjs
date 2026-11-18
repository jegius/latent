// tooling/latent-lsp/src/cli.mjs — разбор аргументов командной строки.
//
// Сервер поддерживает только `--stdio` (JSON-RPC поверх stdin/stdout).
// Опции:
//   --compiler-wasm <path>  путь к web-ide/compiler.wasm (env LATENT_COMPILER_WASM)
//   --language-data <path>  путь к tooling/language-data/language.json
//   --log <path>            файл лога (по умолчанию stderr)
//   --help, -h              справка
//   --version, -v           версия сервера

/** Версия сервера. */
export const SERVER_VERSION = '1.0.0';

/** Текст справки. */
export const USAGE = `latent-lsp ${SERVER_VERSION} — Language Server для языка Latent

Использование:
  node bin/server.mjs --stdio [опции]

Обязательные опции:
  --stdio                     транспорт JSON-RPC 2.0 через stdin/stdout

Необязательные опции:
  --compiler-wasm <path>      путь к compiler.wasm (по умолчанию web-ide/compiler.wasm,
                              переопределяется env LATENT_COMPILER_WASM)
  --language-data <path>      путь к tooling/language-data/language.json
                              (переопределяется env LATENT_LANGUAGE_DATA)
  --log <path>                писать лог в файл (по умолчанию — stderr)
  --help, -h                  показать эту справку
  --version, -v               показать версию

Без рабочего compiler.wasm сервер запускается, но публикует пустую диагностику
(остальные возможности — completion, hover, formatting и т.п. — работают).
`;

/**
 * Разбирает argv (без node и пути к скрипту).
 * @param {string[]} argv
 * @returns {{
 *   options: {stdio: boolean, compilerWasm?: string, languageData?: string, log?: string,
 *             help: boolean, version: boolean},
 *   errors: string[],
 * }}
 */
export function parseArgs(argv = []) {
    const options = {
        stdio: false,
        compilerWasm: undefined,
        languageData: undefined,
        log: undefined,
        help: false,
        version: false,
    };
    const errors = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--stdio') {
            options.stdio = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--version' || arg === '-v') {
            options.version = true;
            continue;
        }
        const eq = arg.indexOf('=');
        const name = eq > 0 ? arg.slice(0, eq) : arg;
        const inlineValue = eq > 0 ? arg.slice(eq + 1) : undefined;
        if (['--compiler-wasm', '--language-data', '--log'].includes(name)) {
            const value = inlineValue !== undefined ? inlineValue : argv[++i];
            if (!value) {
                errors.push(`опция ${name} требует значение`);
                continue;
            }
            if (name === '--compiler-wasm') options.compilerWasm = value;
            if (name === '--language-data') options.languageData = value;
            if (name === '--log') options.log = value;
            continue;
        }
        errors.push(`неизвестная опция: ${arg}`);
    }

    return { options, errors };
}
