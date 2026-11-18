package dev.latent.idea.settings;

import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.ui.TextBrowseFolderListener;
import com.intellij.openapi.ui.TextFieldWithBrowseButton;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.ui.FormBuilder;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.JPanel;

/** Settings → Tools → Latent. */
public final class LatentConfigurable implements Configurable {

    private final TextFieldWithBrowseButton latentcField = new TextFieldWithBrowseButton();
    private final TextFieldWithBrowseButton nodeField = new TextFieldWithBrowseButton();
    private final TextFieldWithBrowseButton compilerWasmField = new TextFieldWithBrowseButton();
    private JPanel panel;

    @Override
    public @Nls String getDisplayName() {
        return "Latent";
    }

    @Override
    public @Nullable String getHelpTopic() {
        return null;
    }

    @Override
    public @Nullable JComponent createComponent() {
        FileChooserDescriptor executable = new FileChooserDescriptor(
                true, false, false, false, false, false);
        executable.setTitle("Выберите исполняемый файл");
        latentcField.addBrowseFolderListener(new TextBrowseFolderListener(executable));
        nodeField.addBrowseFolderListener(new TextBrowseFolderListener(executable));

        FileChooserDescriptor wasm = new FileChooserDescriptor(
                true, false, false, false, false, false);
        wasm.setTitle("Выберите compiler.wasm");
        compilerWasmField.addBrowseFolderListener(new TextBrowseFolderListener(wasm));

        JBLabel hint = new JBLabel("<html><body style='width:520px'>"
                + "<b>latentc</b> — компилятор Latent (Rust, <code>latentc compile &lt;file&gt; &lt;out.wasm&gt;</code>). "
                + "Если он не найден, плагин компилирует через <code>web-ide/compiler.wasm</code> "
                + "с помощью Node.js.<br>"
                + "<b>node</b> — интерпретатор Node.js, который запускает WASM-программу "
                + "(нужен и для fallback-компиляции).<br>"
                + "Пустое поле <b>compiler.wasm</b> означает поиск в <code>&lt;project&gt;/web-ide/compiler.wasm</code> "
                + "и встроенную копию плагина."
                + "</body></html>");
        hint.setForeground(JBColor.GRAY);
        hint.setBorder(JBUI.Borders.emptyTop(8));

        panel = FormBuilder.createFormBuilder()
                .addLabeledComponent(new JBLabel("Путь к latentc:"), latentcField, 1, false)
                .addLabeledComponent(new JBLabel("Путь к node:"), nodeField, 1, false)
                .addLabeledComponent(new JBLabel("Путь к compiler.wasm:"), compilerWasmField, 1, false)
                .addComponent(hint)
                .addComponentFillVertically(new JPanel(), 0)
                .getPanel();
        panel.setBorder(JBUI.Borders.empty(8));
        reset();
        return panel;
    }

    @Override
    public boolean isModified() {
        LatentSettings.State state = LatentSettings.getInstance().getState();
        return !latentcField.getText().equals(state.latentcPath)
                || !nodeField.getText().equals(state.nodePath)
                || !compilerWasmField.getText().equals(state.compilerWasmPath);
    }

    @Override
    public void apply() {
        LatentSettings.State state = LatentSettings.getInstance().getState();
        state.latentcPath = latentcField.getText().trim();
        state.nodePath = nodeField.getText().trim();
        state.compilerWasmPath = compilerWasmField.getText().trim();
        if (state.latentcPath.isEmpty()) {
            state.latentcPath = "latentc";
        }
        if (state.nodePath.isEmpty()) {
            state.nodePath = "node";
        }
    }

    @Override
    public void reset() {
        LatentSettings.State state = LatentSettings.getInstance().getState();
        latentcField.setText(state.latentcPath == null ? "" : state.latentcPath);
        nodeField.setText(state.nodePath == null ? "" : state.nodePath);
        compilerWasmField.setText(state.compilerWasmPath == null ? "" : state.compilerWasmPath);
    }

    @Override
    public void disposeUIResources() {
        panel = null;
    }
}
