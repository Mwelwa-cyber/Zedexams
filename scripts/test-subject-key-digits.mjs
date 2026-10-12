// Canonical subject keys include digits (religious_education_2044 / _2046).
// A sanitiser that maps [^a-z_] to "_" turns those into "religious_education_____"
// and the subject is then rejected or silently misses its KB. Fail if any
// subject-key sanitiser in functions/ strips digits again.
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

const roots = ["functions"];
const skip = new Set(["node_modules"]);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js") && !p.endsWith(".test.js")) files.push(p);
  }
})(roots[0]);

const bad = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/\[\^a-z_?\]|\[a-z_\]\+\$/.test(line)) return;
    if (/^\s*(\*|\/\/)/.test(line)) return; // prose may quote the old pattern
    if (/taskType|component/.test(line)) return; // other vocabularies, no digits
    // The sanitiser's own line plus up to two lines above it, for chains such
    // as `const subject = String(x)\n  .toLowerCase()\n  .replace(...)`.
    const ctx = [lines[i - 2], lines[i - 1], line].join(" ");
    if (/subject\w*\s*[=:]/i.test(ctx)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}
if (bad.length) {
  console.error("Subject-key sanitisers must allow digits ([^a-z0-9_]):\n" + bad.join("\n"));
  process.exit(1);
}
console.log(`ok: ${files.length} files scanned, no digit-stripping subject sanitiser`);
