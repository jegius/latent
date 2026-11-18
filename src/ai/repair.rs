//! Self-repair исходника через AI-провайдера.

use super::error::Error;
use super::provider::AIProvider;

/// Self-repair (Часть VIII, §6): отправляет исходник + диагностику модели
/// и получает исправленный исходник. Бюджет попыток задаёт вызывающая сторона.
pub fn self_repair(
    provider: &dyn AIProvider,
    source: &str,
    diagnostic: &str,
) -> Result<String, Error> {
    let prompt = format!(
        "You are a code repair assistant for the Latent language.\n\
         The following program failed with this diagnostic:\n\
         DIAGNOSTIC: {}\n\nSOURCE:\n{}\n\n\
         Return ONLY the corrected Latent source code.",
        diagnostic, source
    );
    provider.infer(&prompt)
}