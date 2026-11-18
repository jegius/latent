package dev.latent.idea.structure;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/** Тесты извлечения структуры файла (без IntelliJ Platform). */
public class LatentStructureParserTest {

    private static final String SOURCE = "// header\n"
            + "fn helper(x: int) -> int {\n"
            + "    return x * 2;\n"
            + "}\n"
            + "\n"
            + "class Point {\n"
            + "    x: int;\n"
            + "    y: int;\n"
            + "\n"
            + "    fn init(x: int, y: int) {\n"
            + "        this.x = x;\n"
            + "        this.y = y;\n"
            + "    }\n"
            + "\n"
            + "    fn sum() -> int {\n"
            + "        return this.x + this.y;\n"
            + "    }\n"
            + "}\n"
            + "\n"
            + "enum Shape { Circle(int), Empty }\n"
            + "\n"
            + "@test(\"main\")\n"
            + "fn main() -> int {\n"
            + "    let p = new Point(1, 2);\n"
            + "    return p.sum();\n"
            + "}\n";

    @Test
    public void topLevelDeclarations() {
        List<LatentStructureSymbol> symbols = LatentStructureParser.parse(SOURCE);
        assertEquals(4, symbols.size());
        assertEquals("helper", symbols.get(0).getName());
        assertEquals(LatentStructureSymbol.Kind.FUNCTION, symbols.get(0).getKind());
        assertEquals("Point", symbols.get(1).getName());
        assertEquals(LatentStructureSymbol.Kind.CLASS, symbols.get(1).getKind());
        assertEquals("Shape", symbols.get(2).getName());
        assertEquals(LatentStructureSymbol.Kind.ENUM, symbols.get(2).getKind());
        assertEquals("main", symbols.get(3).getName());
        assertEquals(LatentStructureSymbol.Kind.FUNCTION, symbols.get(3).getKind());
    }

    @Test
    public void classMethodsAreChildren() {
        LatentStructureSymbol point = LatentStructureParser.parse(SOURCE).get(1);
        assertEquals(2, point.getChildren().size());
        assertEquals("init", point.getChildren().get(0).getName());
        assertEquals("sum", point.getChildren().get(1).getName());
        assertEquals(0,
                point.getChildren().get(0).getKind().compareTo(LatentStructureSymbol.Kind.FUNCTION));
    }

    @Test
    public void enumVariantsAreChildren() {
        LatentStructureSymbol shape = LatentStructureParser.parse(SOURCE).get(2);
        assertEquals(2, shape.getChildren().size());
        assertEquals("Circle", shape.getChildren().get(0).getName());
        assertEquals("Empty", shape.getChildren().get(1).getName());
        assertEquals(LatentStructureSymbol.Kind.VARIANT, shape.getChildren().get(1).getKind());
    }

    @Test
    public void mainIsFound() {
        LatentStructureSymbol main = LatentStructureParser.findMain(SOURCE);
        assertNotNull(main);
        assertEquals("main", main.getName());
        assertTrue(LatentStructureParser.hasMain(SOURCE));
        assertNull(LatentStructureParser.findMain("fn other() -> int { return 0; }"));
    }

    @Test
    public void offsetsPointInsideDeclarations() {
        for (LatentStructureSymbol symbol : LatentStructureParser.parse(SOURCE)) {
            assertTrue(symbol.getOffset() >= 0);
            assertTrue(symbol.getEndOffset() > symbol.getOffset());
            assertTrue(symbol.getEndOffset() <= SOURCE.length());
        }
    }
}
