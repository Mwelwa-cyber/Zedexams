# Feature migration template

> Snapshot as of 2026-08-05 — verify before acting.

How to move one feature into `src/features/<name>/` under
[`docs/architecture.md`](architecture.md) Phase 4. It is the recipe actually
followed for the reference migration (Phase 2, the Flashcard generator), written
down so later phases replay it instead of re-deriving it.

The rule underneath every step: **a migration is a move, not a rewrite.** If a
step tempts you to improve behaviour, stop — do the move, land it, and improve
it in its own PR where a reviewer can see the change on its own.

---

## 0. Map the surface before touching anything

List every file that *is* the feature, and every file that *uses* it. The second
list is the one that surprises you.

```bash
find src scripts functions -iname '*<feature>*' -type f | sort
grep -rn --include='*.js' --include='*.jsx' -iE "from '[^']*<feature>[^']*'" src/ scripts/
node -e "const s=require('./package.json').scripts; for(const[k,v] of Object.entries(s)) if(/<feature>/i.test(k+v)) console.log(k,'=',v)"
```

Four places the grep above will *not* find, and all four bit during Phase 2:

| Hiding place | Why grep misses it | How it fails if missed |
|---|---|---|
| `vi.mock('<old path>')` in a spec | The path is a string in a mock, not an import | **Silent.** Vitest does not warn when a mock matches no imported module — the spec keeps passing while exercising the real module |
| Machine-readable inventories (`scripts/aiGenerators/inventory.js`) | Path lives in a data record | A contract clause that does `existsSync` flips to false and a CI guard goes red |
| `lazy(() => import('<old path>'))` | ESLint does not inspect dynamic imports | **Runtime** chunk-load error on that route only |
| A test that covers your file *and others* | The file name never appears | Your move orphans one case of a shared test |
| A **path-classified CI list** — `scripts/visual/printAffectingPaths.js` | The path is a string in a list, not an import | A renderer that leaves the list stops triggering the visual gate, which then reports green **because it never ran** |

The last row did not bite in Phase 2 — the flashcard exporters were never on the
print-affecting list, because the visual fixtures render assessment papers, and
the gate correctly skipped. **Phase 4 will bite**: `assessmentToDocx.js`,
`assessmentPaperLayout.js`, `paperContentModel.js` and their neighbours are on
that list by exact path. `npm run test:visual-paths` fails when a listed non-glob
path stops existing, so the guard is real — but update the list in the same
commit as the move rather than discovering it from a red build, and read that
file's own note about `src/config/paperTaxonomy.js`: *"a pattern for a moved file
protects nothing and reads exactly like one that works."*

Record the answer to two questions before writing any code:

- **Which collections does it own?** They need rules coverage (step 6).
- **Who consumes it, and what do they consume?** That is the public API (step 3)
  — nothing more.

---

## 1. Move files with `git mv`

**Cut the branch only after an explicit `git fetch origin`.** `git checkout -B
<branch> origin/main` resolves `origin/main` from the last fetch, not from the
remote — so in a session that has merged a PR since, it silently branches from
a base that is already behind:

```bash
git fetch origin main && git checkout -B <branch> origin/main   # not checkout -B alone
```

This bit during Phase 3: a branch cut this way missed the PR that had merged
minutes earlier, and would have run CI against a base that no longer existed.
It was caught because **the harness flags a file whose on-disk content differs
from what this session last wrote** — the stale ratchet script showed up as
"modified" when nothing had modified it. That backstop is real but incidental;
it only fires for files the session happens to have touched before. The fetch
is the procedure. Rebasing onto `origin/main` before pushing is the second
chance, and step 7's ladder should be re-run after any rebase, not only before.

```bash
mkdir -p src/features/<name>/{components,pages,hooks,services,export}
git mv src/components/<area>/<Thing>.jsx src/features/<name>/components/<Thing>.jsx
```

`git mv` keeps the rename visible in `git log --follow` and keeps the diff
reviewable as a move. **Do not rename files in the same commit as the move** —
a rename plus a move reads as a rewrite in review. Phase 2 kept
`FlashcardGenerator.jsx` under `pages/` rather than renaming it to
`FlashcardGeneratorPage.jsx` for exactly this reason.

The layout, from architecture.md §3:

```
src/features/<name>/
├── index.js        ← public API, and nothing else
├── pages/          ← route-level screens (mounted lazily, NOT exported)
├── components/     ← presentation
├── hooks/          ← UI + data orchestration
├── services/       ← the ONLY place the feature touches Firebase (§14.2)
├── lib/            ← pure logic, `*Core.js`, with colocated node tests
└── export/         ← feature-specific document exporters, if any
```

---

## 2. Re-anchor the moved files' own imports

Depth changes, so relative paths change. A file at
`src/components/teacher/generate/X.jsx` and one at
`src/features/<name>/pages/X.jsx` are both three levels under `src/`, so
`../../../utils/…` survives untouched — which makes the imports that *do* break
easy to miss. Check every one:

```bash
grep -nE "from '\.\.?/" src/features/<name>/**/*.{js,jsx}
```

Shared infrastructure that has not migrated yet (`src/components/teacher/…`
studio chrome, `src/utils/…` helpers) stays where it is; the feature reaches
back into it by relative path. That is the honest interim state of a phased
migration, and the layering allows it — a feature may import anything below it.

---

## 3. Write `index.js` — the public API

Export **what is consumed today**, nothing speculative. Every name here lands in
the bundle of every consumer that imports anything from the feature.

**Do not export the page.** Route tables mount it with
`lazy(() => import('…/pages/<Page>'))` under the route-mount exception recorded
in Phase 1. Re-exporting a page from the front door puts the whole studio into
the chunk of anything that wanted one small component — and for flashcards, one
of those consumers is the public marketing landing page.

Phase 2's index is five names: two components, one hook, two exporters. The
progress repository and its status vocabulary stayed inside, because nothing
outside asked for them.

---

## 4. Point consumers at the front door

```js
// before — five imports reaching into internals
import FlashcardsView from '../views/FlashcardsView'
import { downloadFlashcardsDocx } from '../../../utils/flashcardsToDocx'
// after — one import through the public API
import { FlashcardsView, downloadFlashcardsDocx } from '../../../features/flashcards'
```

Route tables are the exception and keep importing the page directly, lazily.

**Then verify the bundle did not move.** A barrel can quietly drag a heavy
dependency into an unrelated chunk, and nothing in lint or tests would say so:

```bash
# before the migration
npm run build && ls -la dist/assets/*.js | awk '{print $5}' | sort -n > /tmp/sizes-before.txt
# after
npm run build && ls -la dist/assets/*.js | awk '{print $5}' | sort -n > /tmp/sizes-after.txt
diff /tmp/sizes-before.txt /tmp/sizes-after.txt
```

Phase 2's result: 565 chunks before and after, +95 bytes total, and the five
chunks that changed moved by 4–38 bytes — the length of the import path strings.
What made it safe was `docx` already living in its own vendor chunk; that is a
fact about this repo's `manualChunks`, not a general guarantee, so measure it
rather than assuming it.

### The barrel's real cost is import-time coupling, not bytes

Tree-shaking dealt with the bundle. What it does **not** deal with is the module
graph at import time: importing *any* name from a feature evaluates *every*
module the index re-exports.

Phase 2's index re-exports `useFlashcardProgress`, which imports `AuthContext`,
which imports `firebase/config`. So two specs that render components needing only
the presentational `FlashcardsView` began failing at collection:

```
Error: [firebase] Missing required Firebase web config: VITE_FIREBASE_API_KEY…
 ❯ src/firebase/config.js:49
 ❯ src/contexts/AuthContext.jsx:16
 ❯ src/features/flashcards/hooks/useFlashcardProgress.js:2
```

No runtime consequence here — every page already loads `AuthContext` through the
provider stack, and the bundle diff confirms nothing moved. The fix is to stub
the front door in those specs, which is also more honest than the old per-file
mocks: the component imports one module, so the spec mocks one module.

Expect this, and check for it: after re-pointing consumers, **run the full Vitest
suite, not only the specs of the files you edited.** The failures land in specs
you never touched.

If a feature's front door would drag something genuinely heavy or stateful into
innocent consumers, that is a signal about the feature's shape — say so and raise
it, rather than quietly splitting the front door in a migration PR.

---

## 5. Move the tests, and keep them discovered

Colocate tests with what they test (§3). Two suites, split by filename, and they
never merge:

- `*.spec.{js,jsx}` → Vitest. Moves with no registration. **Fix its `vi.mock`
  paths** — see the silent-failure warning in step 0.
- `*.test.js` → plain node. **Moving one is not enough: its `test:*` script in
  `package.json` must move with it in the same commit**, or `run-all-tests.mjs`
  stops discovering it and the suite silently shrinks.

Report the discovered count before and after so a drop cannot pass unnoticed:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { discoverTests } = await import('./scripts/run-all-tests.mjs');
console.log(discoverTests(JSON.parse(readFileSync('package.json','utf8')).scripts).length)"
```

**A test that covers your feature *and* others** does not move wholesale. Extract
the shared assertions into one module both files import, move your case, and
leave the rest — do not duplicate the helpers, or the two copies drift into
checking different things. Phase 2 hit this twice (`studioPdfExporters.test.js`,
seven exporters; `docxExporters.test.js`, fifteen), producing
`printableHtmlChecks.js` and `docxExportChecks.js`.

The second one was found by `npm run test:all`, not by grep, because the module
was loaded through a variable:

```js
const flashcardsMod = await loadModule('./flashcardsToDocx.js')  // grep for "flashcard" misses this
```

Which is the general lesson: **run the full node suite before believing the
surface map from step 0.** A tolerant loader turns a moved file into `null` and
the failure surfaces far from the cause — here as
`Cannot read properties of null (reading 'buildFlashcardsDocument')`.

Why not just let the shared test import the moved exporter directly? Because a
plain-node test cannot import a feature's `index.js` — the index re-exports JSX
components and node cannot parse them — so the import would have to reach past
the front door, which is precisely the debt the boundary test forbids. Colocating
the case is the way out, not a stylistic preference.

---

## 6. Rules and collections

Per §14.12, a migration that touches a collection updates `firestore.rules`, its
emulator test, and any changed indexes **in the same PR**. Phase 2 changed no
rule — but `flashcardProgress` had rules with no emulator coverage, and moving
the code that writes it is the moment to close that.

Write the cases that would fail if the rule were deleted, not the ones that
merely pass:

- The owner can read their own document; another learner cannot.
- **The id is not authority.** Ids like `{uid}_{deckId}` are derived client-side,
  so assert that a learner cannot write a document whose `uid` field names
  someone else, under any id.
- **A control case.** Every field-validation denial needs a sibling that
  *succeeds* with only the tested field changed. Without it, a denial proves
  nothing — the write would also fail with the field validator deleted, and the
  test would stay green.

```bash
npm run test:rules-emulator   # needs Java; downloads firebase-tools via npx
```

---

## 7. The full verification ladder

```bash
npm run lint
npm run build
npm run test:import-boundaries      # layering, resolution, debt lists
npm run test:all                    # report the before/after count
npm run test:unit
npm run test:rules-emulator         # if you touched rules or their coverage
```

`test:import-boundaries` is the one that speaks specifically to a migration. It
fails if you:

- reached past another feature's `index.js`, or grew either shrink-only debt list;
- left a `lazy(() => import(…))` pointing at a path that no longer resolves —
  a runtime error on one route that the build does not catch;
- cleared a recorded debt entry without deleting its line (it says so, and the
  fix is to delete the line — that is the list shrinking, which is the point).

---

## 8. What Phase 2 changed in the debt lists

Migrating a feature should *shrink* the Phase 1 lists, never grow them. Moving
`useFlashcardProgress` and its spec into the feature turned two legacy→feature
imports into intra-feature ones: **11 → 9**. The three cross-feature entries
(`lessons` → `notes`) are untouched and clear when `notes` migrates.

If a migration would *add* an entry, that is the signal that something belongs on
the other side of the boundary — fix the design, not the list.
