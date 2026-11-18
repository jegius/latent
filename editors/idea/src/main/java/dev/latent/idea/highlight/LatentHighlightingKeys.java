package dev.latent.idea.highlight;

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import dev.latent.idea.lexer.LatentTokenKind;

import java.util.EnumMap;
import java.util.Map;

/**
 * Ключи подсветки Latent.
 *
 * <p>Цвета задаются в {@link LatentColorSettingsPage} и наследуются от стандартной схемы
 * (Darcula/IntelliJ Light), поэтому плагин выглядит уместно в любой теме.</p>
 */
public final class LatentHighlightingKeys {

    public static final TextAttributesKey KEYWORD = TextAttributesKey.createTextAttributesKey(
            "LATENT_KEYWORD", DefaultLanguageHighlighterColors.KEYWORD);

    public static final TextAttributesKey SOFT_KEYWORD = TextAttributesKey.createTextAttributesKey(
            "LATENT_SOFT_KEYWORD", DefaultLanguageHighlighterColors.KEYWORD);

    public static final TextAttributesKey TYPE = TextAttributesKey.createTextAttributesKey(
            "LATENT_TYPE", DefaultLanguageHighlighterColors.CLASS_NAME);

    public static final TextAttributesKey STRING = TextAttributesKey.createTextAttributesKey(
            "LATENT_STRING", DefaultLanguageHighlighterColors.STRING);

    public static final TextAttributesKey NUMBER = TextAttributesKey.createTextAttributesKey(
            "LATENT_NUMBER", DefaultLanguageHighlighterColors.NUMBER);

    public static final TextAttributesKey BOOLEAN = TextAttributesKey.createTextAttributesKey(
            "LATENT_BOOLEAN", DefaultLanguageHighlighterColors.KEYWORD);

    public static final TextAttributesKey COMMENT = TextAttributesKey.createTextAttributesKey(
            "LATENT_COMMENT", DefaultLanguageHighlighterColors.LINE_COMMENT);

    public static final TextAttributesKey OPERATOR = TextAttributesKey.createTextAttributesKey(
            "LATENT_OPERATOR", DefaultLanguageHighlighterColors.OPERATION_SIGN);

    public static final TextAttributesKey FUNCTION_DECL = TextAttributesKey.createTextAttributesKey(
            "LATENT_FUNCTION_DECL", DefaultLanguageHighlighterColors.FUNCTION_DECLARATION);

    public static final TextAttributesKey CLASS_DECL = TextAttributesKey.createTextAttributesKey(
            "LATENT_CLASS_DECL", DefaultLanguageHighlighterColors.CLASS_NAME);

    public static final TextAttributesKey ANNOTATION = TextAttributesKey.createTextAttributesKey(
            "LATENT_ANNOTATION", DefaultLanguageHighlighterColors.METADATA);

    public static final TextAttributesKey AI_PRIMITIVE = TextAttributesKey.createTextAttributesKey(
            "LATENT_AI_PRIMITIVE", DefaultLanguageHighlighterColors.KEYWORD);

    public static final TextAttributesKey IDENTIFIER = TextAttributesKey.createTextAttributesKey(
            "LATENT_IDENTIFIER", DefaultLanguageHighlighterColors.IDENTIFIER);

    public static final TextAttributesKey ERROR = TextAttributesKey.createTextAttributesKey(
            "LATENT_ERROR", DefaultLanguageHighlighterColors.INVALID_STRING_ESCAPE);

    private static final Map<LatentTokenKind, TextAttributesKey[]> KEYS =
            new EnumMap<>(LatentTokenKind.class);

    private static final TextAttributesKey[] EMPTY = new TextAttributesKey[0];

    static {
        KEYS.put(LatentTokenKind.WHITESPACE, EMPTY);
        put(LatentTokenKind.LINE_COMMENT, COMMENT);
        put(LatentTokenKind.BLOCK_COMMENT, COMMENT);
        put(LatentTokenKind.BLOCK_COMMENT_UNTERMINATED, COMMENT, ERROR);
        put(LatentTokenKind.STRING, STRING);
        put(LatentTokenKind.STRING_UNTERMINATED, STRING, ERROR);
        put(LatentTokenKind.STRING_INVALID_ESCAPE, STRING, ERROR);
        put(LatentTokenKind.NUMBER, NUMBER);
        put(LatentTokenKind.NUMBER_INVALID, NUMBER, ERROR);
        put(LatentTokenKind.IDENTIFIER, IDENTIFIER);
        put(LatentTokenKind.TYPE_NAME, TYPE);

        for (LatentTokenKind kind : LatentTokenKind.values()) {
            if (kind.isSoftKeyword()) {
                put(kind, SOFT_KEYWORD);
            } else if (kind.isKeyword()) {
                if (kind == LatentTokenKind.TRUE || kind == LatentTokenKind.FALSE) {
                    put(kind, BOOLEAN);
                } else {
                    put(kind, KEYWORD);
                }
            }
        }

        for (LatentTokenKind kind : LatentTokenKind.values()) {
            if (isOperator(kind)) {
                put(kind, OPERATOR);
            }
        }
        put(LatentTokenKind.AT, ANNOTATION);
        put(LatentTokenKind.BAD_CHARACTER, ERROR);
    }

    private LatentHighlightingKeys() {
    }

    private static boolean isOperator(LatentTokenKind kind) {
        return kind.compareTo(LatentTokenKind.FAT_ARROW) >= 0
                && kind.compareTo(LatentTokenKind.RBRACKET) <= 0;
    }

    private static void put(LatentTokenKind kind, TextAttributesKey... keys) {
        KEYS.put(kind, keys);
    }

    public static TextAttributesKey[] keysFor(LatentTokenKind kind) {
        TextAttributesKey[] keys = KEYS.get(kind);
        return keys == null ? EMPTY : keys;
    }
}
