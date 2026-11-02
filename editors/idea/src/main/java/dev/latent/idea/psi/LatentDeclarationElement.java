package dev.latent.idea.psi;

import com.intellij.extapi.psi.ASTWrapperPsiElement;
import com.intellij.lang.ASTNode;
import org.jetbrains.annotations.NotNull;

/**
 * Универсальный PSI-элемент для составных узлов Latent.
 *
 * <p>Полноценное PSI-дерево языку пока не нужно: плагин работает на уровне токенов,
 * а составные узлы (функция/класс/enum/блок) используются фолдингом и навигацией.</p>
 */
public class LatentDeclarationElement extends ASTWrapperPsiElement {

    public LatentDeclarationElement(@NotNull ASTNode node) {
        super(node);
    }
}
