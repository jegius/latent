// hotkeys.js — глобальные горячие клавиши Latent IDE (IntelliJ-style).
// Единственная ответственность: перехват keydown и вызов команд контроллера.
// Не знает, как создаётся IDE: получает геттер, чтобы не зависеть от загрузки.

/**
 * @param {() => ({handleCompile: Function, handleSave: Function,
 *   handleFormat: Function, updateCursorStatus: Function}|null)} getIde
 */
export function installHotkeys(getIde) {
    document.addEventListener('keydown', (e) => {
        const ide = getIde();
        if (!ide) return;
        // Пока открыта модалка — не перехватываем глобальные комбинации.
        if (document.getElementById('portal-root')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) ide.handleCompile(true);
            else ide.handleCompile(false);
        }
        if (mod && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            ide.handleSave();
        }
        // Format Code: Ctrl/⌘+Alt+L (как в IntelliJ IDEA)
        if (mod && e.altKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            ide.handleFormat();
        }
        // Обновление позиции курсора в статус-баре
        setTimeout(() => ide.updateCursorStatus(), 0);
    });
}
