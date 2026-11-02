package dev.latent.idea.structure;

import dev.latent.idea.lexer.LatentScanner;
import dev.latent.idea.lexer.LatentTokenKind;

import java.util.ArrayList;
import java.util.List;

/**
 * Извлекает объявления верхнего уровня (функции, классы, enum), методы классов и варианты enum.
 *
 * <p>Работает прямо по токенам и не требует PSI, поэтому пригоден и для Structure View,
 * и для автодополнения, и для поиска {@code main} при запуске.</p>
 */
public final class LatentStructureParser {

    private LatentStructureParser() {
    }

    public static List<LatentStructureSymbol> parse(CharSequence text) {
        List<LatentScanner.Token> tokens = significantTokens(text);
        List<LatentStructureSymbol> result = new ArrayList<>();
        int i = 0;
        while (i < tokens.size()) {
            LatentTokenKind kind = tokens.get(i).getKind();
            int next = i;
            if (kind == LatentTokenKind.FN) {
                next = parseFunction(text, tokens, i, null, result);
            } else if (kind == LatentTokenKind.CLASS) {
                next = parseClass(text, tokens, i, result);
            } else if (kind == LatentTokenKind.ENUM) {
                next = parseEnum(text, tokens, i, result);
            }
            i = next > i ? next : i + 1;
        }
        return result;
    }

    /** Возвращает объявление {@code main} верхнего уровня, если оно есть. */
    public static LatentStructureSymbol findMain(CharSequence text) {
        for (LatentStructureSymbol symbol : parse(text)) {
            if (symbol.getKind() == LatentStructureSymbol.Kind.FUNCTION
                    && "main".equals(symbol.getName())) {
                return symbol;
            }
        }
        return null;
    }

    public static boolean hasMain(CharSequence text) {
        return findMain(text) != null;
    }

    private static int parseFunction(CharSequence text, List<LatentScanner.Token> tokens,
                                     int start, LatentStructureSymbol parent,
                                     List<LatentStructureSymbol> result) {
        if (start + 1 >= tokens.size()) {
            return start;
        }
        LatentScanner.Token fnToken = tokens.get(start);
        LatentScanner.Token nameToken = tokens.get(start + 1);
        if (nameToken.getKind() == LatentTokenKind.LPAREN) {
            return start; // лямбда без имени — не объявление
        }
        int braceIndex = findBodyStart(tokens, start + 2);
        if (braceIndex < 0) {
            return start;
        }
        int endIndex = matchBrace(tokens, braceIndex);
        int endOffset = endIndex >= 0
                ? tokens.get(endIndex).getEnd()
                : tokens.get(tokens.size() - 1).getEnd();
        LatentStructureSymbol symbol = new LatentStructureSymbol(
                LatentStructureSymbol.Kind.FUNCTION, textOf(text, nameToken),
                fnToken.getStart(), endOffset);
        if (parent != null) {
            parent.addChild(symbol);
        } else {
            result.add(symbol);
        }
        return endIndex >= 0 ? endIndex + 1 : tokens.size();
    }

    private static int parseClass(CharSequence text, List<LatentScanner.Token> tokens,
                                  int start, List<LatentStructureSymbol> result) {
        if (start + 1 >= tokens.size()) {
            return start;
        }
        int braceIndex = findBodyStart(tokens, start + 1);
        if (braceIndex < 0) {
            return start;
        }
        int endIndex = matchBrace(tokens, braceIndex);
        int endOffset = endIndex >= 0
                ? tokens.get(endIndex).getEnd()
                : tokens.get(tokens.size() - 1).getEnd();
        String name = tokens.get(start + 1).getKind() == LatentTokenKind.LBRACE
                ? "<class>" : textOf(text, tokens.get(start + 1));
        LatentStructureSymbol symbol = new LatentStructureSymbol(
                LatentStructureSymbol.Kind.CLASS, name, tokens.get(start).getStart(), endOffset);
        if (endIndex >= 0) {
            int i = braceIndex + 1;
            while (i < endIndex) {
                if (tokens.get(i).getKind() == LatentTokenKind.FN) {
                    int next = parseFunction(text, tokens, i, symbol, result);
                    if (next > i) {
                        i = next;
                        continue;
                    }
                }
                i++;
            }
        }
        result.add(symbol);
        return endIndex >= 0 ? endIndex + 1 : tokens.size();
    }

    private static int parseEnum(CharSequence text, List<LatentScanner.Token> tokens,
                                 int start, List<LatentStructureSymbol> result) {
        if (start + 1 >= tokens.size()) {
            return start;
        }
        int braceIndex = findBodyStart(tokens, start + 1);
        if (braceIndex < 0) {
            return start;
        }
        int endIndex = matchBrace(tokens, braceIndex);
        int endOffset = endIndex >= 0
                ? tokens.get(endIndex).getEnd()
                : tokens.get(tokens.size() - 1).getEnd();
        LatentStructureSymbol symbol = new LatentStructureSymbol(
                LatentStructureSymbol.Kind.ENUM, textOf(text, tokens.get(start + 1)),
                tokens.get(start).getStart(), endOffset);
        if (endIndex >= 0) {
            boolean expectVariant = true;
            int i = braceIndex + 1;
            while (i < endIndex) {
                LatentScanner.Token token = tokens.get(i);
                LatentTokenKind kind = token.getKind();
                if (kind == LatentTokenKind.COMMA) {
                    expectVariant = true;
                    i++;
                    continue;
                }
                if (kind == LatentTokenKind.LPAREN) {
                    int close = matchDelimiter(tokens, i,
                            LatentTokenKind.LPAREN, LatentTokenKind.RPAREN);
                    i = close >= 0 ? close + 1 : i + 1;
                    expectVariant = false;
                    continue;
                }
                if (expectVariant && (kind == LatentTokenKind.IDENTIFIER
                        || kind == LatentTokenKind.TYPE_NAME || kind.isKeyword())) {
                    symbol.addChild(new LatentStructureSymbol(
                            LatentStructureSymbol.Kind.VARIANT, textOf(text, token),
                            token.getStart(), token.getEnd()));
                    expectVariant = false;
                }
                i++;
            }
        }
        result.add(symbol);
        return endIndex >= 0 ? endIndex + 1 : tokens.size();
    }

    private static int findBodyStart(List<LatentScanner.Token> tokens, int from) {
        for (int i = from; i < tokens.size(); i++) {
            LatentTokenKind kind = tokens.get(i).getKind();
            if (kind == LatentTokenKind.LBRACE) {
                return i;
            }
            if (kind == LatentTokenKind.SEMICOLON || kind == LatentTokenKind.RBRACE) {
                return -1;
            }
        }
        return -1;
    }

    private static int matchBrace(List<LatentScanner.Token> tokens, int openIndex) {
        return matchDelimiter(tokens, openIndex, LatentTokenKind.LBRACE, LatentTokenKind.RBRACE);
    }

    private static int matchDelimiter(List<LatentScanner.Token> tokens, int openIndex,
                                      LatentTokenKind open, LatentTokenKind close) {
        int depth = 0;
        for (int i = openIndex; i < tokens.size(); i++) {
            LatentTokenKind kind = tokens.get(i).getKind();
            if (kind == open) {
                depth++;
            } else if (kind == close) {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static List<LatentScanner.Token> significantTokens(CharSequence text) {
        List<LatentScanner.Token> tokens = new ArrayList<>();
        for (LatentScanner.Token token : LatentScanner.tokenize(text)) {
            LatentTokenKind kind = token.getKind();
            if (!kind.isWhitespace() && !kind.isComment()) {
                tokens.add(token);
            }
        }
        return tokens;
    }

    private static String textOf(CharSequence text, LatentScanner.Token token) {
        return text.subSequence(token.getStart(), token.getEnd()).toString();
    }
}
