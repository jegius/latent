package dev.latent.idea.data;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/** Проверяет, что ресурс language.json скопирован и разбирается. */
public class LatentLanguageDataTest {

    @Test
    public void keywordsTypesAndBuiltinsAreLoaded() {
        LatentLanguageData data = LatentLanguageData.load();
        assertEquals(37, data.getKeywords().size());
        assertEquals(13, data.getSoftKeywords().size());
        assertEquals(24, data.getHardKeywords().size());
        assertTrue(data.getKeywords().stream().anyMatch(k -> "let".equals(k.name) && !k.soft));
        assertTrue(data.getKeywords().stream().anyMatch(k -> "test".equals(k.name) && k.soft));
        assertTrue(data.getTypes().stream().anyMatch(t -> "int".equals(t.name)));
        assertTrue(data.getTypes().stream().anyMatch(t -> "float".equals(t.name)));
    }

    @Test
    public void builtinsHaveSignaturesAndHostOnlyFlags() {
        LatentLanguageData data = LatentLanguageData.load();
        LatentLanguageData.Builtin print = null;
        for (LatentLanguageData.Builtin builtin : data.getBuiltins()) {
            if ("print".equals(builtin.name)) {
                print = builtin;
                break;
            }
        }
        assertNotNull(print);
        assertFalse(print.hostOnly);
        assertFalse(print.firstSignature().isEmpty());

        assertTrue(data.isHostOnly("tensor"));
        assertTrue(data.isHostOnly("channel"));
        assertFalse(data.isHostOnly("print"));
    }

    @Test
    public void completionListIsDeduplicated() {
        LatentLanguageData data = LatentLanguageData.load();
        assertTrue(data.getCompletionBuiltins().size() > 10);
        long unique = data.getCompletionBuiltins().stream().map(b -> b.name).distinct().count();
        assertEquals(data.getCompletionBuiltins().size(), unique);
    }
}
