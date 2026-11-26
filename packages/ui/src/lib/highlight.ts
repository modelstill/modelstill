export type TokenKind = "string" | "keyword" | "flag" | "variable" | "plain";
export type Token = { text: string; kind: TokenKind };

const KEYWORDS = new Set(["import", "from", "const", "await", "async", "export", "return", "new", "curl", "uv", "run", "def", "print", "with", "as"]);
const PATTERN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\$[A-Za-z_][A-Za-z0-9_]*|(?<![\w-])--?[A-Za-z][\w-]*|[A-Za-z_][A-Za-z0-9_]*)/g;

function kindOf(text: string): TokenKind {
  if (text.startsWith('"') || text.startsWith("'")) return "string";
  if (text.startsWith("$")) return "variable";
  if (text.startsWith("-")) return "flag";
  if (KEYWORDS.has(text)) return "keyword";
  return "plain";
}

export function highlight(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: code.slice(last, index), kind: "plain" });
    tokens.push({ text: match[0], kind: kindOf(match[0]) });
    last = index + match[0].length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last), kind: "plain" });
  return tokens.reduce<Token[]>((merged, token) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === "plain" && token.kind === "plain") previous.text += token.text;
    else merged.push({ ...token });
    return merged;
  }, []);
}
