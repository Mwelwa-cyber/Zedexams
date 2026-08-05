// Guards src/curriculum/catalog/index.js — the Curriculum Engine's re-export of
// the taxonomy root (docs/architecture.md §5, §14.4). Not to be confused with
// test-curriculum-catalog.mjs, which tests src/config/curriculumCatalog.js, a
// different module: this one only asks whether the engine's entry point is a
// faithful view of the roots.
//
// The catalog re-exports `src/config/canonicalEducation.js` (the one
// declaration of which curricula, grades and subjects exist) and its derived
// registry `src/config/educationLevels.js`. Three properties make an
// `export *` safe there, and each fails silently if it stops holding:
//
//  1. Everything the roots export is reachable through the catalog. Otherwise a
//     caller that cannot find a name through the engine goes back to importing
//     src/config directly, and the entry point stops meaning anything.
//  2. The catalog exports nothing of its own. The moment it declares a grade,
//     subject or curriculum it IS the second registry §14.4 forbids — and one
//     that looks like a re-export.
//  3. The two roots share no export name. In ESM an ambiguous name across two
//     `export *`s is not a load error: the name is simply absent, so the
//     symptom is `undefined` at a call site far away from the cause.
//
// Plain-node test, auto-discovered by scripts/run-all-tests.mjs via the
// test:curriculum-engine-catalog script.

const canonical = await import('../src/config/canonicalEducation.js');
const levels = await import('../src/config/educationLevels.js');
const catalog = await import('../src/curriculum/catalog/index.js');

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

const names = (mod) => Object.keys(mod).filter((key) => key !== 'default');

const canonicalNames = names(canonical);
const levelNames = names(levels);
const catalogNames = names(catalog);

if (!canonicalNames.length) fail('canonicalEducation.js exported nothing — the taxonomy root did not load');
if (!levelNames.length) fail('educationLevels.js exported nothing — the level registry did not load');

// 3, checked first: a collision is what makes 1 fail in a confusing way.
const collisions = canonicalNames.filter((name) => levelNames.includes(name));
if (collisions.length) {
  fail(
    `canonicalEducation.js and educationLevels.js both export ${collisions.join(', ')}. ` +
    'Two `export *`s with the same name resolve to nothing in ESM — rename one, or ' +
    're-export it explicitly from the catalog.'
  );
}

// 1
for (const name of [...canonicalNames, ...levelNames]) {
  if (!catalogNames.includes(name)) {
    fail(`src/curriculum/catalog does not re-export "${name}" — the catalog is not the whole taxonomy`);
  }
}

// 2
for (const name of catalogNames) {
  if (!canonicalNames.includes(name) && !levelNames.includes(name)) {
    fail(
      `src/curriculum/catalog exports "${name}", which neither root declares. ` +
      'The catalog re-exports; resolution logic goes in src/curriculum/resolvers/ (docs/architecture.md §14.4).'
    );
  }
}

// Identity, not just presence: a re-export must be the same binding, or the
// catalog is a copy of the registry rather than a view of it.
for (const name of canonicalNames) {
  if (catalog[name] !== canonical[name]) fail(`catalog.${name} is not the same binding as canonicalEducation.${name}`);
}
for (const name of levelNames) {
  if (catalog[name] !== levels[name]) fail(`catalog.${name} is not the same binding as educationLevels.${name}`);
}

if (failures) {
  console.error(`\n${failures} curriculum-catalog failure(s).`);
  process.exit(1);
}

console.log(
  `ok: the curriculum catalog re-exports all ${canonicalNames.length + levelNames.length} taxonomy names ` +
  '(no collisions, nothing of its own)'
);
