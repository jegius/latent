package dev.latent.idea.data;

import com.google.gson.Gson;
import com.intellij.openapi.util.text.StringUtil;
import org.jetbrains.annotations.NotNull;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Данные о языке из {@code /language/latent-language.json} — копии
 * {@code tooling/language-data/language.json} (единого источника правды о языке).
 *
 * <p>Используется автодополнением, аннотатором и документацией в подсказках. Если ресурс
 * недоступен или повреждён, работает встроенный минимальный fallback, чтобы плагин не падал.</p>
 */
public final class LatentLanguageData {

    private static final String RESOURCE = "/language/latent-language.json";

    /** Ключевое слово или мягкое ключевое слово. */
    public static final class Keyword {
        public String name = "";
        public boolean soft;
        public String category = "";
        public String summary = "";
        public String syntax = "";
        public String engine = "";
        public String docs = "";
    }

    /** Тип языка. */
    public static final class TypeInfo {
        public String name = "";
        public String category = "";
        public String wasm = "";
        public String summary = "";
        public String syntax = "";
        public String engine = "";
    }

    /** Встроенная функция, метод, свойство или host-примитив. */
    public static final class Builtin {
        public String name = "";
        public String kind = "";
        public String owner = "";
        public List<String> signatures = new ArrayList<>();
        public String summary = "";
        public String example = "";
        public String engine = "";
        public String docs = "";
        public boolean hostOnly;

        public String firstSignature() {
            return signatures == null || signatures.isEmpty() ? name : signatures.get(0);
        }
    }

    private static final class Root {
        List<Keyword> keywords = new ArrayList<>();
        List<TypeInfo> types = new ArrayList<>();
        List<Builtin> builtins = new ArrayList<>();
        List<String> hostOnly = new ArrayList<>();
    }

    private static volatile LatentLanguageData instance;

    private final List<Keyword> keywords;
    private final List<TypeInfo> types;
    private final List<Builtin> builtins;
    private final Set<String> hostOnly;
    private final List<Builtin> completionBuiltins;

    private LatentLanguageData(List<Keyword> keywords, List<TypeInfo> types,
                               List<Builtin> builtins, Set<String> hostOnly) {
        this.keywords = Collections.unmodifiableList(keywords);
        this.types = Collections.unmodifiableList(types);
        this.hostOnly = Collections.unmodifiableSet(hostOnly);
        List<Builtin> prepared = new ArrayList<>();
        Map<String, Builtin> unique = new LinkedHashMap<>();
        for (Builtin builtin : builtins) {
            if (StringUtil.isEmpty(builtin.name)) {
                continue;
            }
            builtin.hostOnly = hostOnly.contains(builtin.name);
            unique.putIfAbsent(builtin.name, builtin);
        }
        prepared.addAll(unique.values());
        this.builtins = Collections.unmodifiableList(builtins);
        this.completionBuiltins = Collections.unmodifiableList(prepared);
    }

    public static @NotNull LatentLanguageData getInstance() {
        LatentLanguageData local = instance;
        if (local == null) {
            synchronized (LatentLanguageData.class) {
                local = instance;
                if (local == null) {
                    local = load();
                    instance = local;
                }
            }
        }
        return local;
    }

    /** Загружает данные заново (используется тестами). */
    public static @NotNull LatentLanguageData load() {
        try (InputStream stream = LatentLanguageData.class.getResourceAsStream(RESOURCE)) {
            if (stream != null) {
                try (Reader reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                    Root root = new Gson().fromJson(reader, Root.class);
                    if (root != null) {
                        Set<String> host = root.hostOnly == null
                                ? new HashSet<>() : new HashSet<>(root.hostOnly);
                        return new LatentLanguageData(
                                root.keywords == null ? new ArrayList<>() : root.keywords,
                                root.types == null ? new ArrayList<>() : root.types,
                                root.builtins == null ? new ArrayList<>() : root.builtins,
                                host);
                    }
                }
            }
        } catch (Exception ignored) {
            // Ниже — встроенный fallback.
        }
        return fallback();
    }

    public List<Keyword> getKeywords() {
        return keywords;
    }

    public List<Keyword> getSoftKeywords() {
        List<Keyword> result = new ArrayList<>();
        for (Keyword keyword : keywords) {
            if (keyword.soft) {
                result.add(keyword);
            }
        }
        return result;
    }

    public List<Keyword> getHardKeywords() {
        List<Keyword> result = new ArrayList<>();
        for (Keyword keyword : keywords) {
            if (!keyword.soft) {
                result.add(keyword);
            }
        }
        return result;
    }

    public List<TypeInfo> getTypes() {
        return types;
    }

    public List<Builtin> getBuiltins() {
        return builtins;
    }

    public List<Builtin> getCompletionBuiltins() {
        return completionBuiltins;
    }

    public List<Builtin> getFunctions() {
        return filterByKind("function", "host-function", "macro", "constructor");
    }

    public List<Builtin> getMethods() {
        return filterByKind("method", "property");
    }

    public boolean isHostOnly(String name) {
        return hostOnly.contains(name);
    }

    private List<Builtin> filterByKind(String... kinds) {
        Set<String> wanted = new HashSet<>();
        Collections.addAll(wanted, kinds);
        List<Builtin> result = new ArrayList<>();
        for (Builtin builtin : completionBuiltins) {
            String kind = builtin.kind == null ? "" : builtin.kind;
            if (wanted.contains(kind)) {
                result.add(builtin);
            }
        }
        return result;
    }

    private static LatentLanguageData fallback() {
        List<Keyword> keywords = new ArrayList<>();
        String[] hard = {"let", "fn", "if", "else", "while", "for", "in", "return",
                "class", "new", "this", "async", "await", "spawn", "channel", "select",
                "default", "yield", "match", "enum", "true", "false", "null", "ai"};
        String[] soft = {"test", "assert", "assert_eq", "forall", "snapshot", "ai_contract",
                "enforce_contract", "model", "agent", "embedding", "tensor", "semantic", "case"};
        for (String name : hard) {
            Keyword keyword = new Keyword();
            keyword.name = name;
            keywords.add(keyword);
        }
        for (String name : soft) {
            Keyword keyword = new Keyword();
            keyword.name = name;
            keyword.soft = true;
            keywords.add(keyword);
        }

        List<TypeInfo> types = new ArrayList<>();
        for (String name : new String[]{"int", "float", "bool", "string", "unit", "void", "channel"}) {
            TypeInfo type = new TypeInfo();
            type.name = name;
            types.add(type);
        }

        List<Builtin> builtins = new ArrayList<>();
        String[] functions = {"print", "len", "push", "str", "int", "float", "sqrt",
                "assert", "assert_eq", "alloc", "load8", "store8", "load32", "store32",
                "memcopy", "pop", "channel"};
        for (String name : functions) {
            Builtin builtin = new Builtin();
            builtin.name = name;
            builtin.kind = "function";
            builtins.add(builtin);
        }
        Set<String> hostOnly = new HashSet<>();
        for (String name : new String[]{"tensor", "semantic", "matmul", "cosine_similarity",
                "dot", "magnitude", "zeros", "ones", "snapshot", "ai_contract",
                "enforce_contract", "ai_infer", "ai_embed", "ai_stream", "stream_next",
                "channel"}) {
            hostOnly.add(name);
        }
        return new LatentLanguageData(keywords, types, builtins, hostOnly);
    }
}
