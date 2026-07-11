/**
 * getTermModuleOutline — HTTPS callable. Returns the uploaded curriculum
 * modules for a (grade, subject, term) shaped as official 9-column scheme
 * weeks so the Weekly Forecast studio can build a forecast straight from the
 * modules when the teacher has no saved scheme of work. No AI, no usage meter.
 *
 *   const fn = httpsCallable(functions, 'getTermModuleOutline');
 *   const { weeks, topicsCount, subtopicsCount } =
 *     (await fn({ grade: 'G5', subject: 'mathematics', term: 2 })).data;
 *
 * `weeks` are the same shape normalizeSchemeWeek() already understands, so the
 * client reuses its existing day-builder unchanged.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");

const {getUserRole, isStaffRole} = require("../aiService");
const {resolveTermModuleOutline} = require("./cbcKnowledge");

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);

exports.getTermModuleOutline = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
            "permission-denied",
            "Teacher tools are available to approved teachers only.",
        );
      }

      const data = request.data || {};
      const grade = String(data.grade || "").toUpperCase()
          .replace(/\s+/g, "").slice(0, 10);
      const subject = String(data.subject || "").toLowerCase()
          .replace(/[^a-z_]/g, "_").slice(0, 40);
      const term = Math.min(3, Math.max(1, Math.round(Number(data.term) || 0)));

      if (!ALLOWED_GRADES.has(grade) || !subject || !(term >= 1 && term <= 3)) {
        throw new HttpsError(
            "invalid-argument",
            "Provide a valid grade, subject and term (1-3).",
        );
      }

      const outline = await resolveTermModuleOutline({grade, subject, term});
      if (!outline) {
        return {weeks: [], topicsCount: 0, subtopicsCount: 0};
      }
      return {
        weeks: outline.weeks,
        topicsCount: outline.topicsCount,
        subtopicsCount: outline.subtopicsCount,
      };
    },
);
