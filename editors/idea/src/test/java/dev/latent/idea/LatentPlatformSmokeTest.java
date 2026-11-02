package dev.latent.idea;

import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.psi.PsiFile;
import com.intellij.testFramework.fixtures.BasePlatformTestCase;
import dev.latent.idea.highlight.LatentHighlightingKeys;
import dev.latent.idea.psi.LatentFile;

import java.util.List;

/**
 * Дымовые тесты на реальной платформе IntelliJ: регистрация файлового типа, парсер,
 * подсветка и аннотатор.
 */
public class LatentPlatformSmokeTest extends BasePlatformTestCase {

    public void testFileTypeAndParserAreRegistered() {
        PsiFile file = myFixture.configureByText("main.lat",
                "fn main() -> int {\n"
                        + "    let x = 1;\n"
                        + "    return x;\n"
                        + "}\n");
        assertTrue(file instanceof LatentFile);
        assertEquals(LatentLanguage.INSTANCE, file.getLanguage());
        assertNotNull(file.getNode());
        assertTrue(file.getNode().getTextLength() > 0);
    }

    public void testAnnotatorReportsUnterminatedString() {
        myFixture.configureByText("bad.lat",
                "fn main() -> int {\n"
                        + "    let s = \"abc\n"
                        + "    return 0;\n"
                        + "}\n");
        List<?> infos = myFixture.doHighlighting();
        boolean found = false;
        for (Object info : infos) {
            com.intellij.codeInsight.daemon.impl.HighlightInfo highlight =
                    (com.intellij.codeInsight.daemon.impl.HighlightInfo) info;
            if (highlight.getDescription() != null
                    && highlight.getDescription().contains("Незавершённая строка")) {
                found = true;
                break;
            }
        }
        assertTrue("аннотатор должен сообщить о незакрытой строке", found);
    }

    public void testHighlighterHasKeywordAttributes() {
        myFixture.configureByText("a.lat", "let x = 1;");
        TextAttributesKey[] keys = LatentHighlightingKeys.keysFor(
                dev.latent.idea.lexer.LatentTokenKind.LET);
        assertEquals(LatentHighlightingKeys.KEYWORD, keys[0]);
        assertNotNull(LatentHighlightingKeys.KEYWORD.getDefaultAttributes());
    }

    public void testValidFileHasNoErrorAnnotations() {
        myFixture.configureByText("valid.lat",
                "@test(\"smoke\")\n"
                        + "fn main() -> int {\n"
                        + "    let s = \"a\\n\\\"b\\\"\";\n"
                        + "    let xs = [1, 2, 3];\n"
                        + "    for (let x in xs) {\n"
                        + "        if (x > 1 && x < 3) { print(x); }\n"
                        + "    }\n"
                        + "    let f = fn(y) => y * 2;\n"
                        + "    return f(2);\n"
                        + "}\n"
                        + "\n"
                        + "class P { x: int; fn init(v: int) { this.x = v; } }\n"
                        + "enum E { A, B(int) }\n");
        for (Object info : myFixture.doHighlighting()) {
            com.intellij.codeInsight.daemon.impl.HighlightInfo highlight =
                    (com.intellij.codeInsight.daemon.impl.HighlightInfo) info;
            assertTrue("неожиданная ошибка: " + highlight.getDescription(),
                    highlight.getSeverity().compareTo(HighlightSeverity.ERROR) < 0);
        }
    }

    public void testCompletionIncludesKeywordsAndBuiltins() {
        myFixture.configureByText("complete.lat",
                "fn main() -> int {\n"
                        + "    <caret>\n"
                        + "    return 0;\n"
                        + "}\n");
        myFixture.completeBasic();
        com.intellij.codeInsight.lookup.LookupElement[] elements = myFixture.getLookupElements();
        assertNotNull(elements);
        java.util.Set<String> strings = new java.util.HashSet<>();
        for (com.intellij.codeInsight.lookup.LookupElement element : elements) {
            strings.add(element.getLookupString());
        }
        assertTrue("ожидалось ключевое слово fn", strings.contains("fn"));
        assertTrue("ожидался builtin print", strings.contains("print"));
        assertTrue("ожидался тип int", strings.contains("int"));
    }

    public void testParserBuildsDeclarationNodes() {
        PsiFile file = myFixture.configureByText("decl.lat",
                "fn f() -> int { return 1; }\n"
                        + "class C { x: int; fn init() { } }\n"
                        + "enum E { A, B }\n");
        java.util.Collection<dev.latent.idea.psi.LatentDeclarationElement> elements =
                com.intellij.psi.util.PsiTreeUtil.findChildrenOfType(
                        file, dev.latent.idea.psi.LatentDeclarationElement.class);
        boolean hasFunction = false;
        boolean hasClass = false;
        boolean hasEnum = false;
        for (dev.latent.idea.psi.LatentDeclarationElement element : elements) {
            if (element.getNode().getElementType() == dev.latent.idea.psi.LatentElementTypes.FUNCTION) {
                hasFunction = true;
            } else if (element.getNode().getElementType() == dev.latent.idea.psi.LatentElementTypes.CLASS) {
                hasClass = true;
            } else if (element.getNode().getElementType() == dev.latent.idea.psi.LatentElementTypes.ENUM) {
                hasEnum = true;
            }
        }
        assertTrue(hasFunction);
        assertTrue(hasClass);
        assertTrue(hasEnum);
    }

    public void testFoldingRegionsForBlocks() {
        PsiFile file = myFixture.configureByText("fold.lat",
                "fn main() -> int {\n"
                        + "    if (true) {\n"
                        + "        return 0;\n"
                        + "    }\n"
                        + "    return 1;\n"
                        + "}\n");
        com.intellij.openapi.editor.Document document =
                com.intellij.psi.PsiDocumentManager.getInstance(getProject()).getDocument(file);
        assertNotNull(document);
        com.intellij.lang.folding.FoldingDescriptor[] regions =
                new dev.latent.idea.folding.LatentFoldingBuilder()
                        .buildFoldRegions(file.getNode(), document);
        assertTrue("ожидались сворачиваемые блоки", regions.length >= 2);
    }

    public void testRunConfigurationStoresFilePath() {
        com.intellij.execution.configurations.ConfigurationFactory factory =
                dev.latent.idea.run.LatentRunConfigurationType.getInstance()
                        .getConfigurationFactories()[0];
        com.intellij.execution.configurations.RunConfiguration template =
                factory.createTemplateConfiguration(getProject());
        assertTrue(template instanceof dev.latent.idea.run.LatentRunConfiguration);
        dev.latent.idea.run.LatentRunConfiguration configuration =
                (dev.latent.idea.run.LatentRunConfiguration) template;
        configuration.setFilePath("/tmp/example.lat");
        assertEquals("/tmp/example.lat", configuration.getFilePath());
        assertNotNull(configuration.getConfigurationEditor());
    }

    public void testApplicationSettingsServiceIsAvailable() {
        dev.latent.idea.settings.LatentSettings settings =
                dev.latent.idea.settings.LatentSettings.getInstance();
        assertNotNull(settings);
        assertEquals("latentc", settings.getState().latentcPath);
        assertEquals("node", settings.getState().nodePath);
    }

    public void testSettingsConfigurableCreatesUi() {
        dev.latent.idea.settings.LatentConfigurable configurable =
                new dev.latent.idea.settings.LatentConfigurable();
        javax.swing.JComponent component = configurable.createComponent();
        assertNotNull(component);
        assertFalse(configurable.isModified());
        configurable.disposeUIResources();
    }

    public void testColorSettingsPageAndIcons() {
        dev.latent.idea.highlight.LatentColorSettingsPage page =
                new dev.latent.idea.highlight.LatentColorSettingsPage();
        assertTrue(page.getAttributeDescriptors().length >= 10);
        assertNotNull(page.getHighlighter().getHighlightingLexer());
        assertTrue(page.getDemoText().contains("fn"));
        assertNotNull(dev.latent.idea.LatentIcons.FILE);
    }

    public void testStructureViewShowsDeclarations() {
        PsiFile file = myFixture.configureByText("structure.lat",
                "fn a() -> int { return 1; }\n"
                        + "class C { fn m() { } }\n"
                        + "enum E { A }\n");
        com.intellij.openapi.fileEditor.FileEditor fileEditor =
                com.intellij.openapi.fileEditor.FileEditorManager.getInstance(getProject())
                        .getSelectedEditor(file.getVirtualFile());
        assertNotNull(fileEditor);
        com.intellij.ide.structureView.StructureView view =
                new dev.latent.idea.structureview.LatentStructureViewBuilder()
                        .createStructureView(fileEditor, getProject());
        assertNotNull(view);
        com.intellij.ide.structureView.StructureViewTreeElement root =
                (com.intellij.ide.structureView.StructureViewTreeElement)
                        view.getTreeModel().getRoot();
        assertNotNull(root);
        assertTrue(root.getChildren().length >= 3);
    }

    public void testRunLineMarkerOnMain() {
        PsiFile file = myFixture.configureByText("marker.lat",
                "fn main() -> int { return 0; }\n");
        com.intellij.psi.PsiElement leaf = file.findElementAt(0);
        assertNotNull(leaf);
        com.intellij.execution.lineMarker.RunLineMarkerContributor.Info info =
                new dev.latent.idea.run.LatentRunLineMarkerContributor().getInfo(leaf);
        assertNotNull(info);
        assertNotNull(info.icon);
    }
}
