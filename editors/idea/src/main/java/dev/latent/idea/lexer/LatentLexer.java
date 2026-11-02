package dev.latent.idea.lexer;

import com.intellij.lexer.LexerBase;
import com.intellij.psi.tree.IElementType;
import org.jetbrains.annotations.NotNull;

/**
 * IntelliJ-лексер Latent: обёртка над чистым {@link LatentScanner}.
 *
 * <p>Состояние всегда равно 0: разбиение на токены не зависит от предыдущих токенов,
 * поэтому инкрементальная переподсветка может начинаться с любого места.</p>
 */
public final class LatentLexer extends LexerBase {

    private CharSequence buffer = "";
    private int bufferEnd;
    private int tokenStart;
    private int tokenEnd;
    private LatentTokenKind tokenKind;

    @Override
    public void start(@NotNull CharSequence buffer, int startOffset, int endOffset, int initialState) {
        this.buffer = buffer;
        this.bufferEnd = Math.min(endOffset, buffer.length());
        this.tokenStart = Math.max(0, Math.min(startOffset, this.bufferEnd));
        this.tokenEnd = this.tokenStart;
        this.tokenKind = null;
        locateToken();
    }

    private void locateToken() {
        if (tokenStart >= bufferEnd) {
            tokenKind = null;
            tokenEnd = bufferEnd;
            return;
        }
        LatentScanner.Token token = LatentScanner.nextToken(buffer, tokenStart);
        if (token == null || token.getEnd() <= tokenStart) {
            tokenKind = null;
            tokenEnd = bufferEnd;
            return;
        }
        tokenKind = token.getKind();
        tokenEnd = Math.min(token.getEnd(), bufferEnd);
    }

    @Override
    public int getState() {
        return 0;
    }

    @Override
    public IElementType getTokenType() {
        return tokenKind == null ? null : LatentTokenTypes.of(tokenKind);
    }

    @Override
    public int getTokenStart() {
        return tokenStart;
    }

    @Override
    public int getTokenEnd() {
        return tokenEnd;
    }

    @Override
    public void advance() {
        tokenStart = tokenEnd;
        locateToken();
    }

    @Override
    public @NotNull CharSequence getBufferSequence() {
        return buffer;
    }

    @Override
    public int getBufferEnd() {
        return bufferEnd;
    }
}
