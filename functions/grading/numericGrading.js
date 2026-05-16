/**
 * functions/grading/numericGrading.js
 *
 * CommonJS port of src/utils/numericGrading.js. Kept byte-for-byte
 * equivalent in logic so server-side grading produces the SAME result the
 * client used to compute. Pure, dependency-free. Do not add imports.
 *
 * If you change one copy, change the other (src/utils/numericGrading.js)
 * and update both test suites.
 */

function numericMatches(given, correctAnswer, tolerance) {
  const rawGiven = (given !== null && typeof given === "object" && "value" in given)
    ? given.value
    : given;
  if (typeof rawGiven === "string" && rawGiven.trim() === "") return false;
  const a = typeof rawGiven === "number" ? rawGiven : Number(rawGiven);
  const b = typeof correctAnswer === "number" ? correctAnswer : Number(correctAnswer);
  const t = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const slack = Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= t + slack;
}

module.exports = {numericMatches};
