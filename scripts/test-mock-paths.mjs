#!/usr/bin/env node
/**
 * Does every `vi.mock('./relative/path')` in src/ name a module that exists?
 *
 * ## Why this is a test and not a convention
 *
 * A `vi.mock` whose path matches no imported module is a **silent no-op**.
 * Vitest does not warn. The spec keeps passing — while exercising the REAL
 * module instead of the stub it thinks it installed. So the failure looks
 * exactly like success, and it survives review because the diff shows a mock
 * that reads correctly.
 *
 * `docs/MIGRATION_TEMPLATE.md` §0 lists this as the first of the four hiding
 * places a feature migration must sweep, and Phase 4 then walked into it four
 * times running. Each of `rubric` (#2172), `homework` (#2173), `worksheet`
 * (#2178) and `teacherNotes` moved a view into a feature and re-anchored the
 * paths in the MOVED spec — which is what the template says to do — while
 * leaving the mocks in the two CONSUMERS' specs pointing at the old location:
 *
 *     src/components/teacher/library/LibraryItemDetail.spec.jsx
 *     src/components/teacher/library/PublicShareView.spec.jsx
 *
 * Eight dead mocks, four merged pull requests, every suite green. The template
 * says to sweep for this; sweeping by hand found the moved file's own mocks and
 * missed its consumers' every single time. That is the argument for a check
 * rather than a more careful habit.
 *
 * ## What it does NOT flag
 *
 * `{ virtual: true }` — Vitest's documented way to mock a module that
 * deliberately does not exist. `AssessmentBlocks.spec.jsx` uses it next to the
 * real path, and flagging it would be the check being wrong rather than the
 * code. Non-relative specifiers are skipped too: those are packages, and
 * whether a package resolves is npm's question, not this one.
 *
 * Plain-node, auto-discovered by scripts/run-all-tests.mjs. No build, no jsdom.
 *
 * Run: node scripts/test-mock-paths.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Vite's resolution order for the extensionless imports this repo writes. */
const SUFFIXES = ['', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.css', '/index.js', '/index.jsx'];
const resolvesToFile = (abs) =>
  SUFFIXES.some((suffix) => existsSync(abs + suffix) && statSync(abs + suffix).isFile());

function* specFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* specFiles(full);
    else if (/\.(spec|test)\.(js|jsx)$/.test(entry.name)) yield full;
  }
}

/**
 * `vi.mock('<path>' …)` — and `vi.doMock`, which the Phase 4 review sweep
 * added: it is the same call with the same silent-no-op failure, written
 * inside a test body instead of hoisted, and `QuickCreate.spec.jsx` uses it.
 * Checking one spelling and not the other leaves the hole in the place a
 * reader is least likely to look for it.
 *
 * Matched with everything up to the end of the line, so the
 * `{ virtual: true }` options object is visible.
 *
 * Matching the whole call is not possible with a regex (the factory contains
 * arbitrary JS, including parens), so this captures the specifier plus the
 * remainder of its LINE — which is where an options object is written in
 * practice, and where every instance in this repo puts it. A `virtual: true`
 * placed on a later line would be a false positive; the message says what to
 * do, and no such instance exists today.
 */
const MOCK_CALL = /vi\.(?:mock|doMock)\(\s*['"](\.[^'"]+)['"](.*)$/gm;

let failures = 0;
let checked = 0;
let virtualSkipped = 0;

for (const file of specFiles(SRC)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(MOCK_CALL)) {
    const [, specifier, restOfLine] = match;
    if (/virtual\s*:\s*true/.test(restOfLine)) { virtualSkipped += 1; continue; }
    checked += 1;
    const target = resolve(dirname(file), specifier.replace(/[?#].*$/, ''));
    if (!resolvesToFile(target)) {
      failures += 1;
      const line = source.slice(0, match.index).split('\n').length;
      console.error(
        `FAIL: ${relative(ROOT, file)}:${line}\n` +
        `        vi.mock('${specifier}') resolves to nothing.\n` +
        '        Vitest does not warn about this: the mock is a NO-OP and the spec exercises the real\n' +
        '        module instead. If a file moved, point this at its new path — and if it moved into a\n' +
        "        feature, that is the feature's index.js, with the DEFAULT export renamed to the named\n" +
        '        one the consumer now imports. If the module is meant not to exist, say so with\n' +
        '        { virtual: true }.',
      );
    }
  }
}

if (failures) {
  console.error(`\n${failures} dead vi.mock path(s).`);
  process.exit(1);
}

console.log(
  `ok: ${checked} relative vi.mock path(s) across src/ all resolve` +
  (virtualSkipped ? `; ${virtualSkipped} declared { virtual: true } and were skipped` : ''),
);
