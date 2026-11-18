package dev.latent.idea.completion;

import com.intellij.codeInsight.completion.CompletionContributor;
import com.intellij.codeInsight.completion.CompletionParameters;
import com.intellij.codeInsight.completion.CompletionProvider;
import com.intellij.codeInsight.completion.CompletionResultSet;
import com.intellij.codeInsight.completion.CompletionType;
import com.intellij.codeInsight.completion.InsertHandler;
import com.intellij.codeInsight.completion.InsertionContext;
import com.intellij.codeInsight.lookup.LookupElement;
import com.intellij.codeInsight.lookup.LookupElementBuilder;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.patterns.PlatformPatterns;
import com.intellij.psi.PsiFile;
import com.intellij.util.ProcessingContext;
import dev.latent.idea.LatentIcons;
import dev.latent.idea.data.LatentLanguageData;
import dev.latent.idea.lexer.LatentScanner;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.psi.LatentFile;
import dev.latent.idea.structure.LatentStructureParser;
import dev.latent.idea.structure.LatentStructureSymbol;
import org.jetbrains.annotations.NotNull;

import java.util.HashSet;
import java.util.Set;

/**
 * Автодополнение Latent: ключевые слова и мягкие ключевые слова, типы, builtins из
 * {@code latent-language.json}, объявления текущего файла и сниппеты (live templates).
 */
public final class LatentCompletionContributor extends CompletionContributor {

    private static final InsertHandler<LookupElement> CALL_HANDLER = new InsertHandler<>() {
        @Override
        public void handleInsert(@NotNull InsertionContext context, @NotNull LookupElement item) {
            Editor editor = context.getEditor();
            Document document = editor.getDocument();
            int offset = context.getTailOffset();
            document.insertString(offset, "()");
            editor.getCaretModel().moveToOffset(offset + 1);
        }
    };

    public LatentCompletionContributor() {
        extend(CompletionType.BASIC, PlatformPatterns.psiElement(),
                new CompletionProvider<CompletionParameters>() {
                    @Override
                    protected void addCompletions(@NotNull CompletionParameters parameters,
                                                  @NotNull ProcessingContext context,
                                                  @NotNull CompletionResultSet result) {
                        PsiFile originalFile = parameters.getOriginalFile();
                        if (!(originalFile instanceof LatentFile)) {
                            return;
                        }
                        CharSequence text = originalFile.getText();
                        int offset = Math.max(0, Math.min(parameters.getOffset(), text.length()));
                        if (offset == 0) {
                            return;
                        }
                        if (insideCommentOrString(text, offset)) {
                            return;
                        }
                        int wordStart = offset;
                        while (wordStart > 0 && isIdentifierPart(text.charAt(wordStart - 1))) {
                            wordStart--;
                        }
                        String prefix = text.subSequence(wordStart, offset).toString();
                        String beforePrefix = text.subSequence(0, wordStart).toString();
                        boolean afterDot = beforePrefix.endsWith(".");
                        boolean afterAt = beforePrefix.endsWith("@");
                        CompletionResultSet set = result.withPrefixMatcher(prefix);

                        LatentLanguageData data = LatentLanguageData.getInstance();
                        if (afterAt) {
                            addDecorators(set);
                            return;
                        }
                        if (afterDot) {
                            addMethods(set, data);
                            addFileMethods(set, text);
                            return;
                        }
                        addKeywords(set, data);
                        addTypes(set, data);
                        addFunctions(set, data);
                        addFileDeclarations(set, text);
                    }
                });
    }

    private static void addDecorators(CompletionResultSet set) {
        String[][] decorators = {
                {"test", "@test(\"name\")"},
                {"forall", "@forall(\"property\")"},
                {"snapshot", "@snapshot(\"name\")"},
                {"ai_contract", "@ai_contract(\"description\")"},
                {"enforce_contract", "@enforce_contract(contract)"},
        };
        for (String[] decorator : decorators) {
            set.addElement(LookupElementBuilder.create(decorator[0])
                    .withTypeText("декоратор")
                    .withTailText("  " + decorator[1], true)
                    .withIcon(LatentIcons.FILE)
                    .withBoldness(true));
        }
    }

    private static void addKeywords(CompletionResultSet set, LatentLanguageData data) {
        for (LatentLanguageData.Keyword keyword : data.getKeywords()) {
            if (keyword.soft) {
                set.addElement(LookupElementBuilder.create(keyword.name)
                        .withTypeText("мягкое ключевое слово")
                        .withTailText(tail(keyword.summary), true)
                        .withIcon(LatentIcons.FILE));
            } else {
                set.addElement(LookupElementBuilder.create(keyword.name)
                        .withTypeText("ключевое слово")
                        .withTailText(tail(keyword.summary), true)
                        .withIcon(LatentIcons.FILE)
                        .withBoldness(true));
            }
        }
    }

    private static void addTypes(CompletionResultSet set, LatentLanguageData data) {
        Set<String> seen = new HashSet<>();
        for (LatentLanguageData.TypeInfo type : data.getTypes()) {
            if (type.name == null || type.name.isEmpty() || !seen.add(type.name)) {
                continue;
            }
            if (type.name.startsWith("[") || type.name.contains(" ") || type.name.contains("<")
                    || type.name.contains(">") || type.name.contains("(")
                    || "null".equals(type.name) || "Named".equals(type.name)
                    || "Variant".equals(type.name)) {
                continue; // обобщённые и внутренние формы в аннотациях не предлагаем
            }
            set.addElement(LookupElementBuilder.create(type.name)
                    .withTypeText(type.wasm == null || type.wasm.isEmpty() ? "тип" : "тип → " + type.wasm)
                    .withTailText(tail(type.summary), true)
                    .withIcon(LatentIcons.FILE));
        }
    }

    private static void addFunctions(CompletionResultSet set, LatentLanguageData data) {
        for (LatentLanguageData.Builtin builtin : data.getFunctions()) {
            LookupElementBuilder builder = LookupElementBuilder.create(builtin.name)
                    .withTypeText(builtin.hostOnly ? "builtin (host-only)" : "builtin")
                    .withTailText("  " + builtin.firstSignature(), true)
                    .withIcon(LatentIcons.FILE);
            if (!"ai_generate!".equals(builtin.name) && !builtin.name.endsWith("!")) {
                builder = builder.withInsertHandler(CALL_HANDLER);
            }
            set.addElement(builder);
        }
    }

    private static void addMethods(CompletionResultSet set, LatentLanguageData data) {
        Set<String> seen = new HashSet<>();
        for (LatentLanguageData.Builtin builtin : data.getMethods()) {
            if (!seen.add(builtin.name)) {
                continue;
            }
            LookupElementBuilder builder = LookupElementBuilder.create(builtin.name)
                    .withTypeText(builtin.owner == null || builtin.owner.isEmpty()
                            ? "метод" : "метод " + builtin.owner)
                    .withTailText("  " + builtin.firstSignature(), true)
                    .withIcon(LatentIcons.FILE);
            if (!"property".equals(builtin.kind)) {
                builder = builder.withInsertHandler(CALL_HANDLER);
            }
            set.addElement(builder);
        }
    }

    private static void addFileMethods(CompletionResultSet set, CharSequence text) {
        Set<String> seen = new HashSet<>();
        for (LatentStructureSymbol symbol : LatentStructureParser.parse(text)) {
            if (symbol.getKind() != LatentStructureSymbol.Kind.CLASS) {
                continue;
            }
            for (LatentStructureSymbol method : symbol.getChildren()) {
                if (method.getKind() == LatentStructureSymbol.Kind.FUNCTION
                        && "init".equals(method.getName())) {
                    continue;
                }
                if (seen.add(method.getName())) {
                    set.addElement(LookupElementBuilder.create(method.getName())
                            .withTypeText("метод " + symbol.getName())
                            .withIcon(LatentIcons.FILE)
                            .withInsertHandler(CALL_HANDLER));
                }
            }
        }
    }

    private static void addFileDeclarations(CompletionResultSet set, CharSequence text) {
        Set<String> seen = new HashSet<>();
        for (LatentStructureSymbol symbol : LatentStructureParser.parse(text)) {
            String name = symbol.getName();
            if (name == null || name.isEmpty() || !seen.add(name)) {
                continue;
            }
            LookupElementBuilder builder = LookupElementBuilder.create(name)
                    .withIcon(LatentIcons.FILE);
            switch (symbol.getKind()) {
                case FUNCTION:
                    builder = builder.withTypeText("функция")
                            .withInsertHandler(CALL_HANDLER);
                    break;
                case CLASS:
                    builder = builder.withTypeText("класс");
                    break;
                case ENUM:
                    builder = builder.withTypeText("enum");
                    break;
                default:
                    break;
            }
            set.addElement(builder);
        }
    }

    private static boolean insideCommentOrString(CharSequence text, int offset) {
        int probe = Math.max(0, offset - 1);
        for (LatentScanner.Token token : LatentScanner.tokenize(text)) {
            if (token.getStart() > probe) {
                break;
            }
            if (token.getStart() <= probe && probe < token.getEnd()) {
                LatentTokenKind kind = token.getKind();
                return kind.isComment() || kind.isStringLiteral();
            }
        }
        return false;
    }

    private static boolean isIdentifierPart(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '_';
    }

    private static String tail(String summary) {
        if (summary == null || summary.isEmpty()) {
            return "";
        }
        String oneLine = summary.replace('\n', ' ').trim();
        return oneLine.length() <= 70 ? "  " + oneLine : "  " + oneLine.substring(0, 67) + "...";
    }
}
