/**
 * The notation contract, stated once in prompt prose.
 *
 * Phase 2 wrote the MATHS NOTATION rules into the assessment prompt; the
 * worksheet, homework and quiz generators were left off the contract, and the
 * worksheet prompt actively demonstrated the banned form ("7/10 =") in its
 * drill instruction. An example outranks a rule every time, so every generator
 * that can emit mathematics now shares THIS block — one copy, required by all
 * of them, so a wording fix reaches every tool at once.
 *
 * Pure CommonJS with no imports: the assessment prompt could not share code
 * with the ESM contract (hence its mirror test), but the four consumers of
 * this block are all CommonJS, so here sharing is possible and a mirror is
 * only needed once — scripts/test-toolchain-notation-mirror.mjs asserts this
 * block states every form the contract declares, and that each prompt embeds
 * it.
 *
 * The markup is the SAME language assessmentPromptV10 asks for and
 * src/shared/utils/importRichText.js converts, so one converter serves
 * every tool.
 */

const MATHS_NOTATION_BLOCK = [
  "MATHS NOTATION — how to write mathematics in ANY field (question text, options, answers, working notes, passages):",
  "- Fractions: write \\frac{a}{b} — e.g. \\frac{3}{4}. Mixed numbers: c\\frac{a}{b} — e.g. 1\\frac{1}{3}. NEVER write a fraction as a/b, as a diagonal glyph, or as a single character like ½ — the studio renders \\frac{a}{b} as a proper stacked fraction with a horizontal bar, the way learners write it.",
  "- Other inline maths (roots, powers, symbols, indices, number bases): wrap in dollar signs $...$ — e.g. $\\sqrt{49}$, $x^2$, $5\\times10^3$, $313_5$. Never write sqrt(49) or x^2 as plain text.",
  "- Vertical / column arithmetic: ONE token on its own line — [[vmath op=+ lines=347,285 answer=632]] — where op is one of + - × ÷ (multiplication and division are set out in columns too), lines are the operands top-to-bottom, and answer may be left empty for the learner to find.",
  "- Chemistry and science notation: real subscripts and superscripts via $...$ (e.g. $H_2O$, $CO_2$, $m/s^2$), a real arrow → in equations (never \"->\"), and the degree sign ° for temperatures and angles.",
  "- Units, currency and measurements stay plain text (K12.50, 45 kg, 30 cm) — markup is for mathematical STRUCTURE, not ordinary numbers.",
  "- Ratios, dates and page references written with a slash or colon (3:5, 12/03/2026) are NOT fractions — leave them as plain text.",
].join("\n");

module.exports = {MATHS_NOTATION_BLOCK};
