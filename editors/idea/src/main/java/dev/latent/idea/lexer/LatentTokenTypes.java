package dev.latent.idea.lexer;

import com.intellij.lang.Language;
import com.intellij.psi.tree.IElementType;
import com.intellij.psi.tree.TokenSet;
import dev.latent.idea.LatentLanguage;

import java.util.Collections;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;

/**
 * Соответствие «вид лексемы → IElementType».
 *
 * <p>Все токены языка живут в одном пространстве {@link IElementType}: это стандартный
 * подход для простого лексера без JFlex. Наборы комментариев/пробелов/строк используются
 * {@code ParserDefinition} и платформой.</p>
 */
public final class LatentTokenTypes {

    private static final Map<LatentTokenKind, IElementType> BY_KIND =
            new EnumMap<>(LatentTokenKind.class);
    private static final Map<IElementType, LatentTokenKind> BY_TYPE = new HashMap<>();

    static {
        Language language = LatentLanguage.INSTANCE;
        for (LatentTokenKind kind : LatentTokenKind.values()) {
            IElementType type = new IElementType(kind.name(), language);
            BY_KIND.put(kind, type);
            BY_TYPE.put(type, kind);
        }
    }

    public static final TokenSet COMMENTS = TokenSet.create(
            of(LatentTokenKind.LINE_COMMENT),
            of(LatentTokenKind.BLOCK_COMMENT),
            of(LatentTokenKind.BLOCK_COMMENT_UNTERMINATED));

    public static final TokenSet WHITESPACES = TokenSet.create(
            of(LatentTokenKind.WHITESPACE));

    public static final TokenSet STRINGS = TokenSet.create(
            of(LatentTokenKind.STRING),
            of(LatentTokenKind.STRING_UNTERMINATED),
            of(LatentTokenKind.STRING_INVALID_ESCAPE));

    private LatentTokenTypes() {
    }

    public static IElementType of(LatentTokenKind kind) {
        return BY_KIND.get(kind);
    }

    public static LatentTokenKind kindOf(IElementType type) {
        return BY_TYPE.get(type);
    }

    public static Map<LatentTokenKind, IElementType> all() {
        return Collections.unmodifiableMap(BY_KIND);
    }
}
