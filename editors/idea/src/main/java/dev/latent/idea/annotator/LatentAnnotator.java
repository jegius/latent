package dev.latent.idea.annotator;

import com.intellij.lang.annotation.AnnotationHolder;
import com.intellij.lang.annotation.Annotator;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import dev.latent.idea.highlight.LatentHighlightingKeys;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;
import dev.latent.idea.psi.LatentFile;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Аннотатор Latent: объясняет проблемы, которые лексер и толерантный парсер не считают
 * фатальными.
 *
 * <p>Проверки намеренно консервативны: незакрытые строки/комментарии, неверные escape и
 * числа, неизвестные символы и несогласованные скобки. Семантические ошибки (типы,
 * неопределённые имена) остаются за компилятором, чтобы не показывать ложные срабатывания.</p>
 */
public final class LatentAnnotator implements Annotator {

    private static final Set<String> AI_BUILTINS = new HashSet<>();

    static {
        AI_BUILTINS.add("ai_generate");
        AI_BUILTINS.add("ai_infer");
        AI_BUILTINS.add("ai_embed");
        AI_BUILTINS.add("ai_stream");
        AI_BUILTINS.add("stream_next");
        AI_BUILTINS.add("tensor");
        AI_BUILTINS.add("semantic");
        AI_BUILTINS.add("matmul");
        AI_BUILTINS.add("cosine_similarity");
        AI_BUILTINS.add("dot");
        AI_BUILTINS.add("magnitude");
        AI_BUILTINS.add("zeros");
        AI_BUILTINS.add("ones");
    }

    @Override
    public void annotate(@NotNull PsiElement element, @NotNull AnnotationHolder holder) {
        if (!(element instanceof LatentFile) && !(element instanceof PsiFile)) {
            return;
        }
        if (!element.getLanguage().isKindOf(dev.latent.idea.LatentLanguage.INSTANCE)) {
            return;
        }
        List<PsiElement> leaves = new ArrayList<>();
        collectLeaves(element, leaves);

        List<PsiElement> meaningful = new ArrayList<>();
        for (PsiElement leaf : leaves) {
            LatentTokenKind kind = kindOf(leaf);
            if (kind == LatentTokenKind.WHITESPACE) {
                continue;
            }
            meaningful.add(leaf);
            reportTokenProblem(leaf, kind, holder);
        }
        reportBrackets(meaningful, holder);
        highlightDeclarations(meaningful, holder);
    }

    private static void collectLeaves(PsiElement element, List<PsiElement> out) {
        PsiElement child = element.getFirstChild();
        if (child == null) {
            out.add(element);
            return;
        }
        while (child != null) {
            collectLeaves(child, out);
            child = child.getNextSibling();
        }
    }

    private static LatentTokenKind kindOf(PsiElement leaf) {
        if (leaf.getNode() == null) {
            return null;
        }
        return LatentTokenTypes.kindOf(leaf.getNode().getElementType());
    }

    private static void reportTokenProblem(PsiElement leaf, LatentTokenKind kind,
                                           AnnotationHolder holder) {
        if (kind == null) {
            return;
        }
        String message = null;
        switch (kind) {
            case STRING_UNTERMINATED:
                message = "Незавершённая строка: нет закрывающей кавычки";
                break;
            case STRING_INVALID_ESCAPE:
                message = "Неверная escape-последовательность: допустимы \\n, \\t, \\\\ и \\\"";
                break;
            case BLOCK_COMMENT_UNTERMINATED:
                message = "Незавершённый блочный комментарий: нет закрывающего */";
                break;
            case NUMBER_INVALID:
                message = "Неверный формат числа: после экспоненты ожидаются цифры";
                break;
            case BAD_CHARACTER:
                message = "Неожиданный символ '" + leaf.getText() + "'";
                break;
            default:
                break;
        }
        if (message != null) {
            holder.newAnnotation(HighlightSeverity.ERROR, message).range(leaf).create();
        }
    }

    private static void reportBrackets(List<PsiElement> meaningful, AnnotationHolder holder) {
        Deque<PsiElement> stack = new ArrayDeque<>();
        int reports = 0;
        for (PsiElement leaf : meaningful) {
            LatentTokenKind kind = kindOf(leaf);
            if (kind == null) {
                continue;
            }
            if (kind == LatentTokenKind.LPAREN || kind == LatentTokenKind.LBRACE
                    || kind == LatentTokenKind.LBRACKET) {
                stack.push(leaf);
            } else if (kind == LatentTokenKind.RPAREN || kind == LatentTokenKind.RBRACE
                    || kind == LatentTokenKind.RBRACKET) {
                if (stack.isEmpty() || !matches(kindOf(stack.peek()), kind)) {
                    if (reports++ < 5) {
                        holder.newAnnotation(HighlightSeverity.ERROR,
                                        "Лишняя или несогласованная закрывающая скобка")
                                .range(leaf).create();
                    }
                } else {
                    stack.pop();
                }
            }
        }
        while (!stack.isEmpty() && reports++ < 5) {
            PsiElement open = stack.pop();
            holder.newAnnotation(HighlightSeverity.ERROR, "Незакрытая скобка")
                    .range(open).create();
        }
    }

    private static boolean matches(LatentTokenKind open, LatentTokenKind close) {
        return (open == LatentTokenKind.LPAREN && close == LatentTokenKind.RPAREN)
                || (open == LatentTokenKind.LBRACE && close == LatentTokenKind.RBRACE)
                || (open == LatentTokenKind.LBRACKET && close == LatentTokenKind.RBRACKET);
    }

    private static void highlightDeclarations(List<PsiElement> meaningful, AnnotationHolder holder) {
        for (int i = 0; i < meaningful.size(); i++) {
            PsiElement leaf = meaningful.get(i);
            LatentTokenKind kind = kindOf(leaf);
            if (kind == LatentTokenKind.FN || kind == LatentTokenKind.CLASS
                    || kind == LatentTokenKind.ENUM) {
                if (i + 1 < meaningful.size()) {
                    PsiElement name = meaningful.get(i + 1);
                    LatentTokenKind nameKind = kindOf(name);
                    if (nameKind == LatentTokenKind.IDENTIFIER
                            || nameKind == LatentTokenKind.TYPE_NAME
                            || (nameKind != null && nameKind.isKeyword())) {
                        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
                                .range(name)
                                .textAttributes(kind == LatentTokenKind.FN
                                        ? LatentHighlightingKeys.FUNCTION_DECL
                                        : LatentHighlightingKeys.CLASS_DECL)
                                .create();
                    }
                }
            }
            if (kind == LatentTokenKind.IDENTIFIER && AI_BUILTINS.contains(leaf.getText())) {
                if (i + 1 < meaningful.size()) {
                    LatentTokenKind next = kindOf(meaningful.get(i + 1));
                    boolean call = next == LatentTokenKind.LPAREN
                            || (next == LatentTokenKind.NOT && "ai_generate".equals(leaf.getText()));
                    if (call) {
                        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
                                .range(leaf)
                                .textAttributes(LatentHighlightingKeys.AI_PRIMITIVE)
                                .create();
                    }
                }
            }
        }
    }
}
