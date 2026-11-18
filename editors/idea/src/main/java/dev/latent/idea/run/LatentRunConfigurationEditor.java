package dev.latent.idea.run;

import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.options.SettingsEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.TextBrowseFolderListener;
import com.intellij.openapi.ui.TextFieldWithBrowseButton;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.ui.FormBuilder;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.JComponent;
import javax.swing.JPanel;

/** Редактор конфигурации запуска: единственное поле — путь к .lat-файлу. */
public final class LatentRunConfigurationEditor extends SettingsEditor<LatentRunConfiguration> {

    private final Project project;
    private final TextFieldWithBrowseButton fileField = new TextFieldWithBrowseButton();
    private JPanel panel;

    public LatentRunConfigurationEditor(Project project) {
        this.project = project;
    }

    @Override
    protected @NotNull JComponent createEditor() {
        FileChooserDescriptor descriptor = new FileChooserDescriptor(
                true, false, false, false, false, false);
        descriptor.setTitle("Выберите файл Latent");
        descriptor.setDescription("Файл с расширением .lat");
        fileField.addBrowseFolderListener(new TextBrowseFolderListener(descriptor, project));

        JBLabel hint = new JBLabel("<html><body style='width:420px'>"
                + "Плагин компилирует файл через <code>latentc</code> (или "
                + "<code>web-ide/compiler.wasm</code>) и запускает WASM в Node.js. "
                + "Пути настраиваются в Settings → Tools → Latent."
                + "</body></html>");

        panel = FormBuilder.createFormBuilder()
                .addLabeledComponent(new JBLabel("Файл Latent:"), fileField, 1, false)
                .addComponent(hint)
                .addComponentFillVertically(new JPanel(), 0)
                .getPanel();
        panel.setBorder(JBUI.Borders.empty(8));
        return panel;
    }

    @Override
    protected void resetEditorFrom(@NotNull LatentRunConfiguration configuration) {
        fileField.setText(configuration.getFilePath());
    }

    @Override
    protected void applyEditorTo(@NotNull LatentRunConfiguration configuration) {
        configuration.setFilePath(fileField.getText().trim());
    }
}
