let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const input = (data && data.tool_input) || {};
const path = input.file_path || "";

if (path.includes("/.claude/")) process.exit(0);
if (path.includes("/vendor/")) process.exit(0);
if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)) process.exit(0);

const chunks = [];
if (typeof input.content === "string") chunks.push(input.content);
if (typeof input.new_string === "string") chunks.push(input.new_string);
if (Array.isArray(input.edits))
  for (const edit of input.edits)
    if (edit && typeof edit.new_string === "string") chunks.push(edit.new_string);

const stripStrings = (line) =>
  line
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/`(\\.|[^`\\])*`/g, "``");

const offenders = [];
for (const chunk of chunks)
  for (const line of chunk.split("\n")) {
    const stripped = stripStrings(line);
    const lineComment = stripped.replaceAll("://", "").includes("//");
    const blockComment = stripped.includes("/*") || stripped.includes("*/");
    if (lineComment || blockComment) offenders.push(line.trim());
  }

if (offenders.length) {
  const list = offenders.slice(0, 10).map((line) => "  " + line).join("\n");
  process.stderr.write(
    "Blocked by AGENTS.md: TS/JS must not contain comments - no // line comments and no /* */ block comments (:// inside string literals like URLs is fine).\n" +
      "Offending line(s):\n" + list + "\n" +
      "Write self-documenting code; fix the underlying lint/type issue instead of suppressing it.\n",
  );
  process.exit(2);
}

process.exit(0);
