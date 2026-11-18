package dev.latent.idea.editor;

/**
 * Чистая логика отступов Latent (тестируется без IntelliJ Platform).
 *
 * <p>Язык использует блоки {@code { ... }} и не имеет автоформаттера; этого правила
 * достаточно, чтобы Enter после {@code {} ставил отступ на 4 пробела, а строка,
 * начинающаяся с {@code }}, уменьшала его.</p>
 */
public final class LatentIndentUtil {

    public static final int INDENT_SIZE = 4;

    private LatentIndentUtil() {
    }

    /**
     * Вычисляет отступ (в пробелах) для строки, содержащей {@code caretOffset}.
     *
     * @param text        весь текст документа
     * @param lineStart   начало текущей (новой) строки
     * @param caretOffset позиция каретки (она же — конец ведущих пробелов строки)
     */
    public static int computeIndent(CharSequence text, int lineStart, int caretOffset) {
        int base = previousLineIndent(text, lineStart);
        char previous = previousNonWhitespace(text, lineStart - 1);
        char next = nextNonWhitespace(text, caretOffset);
        int indent = base;
        if (previous == '{') {
            indent = base + INDENT_SIZE;
        }
        if (next == '}' && previous != '{') {
            indent = Math.max(0, indent - INDENT_SIZE);
        }
        return indent;
    }

    /** Количество ведущих пробелов в предыдущей непустой строке. */
    public static int previousLineIndent(CharSequence text, int lineStart) {
        int previousEnd = lineStart - 1;
        while (previousEnd > 0 && (text.charAt(previousEnd) == '\n' || text.charAt(previousEnd) == '\r')) {
            previousEnd--;
        }
        if (previousEnd <= 0) {
            return 0;
        }
        int previousStart = previousEnd;
        while (previousStart > 0 && text.charAt(previousStart - 1) != '\n') {
            previousStart--;
        }
        int spaces = 0;
        int i = previousStart;
        while (i <= previousEnd) {
            char c = text.charAt(i);
            if (c == ' ') {
                spaces++;
            } else if (c == '\t') {
                spaces += INDENT_SIZE;
            } else {
                break;
            }
            i++;
        }
        return spaces;
    }

    private static char previousNonWhitespace(CharSequence text, int from) {
        for (int i = from; i >= 0; i--) {
            char c = text.charAt(i);
            if (!Character.isWhitespace(c)) {
                return c;
            }
        }
        return '\0';
    }

    private static char nextNonWhitespace(CharSequence text, int from) {
        for (int i = from; i < text.length(); i++) {
            char c = text.charAt(i);
            if (!Character.isWhitespace(c)) {
                return c;
            }
        }
        return '\0';
    }
}
