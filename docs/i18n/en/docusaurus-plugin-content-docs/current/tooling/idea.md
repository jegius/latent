---
title: "IntelliJ IDEA: the Latent plugin"
sidebar_label: IntelliJ IDEA
sidebar_position: 3
description: "The editors/idea plugin: structure (42 Java files), the Gradle 8.10.2 + IntelliJ Platform 2024.2 build, installation from a zip, features (highlighting, completion, annotations, structure view, run configuration), settings, and the honest build status."
---

# IntelliJ IDEA: the Latent plugin

The `editors/idea` plugin adds the Latent language to IntelliJ IDEA: a
FileType/Language for `.lat`, highlighting and a configurable color scheme,
completion, lexical-error annotations, Structure View, folding, comments,
indentation — and running programs through `latentc` with a fallback to
`compiler.wasm`.

## Status: it builds

The plugin builds and packages (`buildPlugin`):

```text
> Task :compileJava
> Task :jar
> Task :buildPlugin
BUILD SUCCESSFUL in 59s
```

The artifact is `editors/idea/build/distributions/latent-idea-1.0.0.zip`
(≈237 KB; inside it `latent-idea/lib/latent-idea-1.0.0.jar` with
`META-INF/plugin.xml`). The `build/` directory is listed in `.gitignore`, so in a
clean copy you have to build the archive yourself — the sources compile without
errors.

| Parameter | Value |
|---|---|
| Plugin `id` / name / version | `dev.latent.idea` / `Latent` / `1.0.0` |
| Compatibility | IDEA Community/Ultimate 2023.3–2024.3 (`since-build=233`, `until-build=243.*`) |
| Gradle | 8.10.2 (wrapper), IntelliJ Platform Gradle Plugin 2.1.0 |
| Target platform | IntelliJ IDEA Community 2024.2 |
| JDK / bytecode | 17 (`sourceCompatibility/targetCompatibility = 17`) |
| Sources | 42 Java files (~3,254 lines) + 7 test files |
| Resources | `META-INF/plugin.xml`, `language/latent-language.json`, `liveTemplates/Latent.xml`, `runner/latent-runner.mjs`, `runner/compiler.wasm` |

`verifyPluginProjectConfiguration` emits two warnings (not errors):

- `since-build=233` is below the target platform 2024.2 (`242`);
- platform 2024.2 recommends `sourceCompatibility=21`.

The plugin is deliberately built for JDK 17 and bytecode 17 so that it works in
every IDE from 2023.3 to 2024.3.

## Building

```powershell
$env:JAVA_HOME = 'C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17\jdk-17.0.20.1+1'
cd editors\idea
.\gradlew.bat buildPlugin
# result: build\distributions\latent-idea-1.0.0.zip
```

```bash
# Linux/macOS
cd editors/idea
JAVA_HOME=/path/to/jdk-17 ./gradlew buildPlugin
```

Requirements: JDK 17 and network access (Gradle 8.10.2 and IntelliJ Platform
2024.2 are downloaded on the first build). `buildSearchableOptions` and
`instrumentCode` are disabled in `build.gradle.kts` — no headless IDE is needed
for the build.

:::note If Java cannot write to the repository directory
In the DSH sandbox we hit `java.nio.file.AccessDeniedException` on
`editors/idea/.intellijPlatform` (the Java process could not create files inside
`C:\Users\Admin\IdeaProjects`), while `GRADLE_USER_HOME`/`java.io.tmpdir` by
default pointed to inaccessible directories. The workaround is to build a copy of
the directory in the working folder and to set temporary paths:

```powershell
$dst = '...\latent-work\idea-copy'
Copy-Item editors\idea\* $dst -Recurse -Exclude build,.gradle,.intellijPlatform
$env:GRADLE_USER_HOME = '...\latent-work\idea-build\gradle-home'
$env:TEMP = $env:TMP = '...\latent-work\idea-build\tmp'
$env:JAVA_HOME = '...\tools\jdk17\jdk-17.0.20.1+1'
cd $dst; .\gradlew.bat buildPlugin
```
:::

## Installing from disk

1. Build the archive (`.\gradlew.bat buildPlugin`).
2. `Settings → Plugins → ⚙ → Install Plugin from Disk…`
3. Select `build/distributions/latent-idea-1.0.0.zip`.
4. Restart the IDE; the Latent language is enabled for `.lat` files.

## Features

| Feature | What is implemented |
|---|---|
| FileType/Language `Latent` | the `.lat` extension, an icon, `Language`/`FileType` in `plugin.xml` |
| Lexer | hand-written (`LatentScanner`), no JFlex: 37 keywords (24 hard + 13 soft), operators, numbers (`42`, `3.14`, `1e10`, `1.5e-3`), strings with the escapes `\n \t \\ \"`, nested `/* */`, `//`, `@` decorators |
| ParserDefinition/PSI | token-level PSI (`LatentParser`, `LatentFile`, `LatentDeclarationElement`) |
| Highlighting | `SyntaxHighlighter`: KEYWORD, SOFT_KEYWORD, TYPE, STRING, NUMBER, BOOLEAN, COMMENT, OPERATOR, FUNCTION_DECL, CLASS_DECL, ANNOTATION, AI_PRIMITIVE, IDENTIFIER; page **Settings → Editor → Color Scheme → Latent** |
| Annotator | unterminated string/comment, invalid escape/number, unexpected character, unbalanced brackets (lexical and structural only, no type checking) |
| Completion | keywords, types, builtins from `language.json`, functions/classes/enums of the current file, methods after `.`, decorators after `@` |
| Live templates | `fn`, `let`, `if`, `ifelse`, `while`, `for`, `forin`, `class`, `enum`, `match`, `lambda`, `spawn`, `select`, `test`, `assert`, `ai_generate`, `ai_infer`, `ai_contract` |
| Structure View | functions, classes with their methods, enums with their variants (a heuristic token parse) |
| Editing | folding of `{ ... }`/classes/enums/block comments, brace matching, Enter with a 4-space indent, auto-closing quotes, `//` and `/* */` comments |
| New file | the `Latent Main.lat` template in the New → File dialog |
| Run Configuration | **Latent**: compilation with `latentc`, fallback — `compiler.wasm`, running the WASM in Node (`runner/latent-runner.mjs`), `print` — one line per argument, exit code = `main % 256` |
| Settings | `Settings → Tools → Latent`: paths to `latentc`, `node`, `compiler.wasm` |

## Running a program

1. `Settings → Tools → Latent` — specify `latentc`, `node`, `compiler.wasm` if
   needed (by default they are searched for in `PATH`/the project).
2. `Run → Edit Configurations… → + → Latent` and pick a `.lat` file (or
   right-click in the editor → `Run 'Latent …'`, or the green button next to
   `fn main`).
3. The plugin compiles the file (`latentc compile <file> <out.wasm>`) into a
   temporary `*.wasm` and runs it via `node runner/latent-runner.mjs run <wasm>`.

If `latentc` is not found, `compiler.wasm` is used through the C ABI
`latent_alloc`/`latent_compile`. The bundled copy
`src/main/resources/runner/compiler.wasm` is a **snapshot taken when the plugin
was built**; it can be overridden by a setting.

## Verification

```bash
cd editors/idea
./gradlew buildPlugin                    # build the zip
./gradlew test                           # 49 tests, 0 failures
./gradlew verifyPluginProjectConfiguration
```

The tests are in `src/test/java`: lexer/scanner (16), file structure (5),
indentation (5), language JSON data (3), highlighting (5), lexer wrapper (2) and a
platform smoke test (12: parser/annotator/completion on `BasePlatformTestCase`).
Verified: `BUILD SUCCESSFUL`, 49/49 `PASSED`.

## Limitations

- The plugin **does not replace the compiler**: type diagnostics, undefined names
  and arity checks stay with `latentc`; the annotator shows lexical and structural
  problems only (to avoid false positives).
- There is no formatter, no refactorings, no debugger and no LSP client;
  Structure View is built on a heuristic token parse.
- Highlighting is not semantic: there is no symbol resolution.
- Host-only primitives (`tensor`, `ai_infer`, channels) are not compiled by
  engine #2 — this is a limitation of the language, not of the plugin.
- Running requires Node.js; compilation requires `latentc` or `compiler.wasm`.
- **The bundled copy of `runner/compiler.wasm` is outdated**: 470,717 bytes, built
  before the `src/` decomposition, and it **does not contain memory builtins**
  (`alloc(4)` → `Неопределённая переменная 'alloc'`). If you need memory builtins,
  point the settings at the up-to-date `web-ide/compiler.wasm` (465,435 bytes) —
  see [bootstrap](./bootstrap.md#2-compilerwasm-for-the-web-ide-engine-2).
- The build requires JDK 17 and network access; in the DSH sandbox it also
  requires a copy of the directory (see the note above).

## Related sections

- [VS Code](./vscode.md) — the extension with an LSP client.
- [Web IDE](./web-ide.md) · [MCP](./mcp.md)
- [CLI](../reference/cli.md) — `latentc` and running WASM.
- [Bootstrap](./bootstrap.md) — building `latentc`/`compiler.wasm`.
