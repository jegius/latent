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
        return new TextDecoder().decode(view.slice(ptr + 4, ptr + 4 + len));
    }

    writeString(str) {
        const ptr = this.wasmInstance.exports.alloc(str.length + 4);
        const view = new DataView(this.memory.buffer);
        view.setUint32(ptr, str.length, true);
        new Uint8Array(this.memory.buffer).set(
            new TextEncoder().encode(str),
            ptr + 4
        );
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
