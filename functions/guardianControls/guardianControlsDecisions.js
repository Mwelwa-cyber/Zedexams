/**
 * Pure decisions for the setGuardianControl callable. No firebase-admin,
 * no firebase-functions, no network — so scripts/test-guardian-controls.mjs
 * can exercise every refusal under plain node.
 *
 * The callable's whole job is deciding whether one write is allowed and
 * what everybody should be told about it afterwards; keeping that here
 * means the rules are testable and the handler is plumbing.
 */

const REFUSALS = Object.freeze({
  "unknown-control": "That setting does not exist.",
  "not-a-boolean": "A control is either on or off.",
  "no-guardian":
    "Only a parent or guardian who has approved this account can change these settings.",
  "unchanged": "That setting is already set that way.",
});

/**
 * Decide whether a control change may proceed.
 *
 * @param {object} input
 * @param {string} input.key           The control key the caller named.
 * @param {*} input.value              The value the caller sent.
 * @param {object|null} input.user     The learner's user document.
 * @param {object} input.deps          {isGuardianControl, readGuardianControls,
 *                                      resolveLearnerAccess} from the shared cores.
 * @return {{ok: boolean, reason?: string, message?: string, from?: boolean|null}}
 */
function decideControlChange({key, value, user, deps}) {
  const {isGuardianControl, readGuardianControls, resolveLearnerAccess} = deps;

  if (!isGuardianControl(key)) {
    return {ok: false, reason: "unknown-control", message: REFUSALS["unknown-control"]};
  }
  if (typeof value !== "boolean") {
    // Never coerce. A truthy string arriving from a hand-rolled client must
    // not become a parent's decision — the three-valued shape in the shared
    // core only means anything if nothing but a real boolean gets stored.
    return {ok: false, reason: "not-a-boolean", message: REFUSALS["not-a-boolean"]};
  }

  // The zone is a convenience surface bound to a VERIFIED guardian: the
  // account must actually have one who approved. Without that there is
  // nobody whose decision this would be, and nobody to notify — which is
  // the property that makes the audit trail meaningful.
  const access = resolveLearnerAccess(user);
  if (access.reason !== "guardian-approved") {
    return {ok: false, reason: "no-guardian", message: REFUSALS["no-guardian"]};
  }

  const from = readGuardianControls(user)[key];
  if (from === value) {
    // Not an error the caller needs to see as a failure, but it must not
    // write an audit entry or send an email — a parent should not get a
    // message every time a screen re-renders.
    return {ok: false, reason: "unchanged", message: REFUSALS["unchanged"], from};
  }

  return {ok: true, from};
}

/**
 * The message the guardian receives. Deliberately plain: what changed,
 * on whose account, and what to do if it was not them. Naming the child
 * and the setting is what makes an unexpected message actionable.
 */
function buildControlNoticeEmail({childName, description, appName = "ZedExams"}) {
  const name = String(childName || "your child").replace(/\s+/g, " ").trim().slice(0, 60) || "your child";
  return {
    subject: `${appName}: a parent control changed on ${name}'s account`,
    text: [
      `Hello,`,
      ``,
      `${description} on ${name}'s ${appName} account, from the Guardian Zone in the app.`,
      ``,
      `If that was you, nothing further is needed.`,
      ``,
      `If it was not you, open the Guardian Zone on ${name}'s device and set it back — ` +
        `the zone is behind an adult check, but it runs on your child's own phone, ` +
        `so a determined child can reach it. This message is how you find out.`,
      ``,
      `— The ${appName} team`,
    ].join("\n"),
  };
}

module.exports = {REFUSALS, decideControlChange, buildControlNoticeEmail};
