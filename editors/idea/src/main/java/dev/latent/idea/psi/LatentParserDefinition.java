package dev.latent.idea.psi;

import com.intellij.lang.ASTNode;
import com.intellij.lang.ParserDefinition;
import com.intellij.lexer.Lexer;
import com.intellij.lang.PsiParser;
import com.intellij.openapi.project.Project;
import com.intellij.psi.FileViewProvider;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import com.intellij.psi.tree.IFileElementType;
import com.intellij.psi.tree.TokenSet;
import dev.latent.idea.lexer.LatentLexer;
import dev.latent.idea.lexer.LatentTokenTypes;
import org.jetbrains.annotations.NotNull;

/** Регистрация лексера и парсера Latent в платформе. */
public final class LatentParserDefinition implements ParserDefinition {

    @Override
    public @NotNull Lexer createLexer(Project project) {
        return new LatentLexer();
    }

    @Override
    public @NotNull PsiParser createParser(Project project) {
        return new LatentParser();
    }

    @Override
    public @NotNull IFileElementType getFileNodeType() {
        return LatentElementTypes.FILE;
    }

    @Override
    public @NotNull TokenSet getWhitespaceTokens() {
        return LatentTokenTypes.WHITESPACES;
    }

    @Override
    public @NotNull TokenSet getCommentTokens() {
        return LatentTokenTypes.COMMENTS;
    }

    @Override
    public @NotNull TokenSet getStringLiteralElements() {
        return LatentTokenTypes.STRINGS;
    }

    @Override
    public @NotNull PsiElement createElement(@NotNull ASTNode node) {
        return new LatentDeclarationElement(node);
    }

    @Override
    public @NotNull PsiFile createFile(@NotNull FileViewProvider viewProvider) {
        return new LatentFile(viewProvider);
    }
}
