package dev.latent.idea.editor;

import com.intellij.codeInsight.editorActions.enter.EnterHandlerDelegateAdapter;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.util.TextRange;
import com.intellij.psi.PsiFile;
import dev.latent.idea.psi.LatentFile;
import org.jetbrains.annotations.NotNull;

/** Отступы по {@code { }} при нажатии Enter. */
public final class LatentEnterHandler extends EnterHandlerDelegateAdapter {

    @Override
    public Result postProcessEnter(@NotNull PsiFile file, @NotNull Editor editor,
                                   @NotNull DataContext dataContext) {
        if (!(file instanceof LatentFile)) {
            return Result.Continue;
        }
        Document document = editor.getDocument();
        int caret = editor.getCaretModel().getOffset();
        int line = document.getLineNumber(caret);
        int lineStart = document.getLineStartOffset(line);
        if (!document.getText(new TextRange(lineStart, caret)).trim().isEmpty()) {
            return Result.Continue;
        }
        int indent = LatentIndentUtil.computeIndent(document.getCharsSequence(), lineStart, caret);
        if (indent == caret - lineStart) {
            return Result.Continue;
        }
        String spaces = " ".repeat(Math.max(0, indent));
        document.replaceString(lineStart, caret, spaces);
        editor.getCaretModel().moveToOffset(lineStart + spaces.length());
        return Result.Stop;
    }
}
