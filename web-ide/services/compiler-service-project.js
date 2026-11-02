// services/compiler-service-project.js — многофайловые проекты в CompilerService.
// Единственная ответственность: нормализация project-input, выбор движка для
// проекта, запуск через линковку (движок №1) и компиляция манифеста "LPF1"
// (движок №2). Методы подмешиваются в прототип CompilerService.
//
// Контракт: старые методы compileAndRun(source) не меняются; проект
// передаётся как (files, entry) или как {files, entry} в compileAndRun.

import { compile, checkSyntax } from '../compiler/loader.js';
import { runLatentProject } from '../compiler/run.js';
import { linkModuleProject } from '../compiler/modules-link.js';
import {
    buildModuleManifest, encodeModuleManifest, projectHash,
} from '../compiler/modules-manifest.js';
import { normalizeModulePath } from '../compiler/modules.js';
import {
    detectHostFeatures, detectAIFeatures, describeFeatures, ENGINE1_LABEL,
} from '../compiler/host-features.js';
import { analyzeProject } from '../compiler/analysis.js';
import { repairCode } from '../compiler/lazy-ai.js';

/** Сообщение до появления C-ABI latent_compile_files. */
export const ENGINE2_NO_MODULES_NOTE =
    'Engine #2 пока без модулей: C-ABI latent_compile_files отсутствует; ' +
    'проект исполняется engine #1 (host runtime).';

const PROJECT_CACHE_LIMIT = 32;

/** Первая строка диагностики — для короткого сообщения. */
function firstLine(message) {
    const text = String(message ?? '').trim();
    return text.split('\n')[0] || 'unknown error';
}

/** true, если аргумент — project-input ({files, entry}). */
export function isProjectInput(value) {
    return !!value && typeof value === 'object' && Array.isArray(value.files);
}

/**
 * Приводит project-input к { files: [{name, code}], entry }.
 * Принимает ({files, entry}), [files] или (files, entry).
 * @returns {{files:Array<{name:string,code:string}>, entry:string}}
 */
export function normalizeProjectInput(files, entry) {
    let list = files;
    let entryPath = entry;
    if (isProjectInput(files)) {
        list = files.files;
        entryPath = entry ?? files.entry;
    }
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error('Project must contain at least one .lat file');
    }
    const normalized = list.map((file, index) => ({
        name: normalizeModulePath(file && (file.name ?? file.path ?? `file${index}.lat`)),
        code: String((file && (file.code ?? file.source ?? file.text)) ?? ''),
    }));
    const wanted = entryPath !== undefined && entryPath !== null
        ? normalizeModulePath(entryPath)
        : normalized[0].name;
    if (!normalized.some((file) => file.name === wanted)) {
        throw new Error(`Entry file '${wanted}' not found in workspace`);
    }
    return { files: normalized, entry: wanted };
}

/** true, если в файле есть import (файл участвует в линковке модулей). */
function hasImports(source) {
    return /(?:^|\n)\s*import\b/.test(String(source ?? ''));
}

/** true, если проект требует линковки модулей (несколько файлов/import). */
export function projectUsesModules(files, entry) {
    const project = normalizeProjectInput(files, entry);
    return project.files.length > 1
        || project.files.some((file) => hasImports(file.code));
}

/** Исходник entry-файла проекта. */
function entrySource(project) {
    const file = project.files.find((f) => f.name === project.entry);
    return file ? file.code : '';
}

/** Кэш скомпилированных проектов движком №2 (по хэшу набора файлов). */
function projectCache(service) {
    if (!(service.projectCache instanceof Map)) service.projectCache = new Map();
    return service.projectCache;
}

/** Объединяет фичи по всем файлам проекта. */
function combinedFeatures(files, detector) {
    const features = new Set();
    for (const file of files) {
        for (const feature of detector(file.code).features) features.add(feature);
    }
    return { host: features.size > 0, features: [...features] };
}

export const compilerProjectMethods = {
    /**
     * Компилирует проект для запуска с автовыбором движка (аналог compileForRun).
     * @returns {Promise<{bytecode:Uint8Array, compileEngine:'1'|'2',
     *     hostFeatures:string[], fallback:boolean, note:string|null}>}
     */
    async compileForRunProject(files, entry) {
        const project = normalizeProjectInput(files, entry);
        if (!projectUsesModules(project.files, project.entry)) {
            return this.compileForRun(entrySource(project));
        }
        const host = combinedFeatures(project.files, detectHostFeatures);
        const wasm = this.wasmCompiler;
        const modulesEngine2 = !!wasm && typeof wasm.compileFiles === 'function'
            && wasm.supportsModules !== false;

        if (wasm && modulesEngine2 && !host.host) {
            try {
                return {
                    bytecode: this.compileWithEngine2Project(project.files, project.entry),
                    compileEngine: '2',
                    hostFeatures: host.features,
                    fallback: false,
                    note: null,
                };
            } catch (e) {
                // Сначала валидируем проект JS-линкером: его ошибка (нет файла,
                // символ не экспортирован) полезнее пользователю, чем текст Rust.
                linkModuleProject(project.files, project.entry);
                return {
                    bytecode: await compile(entrySource(project)),
                    compileEngine: '1',
                    hostFeatures: host.features,
                    fallback: true,
                    note: `Engine #2 не смог скомпилировать проект (${firstLine(e.message)}); ` +
                        'используется engine #1 (host runtime).',
                };
            }
        }

        // Движок №1: линковка обязательна — она даёт понятные ошибки модулей.
        linkModuleProject(project.files, project.entry);
        let note = null;
        if (wasm && !modulesEngine2) note = ENGINE2_NO_MODULES_NOTE;
        else if (wasm && host.host) {
            note = `Host-фичи (${describeFeatures(host.features)}) исполняются engine #1 (host runtime).`;
        }
        return {
            bytecode: await compile(entrySource(project)),
            compileEngine: '1',
            hostFeatures: host.features,
            fallback: !!wasm,
            note,
        };
    },

    /**
     * Компилирует и запускает многофайловый проект (исполнение — движок №1,
     * полный host-рантайм; движок №2 даёт bytecode).
     * @returns {Promise<object>} RunResult + modules/modulePaths/cycles
     */
    async compileAndRunProject(files, entry, withAI = false) {
        const project = normalizeProjectInput(files, entry);
        if (!projectUsesModules(project.files, project.entry)) {
            return this.compileAndRun(entrySource(project), withAI);
        }
        const compiled = await this.compileForRunProject(project.files, project.entry);
        const ai = combinedFeatures(project.files, detectAIFeatures);
        const autoAI = !withAI && ai.required;
        const effectiveAI = withAI || autoAI;
        const notes = [];
        if (compiled.note) notes.push(compiled.note);
        if (autoAI) {
            notes.push(
                `AI-примитивы (${describeFeatures(ai.features)}) включены автоматически ` +
                'в mock-режиме; для реальной модели используйте Run with AI.');
        }
        const run = await runLatentProject(
            project.files, project.entry, effectiveAI, autoAI ? { forceMockAI: true } : {});
        return {
            result: run.result,
            logs: run.output,
            bytecode: compiled.bytecode,
            analysis: analyzeProject(project.files),
            engine: '1',
            engineLabel: ENGINE1_LABEL,
            compileEngine: compiled.compileEngine,
            hostFeatures: compiled.hostFeatures,
            aiFeatures: ai.features,
            aiEnabled: effectiveAI,
            fallback: compiled.fallback,
            notes,
            modules: run.modules,
            modulePaths: run.modulePaths,
            cycles: run.cycles,
        };
    },

    /**
     * Самовосстановление многофайлового проекта: модель чинит только entry-файл
     * (остальные модули считаются библиотечными).
     */
    async compileAndRunWithRepairProject(files, entry, withAI = true, maxAttempts = 3) {
        let project = normalizeProjectInput(files, entry);
        if (!projectUsesModules(project.files, project.entry)) {
            return this.compileAndRunWithRepair(entrySource(project), withAI, maxAttempts);
        }
        const repairLog = [];
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const result = await this.compileAndRunProject(
                    project.files, project.entry, withAI);
                return {
                    ...result,
                    repaired: i > 0,
                    attempts: i + 1,
                    finalSource: entrySource(project),
                    repairLog,
                };
            } catch (e) {
                repairLog.push(`Attempt ${i + 1}: ${e.message}`);
                const patched = await repairCode(entrySource(project), e.message, withAI);
                if (patched === null) {
                    repairLog.push('Self-repair unavailable — aborting.');
                    throw e;
                }
                project = {
                    entry: project.entry,
                    files: project.files.map((file) =>
                        (file.name === project.entry ? { ...file, code: patched } : file)),
                };
            }
        }
        throw new Error(
            `Self-repair failed after ${maxAttempts} attempts:\n${repairLog.join('\n')}`);
    },

    /** Проверяет синтаксис и линковку проекта (движок №1). */
    async checkSyntaxProject(files, entry) {
        const project = normalizeProjectInput(files, entry);
        if (!projectUsesModules(project.files, project.entry)) {
            return checkSyntax(entrySource(project));
        }
        linkModuleProject(project.files, project.entry);
        return true;
    },

    /**
     * Компилирует проект движком №2 через манифест "LPF1".
     * Бросает ENGINE2_NO_MODULES, пока C-ABI не экспортирует latent_compile_files.
     * @returns {Uint8Array}
     */
    compileWithEngine2Project(files, entry) {
        const project = normalizeProjectInput(files, entry);
        if (!this.wasmCompiler) throw new Error('Engine #2 is not loaded');
        const wasm = this.wasmCompiler;
        if (typeof wasm.compileFiles !== 'function' || wasm.supportsModules === false) {
            const error = new Error(
                'Engine #2 пока без модулей: C-ABI latent_compile_files не экспортирован ' +
                '(однофайловый latent_compile не поддерживает import). ' +
                'Многофайловый проект доступен в engine #1.');
            error.code = 'ENGINE2_NO_MODULES';
            throw error;
        }
        const manifest = buildModuleManifest(project.files, project.entry);
        const hash = projectHash(project.files, project.entry);
        const cache = projectCache(this);
        const cached = cache.get(hash);
        if (cached) return cached;
        const bytes = encodeModuleManifest(manifest.files, manifest.entryIndex);
        const bytecode = wasm.compileFiles(bytes);
        cache.set(hash, bytecode);
        if (cache.size > PROJECT_CACHE_LIMIT) {
            cache.delete(cache.keys().next().value);
        }
        return bytecode;
    },

    /** true, если загруженный движок №2 умеет компилировать файловые модули. */
    hasEngine2Modules() {
        const wasm = this.wasmCompiler;
        return !!wasm && typeof wasm.compileFiles === 'function'
            && wasm.supportsModules !== false;
    },

    /** Host-фичи по всем файлам проекта. */
    detectProjectHostFeatures(files) {
        const project = normalizeProjectInput(files);
        return combinedFeatures(project.files, detectHostFeatures);
    },

    /** Сбрасывает кэш компиляции проектов движком №2. */
    clearProjectCache() {
        projectCache(this).clear();
    },
};
