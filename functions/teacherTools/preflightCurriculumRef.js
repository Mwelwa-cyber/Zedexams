/**
 * preflightCurriculumRef — admin-only sanity check.
 *
 * Lets the admin UI ask, BEFORE queueing a learner-AI task, whether
 * a given grade/subject/topic/subtopic/term tuple will satisfy the
 * strict curriculum resolver. Returns `{ok:true}` if the dispatcher
 * would accept it, or `{ok:false, reason:"..."}` matching the
 * structured refusal codes from resolveStrictCurriculumRef.
 *
 * Same admin gate as the other CBC KB callables. No state writes.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  resolveStrictCurriculumRef,
} = require("../agents/learnerAi/curriculumResolver");

exports.preflightCurriculumRef = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }

      const data = (request && request.data) || {};
      const grade = typeof data.grade === "string" ? data.grade : "";
      const subject = typeof data.subject === "string" ? data.subject : "";
      const topic = typeof data.topic === "string" ? data.topic : "";
      const subtopic = typeof data.subtopic === "string" ? data.subtopic : "";
      const term = data.term;

      try {
        const result = await resolveStrictCurriculumRef({
          grade, subject, topic, subtopic, term,
        });
        if (result && result.ok) {
          return {ok: true};
        }
        return {
          ok: false,
          reason: (result && result.reason) || "no_curriculum_match",
        };
      } catch (err) {
        return {
          ok: false,
          reason: "resolver_error",
          message: err && err.message ? err.message : String(err),
        };
      }
    },
);
