// resources.mjs — MCP-ресурсы документации.
//
// Единственная ответственность: представить индекс документов как ресурсы
// (`latent-docs://index` + `latent-docs://<path>`), отдать список шаблонов URI
// и прочитать ресурс по URI. Все ресурсы read-only и имеют MIME-тип
// `text/markdown`; `resources/read` возвращает содержимое Markdown-страницы.

import { findDoc } from './docs-index.mjs';

/** Префикс URI ресурсов документации. */
export const URI_PREFIX = 'latent-docs://';

/** URI оглавления. */
export const INDEX_URI = `${URI_PREFIX}index`;

/**
 * Формирует URI ресурса для относительного пути документа.
 * @param {string} relativePath
 * @returns {string}
 */
export function docUri(relativePath) {
    return `${URI_PREFIX}${relativePath}`;
}

/**
 * Список ресурсов: сначала оглавление, затем все документы.
 * @param {object} index
 * @returns {{resources: object[]}}
 */
export function buildResourceList(index) {
    /** @type {object[]} */
    const resources = [
        {
            uri: INDEX_URI,
            name: 'index',
            title: 'Индекс документации Latent',
            description: 'Оглавление всей документации языка Latent со ссылками на страницы.',
            mimeType: 'text/markdown',
        },
    ];

    for (const doc of index.docs) {
        resources.push({
            uri: docUri(doc.path),
            name: doc.path,
            title: doc.title,
            description: doc.description || `Документация Latent: ${doc.title}`,
            mimeType: 'text/markdown',
        });
    }

    return { resources };
}

/**
 * Шаблоны ресурсов (RFC 6570) для клиентов, которые ищут документы динамически.
 * @returns {{resourceTemplates: object[]}}
 */
export function buildResourceTemplates() {
    return {
        resourceTemplates: [
            {
                uriTemplate: `${URI_PREFIX}{path}`,
                name: 'Документ Latent',
                title: 'Страница документации Latent',
                description: 'Любая страница документации по относительному пути, например latent-docs://guide/variables.md',
                mimeType: 'text/markdown',
            },
            {
                uriTemplate: `${URI_PREFIX}reference/{topic}.md`,
                name: 'Раздел справочника',
                title: 'Справочник по языку Latent',
                description: 'Страница справочника: grammar, types, operators, builtins, errors, wasm-abi, lexical, cli, complete-language.',
                mimeType: 'text/markdown',
            },
        ],
    };
}

/**
 * Читает ресурс по URI.
 * @param {object} index
 * @param {string} uri
 * @returns {{contents: object[]}|null} null — ресурс не найден
 */
export function readResource(index, uri) {
    if (typeof uri !== 'string') return null;
    const normalized = uri.trim();
    if (!normalized.toLowerCase().startsWith(URI_PREFIX)) return null;

    const relative = normalized.slice(URI_PREFIX.length);
    if (!relative) return null;

    if (relative === 'index' || relative === 'index.md') {
        return {
            contents: [
                {
                    uri: INDEX_URI,
                    mimeType: 'text/markdown',
                    text: index.renderIndex(),
                },
            ],
        };
    }

    const doc = findDoc(index, relative);
    if (!doc) return null;

    return {
        contents: [
            {
                uri: docUri(doc.path),
                mimeType: 'text/markdown',
                text: withFrontMatterTitle(doc),
            },
        ],
    };
}

/**
 * Для `resources/read` возвращаем содержимое страницы как есть (без front
 * matter) — клиенту-читателю нужен именно Markdown-текст.
 * @param {object} doc
 * @returns {string}
 */
function withFrontMatterTitle(doc) {
    return doc.content;
}
