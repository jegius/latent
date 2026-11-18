package dev.latent.idea.editor;

import com.intellij.lang.Commenter;
import org.jetbrains.annotations.Nullable;

/** Комментарии Latent: строчные {@code //} и блочные {@code /* *&#47;}. */
public final class LatentCommenter implements Commenter {

    @Override
    public String getLineCommentPrefix() {
        return "// ";
    }

    @Override
    public String getBlockCommentPrefix() {
        return "/*";
    }

    @Override
    public String getBlockCommentSuffix() {
        return "*/";
    }

    @Override
    public @Nullable String getCommentedBlockCommentPrefix() {
        return null;
    }

    @Override
    public @Nullable String getCommentedBlockCommentSuffix() {
        return null;
    }
}
