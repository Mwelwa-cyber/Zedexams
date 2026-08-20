"use strict";

/**
 * guardianLinkDecisions — the pure half of the link lifecycle.
 *
 * Firestore, email and auth live in index.js. What is here is every
 * question the answer to which a family might one day dispute: may this
 * child confirm this link, may this adult withdraw, and what happens to
 * a child who asks to be unsupervised. Those are testable as functions
 * of their arguments; the writes around them are not, and mixing the two
 * is how a rule ends up only being true in the emulator.
 *
 * This is CommonJS because Cloud Functions is, and the shared ESM
 * vocabulary (`guardianLinkCore`) is injected by the caller rather than
 * imported — the same `await import(...)`-inside-the-handler dance the
 * rest of functions/ does for functions/shared/. Injecting keeps this
 * file synchronous and therefore trivially testable.
 */

/* ── The child's confirmation is NOT here ──────────────────────────
 *
 * `respondToFamilyLink` (functions/familyPortal.js) owns accept/decline
 * and the `status` flag it writes. A second decision function for the
 * same event lived here and was removed with the callable that used it:
 * two paths deciding whether a child had said yes is how they come to
 * disagree.
 */

/* ── The guardian withdrawing ──────────────────────────────────────── */

/**
 * May this guardian withdraw consent, and what state does the child land
 * in?
 *
 * @param {object} args
 * @param {Array<object>} args.links   every link for this learner
 * @param {string} args.guardianUid
 * @param {object} args.deps  { normalizeLink, resolveLinkConsent, LINK_CONSENT }
 * @returns {{ok: boolean, reason?: string, message?: string,
 *             childStillApproved?: boolean, remainingGuardians?: number}}
 *
 * The interesting output is `childStillApproved`. Withdrawal by one of
 * two guardians must NOT drop the child into limited mode — the other
 * adult's approval is still standing, and taking the leaderboard away from
 * a child because their father closed his account would be a bug the
 * family would experience as a punishment.
 */
function decideWithdrawal({links, guardianUid, deps}) {
  const {normalizeLink, resolveLinkConsent, LINK_CONSENT} = deps;
  const rows = (Array.isArray(links) ? links : []).map((raw) => ({raw, l: normalizeLink(raw)}));
  const mine = rows.find((r) => r.l.parentUid === guardianUid);

  if (!mine) {
    return {ok: false, reason: "not-linked", message: "You are not linked to this child."};
  }
  if (mine.l.state === LINK_CONSENT.WITHDRAWN) {
    return {ok: false, reason: "already-withdrawn", message: "You have already ended this link."};
  }

  // What the child's state becomes once this one is withdrawn — computed
  // over the WOULD-BE set, not the current one, because the caller needs
  // to know before it writes whether it is about to limit a child.
  const after = rows.map((r) => (
    r.l.parentUid === guardianUid ?
      {...r.raw, consent: {...(r.raw.consent || {}), state: LINK_CONSENT.WITHDRAWN}} :
      r.raw
  ));
  const consent = resolveLinkConsent(after);

  return {
    ok: true,
    wasState: mine.l.state,
    childStillApproved: consent.approved,
    remainingGuardians: consent.approvedBy.length,
  };
}

/* ── The child asking to be unlinked ───────────────────────────────── */

/**
 * A child asks to remove a guardian.
 *
 * This ALWAYS returns a request, never a removal, and that is the whole
 * point of the function existing rather than the callable just deleting
 * the row. A child who could quietly drop supervision is a child who can
 * be talked into dropping it — by the person the supervision exists to
 * notice.
 *
 * The one thing it does decide is whether the ask is even coherent: you
 * cannot ask to remove a guardian you do not have, and asking twice
 * should not file a second ticket.
 *
 * NOTE the deliberate asymmetry with `decideChildConfirmation`. A child
 * CAN reject a link outright, and cannot unlink one they confirmed. The
 * line is confirmation: before it, no adult has been granted anything
 * and the child is refusing a stranger; after it, an adult holds a
 * relationship the child should not be able to end alone. Childline 116
 * is available on both sides of that line and needs no guardian's
 * knowledge — which is the escape hatch this rule assumes exists, and
 * why the callable is required to surface it.
 */
function decideUnlinkRequest({links, learnerUid, guardianUid, openRequests, deps}) {
  const {normalizeLink, LINK_CONSENT} = deps;
  const rows = (Array.isArray(links) ? links : []).map(normalizeLink);
  const mine = rows.find((l) => l.parentUid === guardianUid && l.learnerUid === learnerUid);

  if (!mine) {
    return {ok: false, reason: "not-linked", message: "That grown-up is not linked to you."};
  }
  if (mine.state === LINK_CONSENT.PENDING) {
    // Nothing has been granted yet, so there is nothing to negotiate:
    // the child can simply say no. Routing this through a request would
    // make refusing a stranger slower than accepting one.
    return {
      ok: false,
      reason: "use-reject",
      message: "This grown-up is not linked yet — you can just say no.",
    };
  }
  if (Array.isArray(openRequests) && openRequests.length > 0) {
    return {ok: false, reason: "already-asked", message: "You have already asked. We are on it."};
  }

  return {ok: true, action: "request"};
}

/* ── Copy ──────────────────────────────────────────────────────────── */

/**
 * The sentence a child is shown when an adult has typed their family
 * code. It names the adult, because "somebody wants to be your guardian"
 * is a question nobody can answer.
 */
function buildConfirmationPrompt({guardianName} = {}) {
  const name = String(guardianName || "").trim();
  return name ?
    `${name} wants to be your guardian. Is this your grown-up?` :
    "Someone wants to be your guardian. Do you know who this is?";
}

/** The email a child's guardians get when the child asks to be unlinked. */
function buildUnlinkRequestEmail({childName} = {}) {
  const child = String(childName || "").trim() || "A learner you look after";
  return {
    subject: `${child} has asked to remove a guardian on ZedExams`,
    text: [
      `${child} has asked us to remove a guardian from their ZedExams account.`,
      "",
      "We have NOT removed anyone. A child cannot end guardian supervision on",
      "their own, so this is a message rather than an action — it is here so",
      "you can have the conversation.",
      "",
      "If you want to end the link yourself, you can do that from",
      "https://zedexams.com/family at any time.",
      "",
      "If a child is in danger, Childline Zambia is 116, free from any network,",
      "and they do not need a guardian's permission to call.",
    ].join("\n"),
  };
}

module.exports = {
  buildConfirmationPrompt,
  buildUnlinkRequestEmail,
  decideUnlinkRequest,
  decideWithdrawal,
};
