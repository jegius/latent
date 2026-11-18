// runtime.js - JS Host Runtime for Latent

export class LatentRuntime {
    constructor() {
        this.wasmInstance = null;
        this.memory = null;
    }

    async load(wasmBytes) {
        // Создаём memory для WASM
        this.memory = new WebAssembly.Memory({ initial: 2 });

        // Загружаем WASM модуль
        const wasm = await WebAssembly.instantiate(wasmBytes, {
            env: {
                memory: this.memory,
                print: (ptr) => {
                    const str = this.readString(ptr);
                    console.log(str);
                },
                print_i32: (n) => console.log("int:", n),
                print_f64: (n) => console.log("float:", n),
                concat_strings: (a, b) => {
                    // Конкатенация строк (упрощённо)
                    return 0;
                }
            }
        });

        this.wasmInstance = wasm.instance;
        return wasm;
    }

    readString(ptr) {
        const view = new Uint8Array(this.memory.buffer);
        const len = new DataView(this.memory.buffer).getUint32(ptr, true);
        // subarray — представление без копирования (см. §4.2 статьи)
        return new TextDecoder().decode(view.subarray(ptr + 4, ptr + 4 + len));
    }

    writeString(str) {
        // Длина в байтах UTF-8, а не в UTF-16 code units: str.length — баг для не-ASCII
        const bytes = new TextEncoder().encode(str);
        const ptr = this.wasmInstance.exports.alloc(bytes.length + 4);
        const view = new DataView(this.memory.buffer);
        view.setUint32(ptr, bytes.length, true);
        new Uint8Array(this.memory.buffer).set(bytes, ptr + 4);
        return ptr;
    }

    callMain() {
        if (this.wasmInstance && this.wasmInstance.exports.main) {
            const result = this.wasmInstance.exports.main();
            return result !== undefined ? result : null;
        }
        return null;
    }

    callMainWithAI() {
        if (this.wasmInstance && this.wasmInstance.exports.main) {
            const result = this.wasmInstance.exports.main();
            // AI integration: call AI function if available
            if (this.wasmInstance.exports.ai_infer) {
                const aiResult = this.wasmInstance.exports.ai_infer(result);
                return aiResult !== undefined ? aiResult : result;
            }
            return result !== undefined ? result : null;
        }
        return null;
    }
}
