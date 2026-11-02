package dev.latent.idea.structure;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Описание объявления Latent для Structure View и автодополнения. */
public final class LatentStructureSymbol {

    public enum Kind {
        FUNCTION("функция"),
        CLASS("класс"),
        ENUM("enum"),
        VARIANT("вариант");

        private final String russianName;

        Kind(String russianName) {
            this.russianName = russianName;
        }

        public String getRussianName() {
            return russianName;
        }
    }

    private final Kind kind;
    private final String name;
    private final int offset;
    private final int endOffset;
    private final List<LatentStructureSymbol> children = new ArrayList<>();

    public LatentStructureSymbol(Kind kind, String name, int offset, int endOffset) {
        this.kind = kind;
        this.name = name;
        this.offset = offset;
        this.endOffset = endOffset;
    }

    public Kind getKind() {
        return kind;
    }

    public String getName() {
        return name;
    }

    public int getOffset() {
        return offset;
    }

    public int getEndOffset() {
        return endOffset;
    }

    public void addChild(LatentStructureSymbol child) {
        children.add(child);
    }

    public List<LatentStructureSymbol> getChildren() {
        return Collections.unmodifiableList(children);
    }

    @Override
    public String toString() {
        return kind + " " + name + " @ " + offset;
    }
}
