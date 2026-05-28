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

const {onCall} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  resolveStrictCurriculumRef,
} = require("../agents/learnerAi/curriculumResolver");

exports.preflightCurriculumRef = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      // Outer try/catch is a belt-and-braces guarantee: nothing in this
      // callable may ever escape as an HTTP 500. The client bucket-labels
      // every non-permission-denied error as `callable_error`, which is
      // a debugging dead end — we've seen the admin batch UI stuck on
      // that code for days. Any unexpected throw is turned into a
      // structured refusal with the underlying error message.
      try {
        const uid = request.auth && request.auth.uid;
        if (!uid) {
          return {ok: false, reason: "unauthenticated", message: "Please sign in."};
        }

        let role;
        try {
          role = await getUserRole(uid);
        } catch (err) {
          return {
            ok: false,
            reason: "role_check_failed",
            message: err && err.message ? err.message : String(err),
          };
        }
        if (role !== "admin") {
          return {ok: false, reason: "permission_denied", message: "Admin only."};
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
      } catch (err) {
        // Last-resort catch — anything that survives the inner handlers
        // (a TypeError from a malformed `request`, an OOM bubble, etc.)
        // still becomes a structured response instead of a 500.
        console.error("preflightCurriculumRef unexpected error", err);
        return {
          ok: false,
          reason: "preflight_internal_error",
          message: err && err.message ? err.message : String(err),
        };
      }
    },
);
