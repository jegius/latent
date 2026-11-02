package dev.latent.idea.highlight;

import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.openapi.fileTypes.SyntaxHighlighter;
import com.intellij.openapi.options.colors.AttributesDescriptor;
import com.intellij.openapi.options.colors.ColorDescriptor;
import com.intellij.openapi.options.colors.ColorSettingsPage;
import dev.latent.idea.LatentIcons;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;
import java.util.HashMap;
import java.util.Map;

/** Страница «Editor → Color Scheme → Latent» с образцом кода. */
public final class LatentColorSettingsPage implements ColorSettingsPage {

    private static final AttributesDescriptor[] DESCRIPTORS = {
            new AttributesDescriptor("Ключевое слово", LatentHighlightingKeys.KEYWORD),
            new AttributesDescriptor("Мягкое ключевое слово", LatentHighlightingKeys.SOFT_KEYWORD),
            new AttributesDescriptor("Тип", LatentHighlightingKeys.TYPE),
            new AttributesDescriptor("Строка", LatentHighlightingKeys.STRING),
            new AttributesDescriptor("Число", LatentHighlightingKeys.NUMBER),
            new AttributesDescriptor("Логическое значение", LatentHighlightingKeys.BOOLEAN),
            new AttributesDescriptor("Комментарий", LatentHighlightingKeys.COMMENT),
            new AttributesDescriptor("Оператор", LatentHighlightingKeys.OPERATOR),
            new AttributesDescriptor("Имя функции", LatentHighlightingKeys.FUNCTION_DECL),
            new AttributesDescriptor("Имя класса/enum", LatentHighlightingKeys.CLASS_DECL),
            new AttributesDescriptor("Декоратор", LatentHighlightingKeys.ANNOTATION),
            new AttributesDescriptor("AI-примитив", LatentHighlightingKeys.AI_PRIMITIVE),
            new AttributesDescriptor("Идентификатор", LatentHighlightingKeys.IDENTIFIER),
            new AttributesDescriptor("Ошибка", LatentHighlightingKeys.ERROR),
    };

    private static final String DEMO_TEXT =
            "<com>// Демонстрация подсветки Latent</com>\n"
                    + "<ann>@test</ann>(\"demo\")\n"
                    + "<kw>fn</kw> <fn>main</fn>() -&gt; <type>int</type> {\n"
                    + "    <kw>let</kw> <id>items</id>: <type>[int]</type> = [<num>1</num>, <num>2</num>, <num>3</num>];\n"
                    + "    <kw>let</kw> <id>total</id> = <num>0</num>;\n"
                    + "    <kw>for</kw> (<kw>let</kw> <id>x</id> <kw>in</kw> <id>items</id>) {\n"
                    + "        <id>total</id> = <id>total</id> <op>+</op> <id>x</id>;\n"
                    + "    }\n"
                    + "    <kw>if</kw> (<id>total</id> <op>&gt;</op> <num>5</num> <op>&amp;&amp;</op> <bool>true</bool>) {\n"
                    + "        <ai>print</ai>(\"total =\", <id>total</id>);\n"
                    + "    }\n"
                    + "    <kw>return</kw> <id>total</id>;\n"
                    + "}\n"
                    + "\n"
                    + "<kw>class</kw> <cls>Point</cls> {\n"
                    + "    <id>x</id>: <type>int</type>;\n"
                    + "    <id>y</id>: <type>int</type>;\n"
                    + "    <kw>fn</kw> <fn>init</fn>(<id>x</id>: <type>int</type>, <id>y</id>: <type>int</type>) {\n"
                    + "        <kw>this</kw>.<id>x</id> = <id>x</id>;\n"
                    + "        <kw>this</kw>.<id>y</id> = <id>y</id>;\n"
                    + "    }\n"
                    + "}\n"
                    + "\n"
                    + "<kw>enum</kw> <cls>Shape</cls> { <id>Circle</id>(<type>int</type>), <id>Empty</id> }\n"
                    + "\n"
                    + "<kw>fn</kw> <fn>area</fn>(<id>s</id>: <type>Shape</type>) -&gt; <type>int</type> {\n"
                    + "    <kw>match</kw> <id>s</id> {\n"
                    + "        <kw>case</kw> <id>Circle</id>(<id>r</id>): <id>r</id> <op>*</op> <id>r</id> <op>*</op> <num>3</num>,\n"
                    + "        <kw>default</kw>: <num>0</num>,\n"
                    + "    };\n"
                    + "}\n"
                    + "\n"
                    + "<kw>test</kw> \"area\" {\n"
                    + "    <kw>assert_eq</kw>(<fn>area</fn>(<id>Circle</id>(<num>2</num>)), <num>12</num>);\n"
                    + "}\n"
                    + "\n"
                    + "<com>/* Блочный комментарий\n   с вложенностью /* да */ */</com>\n";

    @Override
    public @Nullable Map<String, TextAttributesKey> getAdditionalHighlightingTagToDescriptorMap() {
        Map<String, TextAttributesKey> tags = new HashMap<>();
        tags.put("kw", LatentHighlightingKeys.KEYWORD);
        tags.put("soft", LatentHighlightingKeys.SOFT_KEYWORD);
        tags.put("type", LatentHighlightingKeys.TYPE);
        tags.put("str", LatentHighlightingKeys.STRING);
        tags.put("num", LatentHighlightingKeys.NUMBER);
        tags.put("bool", LatentHighlightingKeys.BOOLEAN);
        tags.put("com", LatentHighlightingKeys.COMMENT);
        tags.put("op", LatentHighlightingKeys.OPERATOR);
        tags.put("fn", LatentHighlightingKeys.FUNCTION_DECL);
        tags.put("cls", LatentHighlightingKeys.CLASS_DECL);
        tags.put("ann", LatentHighlightingKeys.ANNOTATION);
        tags.put("ai", LatentHighlightingKeys.AI_PRIMITIVE);
        tags.put("id", LatentHighlightingKeys.IDENTIFIER);
        return tags;
    }

    @Override
    public AttributesDescriptor @NotNull [] getAttributeDescriptors() {
        return DESCRIPTORS;
    }

    @Override
    public ColorDescriptor @NotNull [] getColorDescriptors() {
        return ColorDescriptor.EMPTY_ARRAY;
    }

    @Override
    public @NotNull String getDisplayName() {
        return "Latent";
    }

    @Override
    public @Nullable Icon getIcon() {
        return LatentIcons.FILE;
    }

    @Override
    public @NotNull SyntaxHighlighter getHighlighter() {
        return new LatentSyntaxHighlighter();
    }

    @Override
    public @NotNull String getDemoText() {
        return DEMO_TEXT;
    }
}
