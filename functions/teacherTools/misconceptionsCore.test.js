/**
 * misconceptionsCore tests — what learners actually get wrong (§3.3).
 *
 * The store's whole value is that it is DESCRIPTIVE: it records misconceptions the
 * model articulated while writing real questions, and feeds them back. So the
 * things worth testing are (a) that a repeat sighting is counted rather than
 * duplicated, (b) that nothing is fabricated when a topic is new, and (c) that the
 * prompt offers the material rather than mandating it — a paper forced to use a
 * misconception that does not fit would be worse than one that ignores the store.
 *
 * Run: node functions/teacherTools/misconceptionsCore.test.js
 */

const assert = require("node:assert");
const {
  misconceptionDocId, misconceptionKey, parseRationale, harvestMisconceptions,
  mergeMisconceptions, buildMisconceptionDirective, MAX_PER_TOPIC,
} = require("./misconceptionsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

/* ── the document id ────────────────────────────────────────────────────── */

console.log("\n— where a topic's misconceptions live —");
ok("the id is legible, so the collection can be read by a human",
    misconceptionDocId({
      framework: "2023", grade: "G4", subject: "integrated_science",
      topic: "Photosynthesis and Plants",
    }) === "cbc_G4_integrated_science_photosynthesis-and-plants");
ok("the previous curriculum gets its own namespace",
    misconceptionDocId({framework: "2013", grade: "G4", subject: "x", topic: "y"})
        .startsWith("obc_"));
ok("the same topic always lands on the same document, whatever the casing",
    misconceptionDocId({framework: "2023", grade: "g4", subject: "MATHS", topic: "Fractions"}) ===
    misconceptionDocId({framework: "2023", grade: "G4", subject: "maths", topic: "fractions"}));
ok("punctuation in a topic name cannot break the id",
    /^cbc_G4_maths_[a-z0-9-]*$/.test(misconceptionDocId({
      framework: "2023", grade: "G4", subject: "maths", topic: "Money: notes & coins!",
    })));

/* ── the same misconception, said differently ───────────────────────────── */

console.log("\n— recognising the same mistake twice —");
ok("filler words and phrasing do not make two mistakes look different",
    misconceptionKey("Learners confuse the root with the leaf") ===
    misconceptionKey("Pupils often think that the root is the leaf"));
ok("…while genuinely different mistakes stay different",
    misconceptionKey("learners confuse root with leaf") !==
    misconceptionKey("learners forget to carry the ten"));
ok("an empty rationale has no key, so it is never stored",
    misconceptionKey("   ") === "" && misconceptionKey(null) === "");

/* ── parsing one rationale line ─────────────────────────────────────────── */

console.log("\n— reading one rationale —");
{
  const p = parseRationale("Root: learners confuse water uptake with food making");
  ok("the wrong option is separated from the error", p.wrongAnswer === "Root");
  ok("…and the error keeps its own wording",
      p.text === "learners confuse water uptake with food making");
}
{
  const p = parseRationale("learners forget to carry the ten");
  ok("a line with no option label is still kept — the error is the point",
      p.wrongAnswer === "" && p.text === "learners forget to carry the ten");
}
ok("a blank line yields nothing", parseRationale("  ") === null);
ok("a colon with only a fragment after it is punctuation, not an option label",
    parseRationale("The answer is: 5").wrongAnswer === "" &&
    parseRationale("The answer is: 5").text === "The answer is: 5");

/* ── harvesting from a real paper ───────────────────────────────────────── */

console.log("\n— harvesting a paper —");
const PAPER = {
  sections: [{
    questions: [
      {
        number: 1, type: "multiple_choice", topic: "Photosynthesis",
        options: ["Leaf", "Root", "Stem", "Flower"],
        distractorRationale: [
          "", "Root: learners confuse water uptake with food making",
          "Stem: learners think the stem stores the food",
          "Flower: learners associate flowers with growth",
        ],
      },
      {
        number: 2, type: "multiple_choice", topic: "Fractions",
        distractorRationale: ["learners add the denominators too"],
      },
      // No topic — its rationale has nowhere honest to go.
      {number: 3, type: "multiple_choice", distractorRationale: ["something"]},
      // No rationale at all.
      {number: 4, type: "short_answer", topic: "Photosynthesis"},
    ],
  }],
};
{
  const harvested = harvestMisconceptions(PAPER);
  ok("misconceptions are grouped by topic",
      Object.keys(harvested).sort().join(",") === "Fractions,Photosynthesis");
  ok("every wrong option's rationale is captured",
      harvested.Photosynthesis.length === 3);
  ok("a question with no topic contributes nothing rather than being guessed at",
      !Object.keys(harvested).includes(""));
  ok("a blank rationale slot (the correct option) is skipped",
      harvested.Photosynthesis.every((m) => m.text));
}
ok("a paper with nothing to harvest yields an empty object",
    Object.keys(harvestMisconceptions({sections: []})).length === 0 &&
    Object.keys(harvestMisconceptions(null)).length === 0);
{
  // A model that writes "correct" in the right option's slot must not have that
  // filed as a learner misconception.
  const harvested = harvestMisconceptions({
    sections: [{questions: [{
      topic: "Fractions", type: "multiple_choice",
      distractorRationale: ["Correct — this is the answer", "learners invert the fraction"],
    }]}],
  });
  ok("a note about the CORRECT option is not stored as a misconception",
      harvested.Fractions.length === 1 &&
      /invert/.test(harvested.Fractions[0].text));
}

/* ── merging into the store ─────────────────────────────────────────────── */

console.log("\n— merging into what is already known —");
{
  const first = mergeMisconceptions([], [
    {text: "learners confuse root with leaf", wrongAnswer: "Root"},
    {text: "learners think the stem stores food", wrongAnswer: "Stem"},
  ], "2026-07-01T00:00:00Z");
  ok("a fresh topic stores everything it saw", first.items.length === 2);
  ok("…each seen once", first.items.every((m) => m.seen === 1));
  ok("…and the count of new rows is reported", first.added === 2);

  const second = mergeMisconceptions(first.items, [
    {text: "Pupils often think that the root is the leaf", wrongAnswer: "Root"},
  ], "2026-07-02T00:00:00Z");
  ok("the same mistake said differently is COUNTED, not duplicated",
      second.items.length === 2 && second.added === 0 && second.updated === 1);
  const root = second.items.find((m) => /root/i.test(m.text));
  ok("…and its count went up", root.seen === 2);
  ok("…and the most-seen rises to the top", second.items[0].seen === 2);
  ok("…and the first-seen date is not rewritten",
      root.firstSeenAt === "2026-07-01T00:00:00Z");
  ok("…while the last-seen date is", root.lastSeenAt === "2026-07-02T00:00:00Z");
}
{
  // A stored document written before dedup existed could hold near-duplicates.
  const folded = mergeMisconceptions([
    {text: "learners confuse root with leaf", seen: 2},
    {text: "Pupils think that the root is the leaf", seen: 3},
  ], [], "2026-07-03T00:00:00Z");
  ok("near-duplicates already in the store are folded together",
      folded.items.length === 1 && folded.items[0].seen === 5);
}
{
  const many = Array.from({length: MAX_PER_TOPIC + 20}, (_, i) => ({
    text: `mistake number ${i}`, wrongAnswer: `Option ${i}`,
  }));
  const capped = mergeMisconceptions([], many, "2026-07-01T00:00:00Z");
  ok("a topic's store is capped so the document cannot grow without limit",
      capped.items.length === MAX_PER_TOPIC);
}
{
  const kept = mergeMisconceptions(
      [{text: "the important one", seen: 50}],
      Array.from({length: MAX_PER_TOPIC + 5}, (_, i) => ({text: `filler ${i}`})),
      "2026-07-01T00:00:00Z",
  );
  ok("…and the most-seen misconception survives the cap",
      kept.items[0].text === "the important one");
}
ok("nothing new and nothing re-seen reports no change, so the store is not rewritten",
    (() => {
      const r = mergeMisconceptions([{text: "a mistake", seen: 1}], [], "");
      return r.added === 0 && r.updated === 0;
    })());
{
  const filled = mergeMisconceptions(
      [{text: "learners invert the fraction", seen: 1}],
      [{text: "Pupils invert the fraction", wrongAnswer: "2/3"}], "");
  ok("a later sighting fills in a wrong answer the first one did not name",
      filled.items[0].wrongAnswer === "2/3");
}
ok("rubbish in the stored list is dropped rather than crashing the merge",
    mergeMisconceptions([null, "nope", {}, {text: ""}], [], "").items.length === 0);

/* ── the prompt ─────────────────────────────────────────────────────────── */

console.log("\n— what the model is told —");
ok("a topic nothing is known about adds NOTHING to the prompt",
    buildMisconceptionDirective({}) === "" &&
    buildMisconceptionDirective({Fractions: []}) === "" &&
    buildMisconceptionDirective(null) === "");
{
  const directive = buildMisconceptionDirective({
    Photosynthesis: [
      {text: "learners confuse water uptake with food making", wrongAnswer: "Root", seen: 3},
      {text: "learners think the stem stores the food", wrongAnswer: "", seen: 1},
    ],
  });
  ok("the topic is named", /Photosynthesis:/.test(directive));
  ok("the wrong answer and the reason are both stated",
      /picks "Root" because learners confuse water uptake/.test(directive));
  ok("a recurring mistake shows how often it recurs", /seen 3×/.test(directive));
  ok("…and a one-off does not pretend to a count",
      !/stem stores the food \(seen/.test(directive));
  ok("the material is OFFERED, never mandated",
      /Where a multiple-choice question suits one/.test(directive) &&
      /Do not force one in where it does not fit/.test(directive));
  ok("…and the model is told not to copy the wording",
      /not reuse the wording below verbatim/.test(directive));
  ok("the source is stated honestly — recorded, not invented",
      /recorded from earlier papers/.test(directive));
}
{
  const long = buildMisconceptionDirective({
    Fractions: Array.from({length: 40}, (_, i) => ({text: `mistake ${i}`, seen: 1})),
  });
  ok("the prompt is capped so the store cannot crowd out the brief",
      long.split("\n").filter((l) => /^ {2}- /.test(l)).length <= 12);
}

console.log(`\n${passed} passed`);
