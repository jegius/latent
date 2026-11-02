package dev.latent.idea.psi;

import com.intellij.lang.ASTNode;
import com.intellij.lang.PsiBuilder;
import com.intellij.lang.PsiParser;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.lexer.LatentTokenTypes;
import org.jetbrains.annotations.NotNull;

/**
 * Минимальный толерантный парсер Latent.
 *
 * <p>Задача парсера — не построить полное AST (это делает компилятор), а дать платформе
 * устойчивые составные узлы для фолдинга, навигации и структуры файла. Поэтому ошибки
 * не являются ошибками: любой «мусор» просто становится токенами внутри файла.</p>
 */
public final class LatentParser implements PsiParser {

    @Override
    public @NotNull ASTNode parse(@NotNull IElementType root, @NotNull PsiBuilder builder) {
        builder.setDebugMode(false);
        PsiBuilder.Marker rootMarker = builder.mark();
        while (!builder.eof()) {
            parseTopLevelItem(builder);
        }
        rootMarker.done(root);
        return builder.getTreeBuilt();
    }

    private void parseTopLevelItem(PsiBuilder builder) {
        IElementType type = builder.getTokenType();
        if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.FN)) {
            parseFunction(builder);
        } else if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.CLASS)) {
            parseClass(builder);
        } else if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.ENUM)) {
            parseEnum(builder);
        } else {
            builder.advanceLexer();
        }
    }

    private void parseFunction(PsiBuilder builder) {
        PsiBuilder.Marker marker = builder.mark();
        builder.advanceLexer(); // fn
        if (!builder.eof() && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LPAREN)) {
            builder.advanceLexer(); // имя функции (включая мягкие ключевые слова)
        }
        skipBalanced(builder, dev.latent.idea.lexer.LatentTokenKind.LPAREN);
        while (!builder.eof()) {
            IElementType type = builder.getTokenType();
            if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)
                    || type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.SEMICOLON)
                    || type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RBRACE)) {
                break;
            }
            builder.advanceLexer();
        }
        if (builder.getTokenType() == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            parseBlock(builder);
        }
        marker.done(LatentElementTypes.FUNCTION);
    }

    private void parseClass(PsiBuilder builder) {
        PsiBuilder.Marker marker = builder.mark();
        builder.advanceLexer(); // class
        if (!builder.eof() && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer(); // имя класса
        }
        while (!builder.eof()
                && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer();
        }
        if (builder.getTokenType() == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer();
            while (!builder.eof()
                    && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RBRACE)) {
                IElementType type = builder.getTokenType();
                if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.FN)) {
                    parseFunction(builder);
                } else if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
                    parseBlock(builder);
                } else {
                    builder.advanceLexer();
                }
            }
            if (builder.getTokenType() == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RBRACE)) {
                builder.advanceLexer();
            }
        }
        marker.done(LatentElementTypes.CLASS);
    }

    private void parseEnum(PsiBuilder builder) {
        PsiBuilder.Marker marker = builder.mark();
        builder.advanceLexer(); // enum
        if (!builder.eof() && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer(); // имя enum
        }
        while (!builder.eof()
                && builder.getTokenType() != LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer();
        }
        if (builder.getTokenType() == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            int depth = 0;
            do {
                IElementType type = builder.getTokenType();
                if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
                    depth++;
                } else if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RBRACE)) {
                    depth--;
                }
                builder.advanceLexer();
            } while (!builder.eof() && depth > 0);
        }
        marker.done(LatentElementTypes.ENUM);
    }

    private void parseBlock(PsiBuilder builder) {
        PsiBuilder.Marker marker = builder.mark();
        if (builder.getTokenType() == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
            builder.advanceLexer();
        }
        while (!builder.eof()) {
            IElementType type = builder.getTokenType();
            if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RBRACE)) {
                builder.advanceLexer();
                break;
            }
            if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.LBRACE)) {
                parseBlock(builder);
            } else {
                builder.advanceLexer();
            }
        }
        marker.done(LatentElementTypes.BLOCK);
    }

    private void skipBalanced(PsiBuilder builder, dev.latent.idea.lexer.LatentTokenKind openKind) {
        IElementType open = LatentTokenTypes.of(openKind);
        if (builder.getTokenType() != open) {
            return;
        }
        int depth = 0;
        while (!builder.eof()) {
            IElementType type = builder.getTokenType();
            if (type == open) {
                depth++;
            } else if (type == LatentTokenTypes.of(dev.latent.idea.lexer.LatentTokenKind.RPAREN)) {
                depth--;
                builder.advanceLexer();
                if (depth <= 0) {
                    return;
                }
                continue;
            }
            builder.advanceLexer();
        }
    }
}
