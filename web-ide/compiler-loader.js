// compiler-loader.js — загрузка компилятора Latent в браузере

let compilerModule = null;

export async function loadCompiler() {
    if (compilerModule) return compilerModule;

    // Загружаем WASM модуль компилятора
    // В реальной реализации — import('./pkg/latent_compiler.js')
    // Пока заглушка
    compilerModule = {
        compile: (source) => {
            console.log('Compiling:', source);
            return new Uint8Array([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
        },
        check_syntax: (source) => {
            console.log('Checking syntax:', source);
            return true;
        },
        version: () => '0.1.0'
    };

    return compilerModule;
}

export async function compile(source) {
    const compiler = await loadCompiler();
    return compiler.compile(source);
}

export async function checkSyntax(source) {
    const compiler = await loadCompiler();
    return compiler.check_syntax(source);
}

export async function getVersion() {
    const compiler = await loadCompiler();
    return compiler.version();
}
