// highlight.js — a deliberately small Latent highlighter for the demo pages.
// It escapes HTML first, then re-colours tokens with a single alternation, so
// it never injects markup from the source.

const KEYWORDS =
  'fn|let|if|else|while|for|in|return|class|new|this|enum|match|case|default|test|spawn|channel|select|yield|true|false|null|break|continue|import|from|as';
const BUILTINS =
  'print|len|push|pop|str|int|float|sqrt|assert|assert_eq|alloc|load8|store8|load32|store32|memcopy|ai_infer|ai_embed|tensor|matmul|cosine_similarity';

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const JS_KEYWORDS =
  'const|let|var|function|return|if|else|for|while|of|in|new|class|this|await|async|yield|true|false|null|undefined|break|continue|import|export|from|default|typeof';
const JS_BUILTINS =
  'Math|Int32Array|Uint8Array|Uint8ClampedArray|ImageData|Promise|performance|Number|Array|Object|console|document|window';

export function highlightLatent(source) {
  const pattern = new RegExp(
    `(\\/\\/[^\\n]*)|("(?:\\\\.|[^"\\\\])*")|\\b(${KEYWORDS})\\b|\\b(${BUILTINS})\\b|\\b(\\d+)\\b|\\b([A-Za-z_][A-Za-z0-9_]*)(?=\\s*\\()`,
    'g',
  );
  let out = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += escapeHtml(source.slice(last, index));
    const [text, comment, str, kw, builtin, num, fn] = match;
    if (comment) out += `<span class="tok-com">${escapeHtml(text)}</span>`;
    else if (str) out += `<span class="tok-str">${escapeHtml(text)}</span>`;
    else if (kw) out += `<span class="tok-kw">${escapeHtml(text)}</span>`;
    else if (builtin) out += `<span class="tok-builtin">${escapeHtml(text)}</span>`;
    else if (num) out += `<span class="tok-num">${escapeHtml(text)}</span>`;
    else if (fn) out += `<span class="tok-fn">${escapeHtml(text)}</span>`;
    else out += escapeHtml(text);
    last = index + text.length;
  }
  out += escapeHtml(source.slice(last));
  return out;
}

/**
 * The same simple approach for the JavaScript reference snippets shown
 * next to the .lat sources (comments, strings, keywords, numbers, calls).
 */
export function highlightJS(source) {
  const pattern = new RegExp(
    `(\\/\\/[^\\n]*)|('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(${JS_KEYWORDS})\\b|\\b(${JS_BUILTINS})\\b|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_$][A-Za-z0-9_$]*)(?=\\s*\\()`,
    'g',
  );
  let out = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += escapeHtml(source.slice(last, index));
    const [text, comment, str, kw, builtin, num, fn] = match;
    if (comment) out += `<span class="tok-com">${escapeHtml(text)}</span>`;
    else if (str) out += `<span class="tok-str">${escapeHtml(text)}</span>`;
    else if (kw) out += `<span class="tok-kw">${escapeHtml(text)}</span>`;
    else if (builtin) out += `<span class="tok-builtin">${escapeHtml(text)}</span>`;
    else if (num) out += `<span class="tok-num">${escapeHtml(text)}</span>`;
    else if (fn) out += `<span class="tok-fn">${escapeHtml(text)}</span>`;
    else out += escapeHtml(text);
    last = index + text.length;
  }
  out += escapeHtml(source.slice(last));
  return out;
}
