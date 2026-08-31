"use strict";

/**
 * subscriptionExpiryReminderCore — pure decision for WHO a subscription
 * expiry reminder addresses.
 *
 * PAY-001, Limit 2 (BUG_REPORT.md): a guardian-funded subscription lives on
 * the CHILD's own `users/{uid}` document — `subscriptionActivation.js` grants
 * the plan there and `guardianEntitlement.js` cascades it to siblings the
 * same way — but the adult who will actually pay to renew it is the
 * guardian. Before this, `subscriptionExpiryReminders` (reminderCrons.js)
 * read only the credited account and always addressed the reminder to it, so
 * a guardian-funded child was nudged to "Renew now" with no way to pay, and
 * the guardian who could never learned their child's plan was expiring.
 *
 * `subscriptionGrantedByGuardian` is the one field both writers stamp with
 * the guardian's uid (never the payer's own, since paying for yourself is
 * never a guardian payment — see `guardianBillingCore.creditedUid` /
 * `isGuardianPayment`). Its presence on the expiring account is what this
 * module reads to redirect the reminder rather than duplicate it: the
 * child's plan is not double-billed, only the message about it is re-routed
 * to whoever can act on it.
 *
 * Pure — no Firestore, so the routing decision a family could dispute
 * ("nobody told me my daughter's plan was expiring") is testable as data in,
 * data out, exactly like `guardianEntitlement.decideCascade`.
 *
 * Two consumers share `guardianUidFor`, the one primitive: the in-app cron
 * (`reminderCrons.js`, via `resolveExpiryReminderTarget` below) and the
 * admin-triggered WhatsApp broadcast (`messagingHandlers.sendExpiryReminders`),
 * which cannot reuse `resolveExpiryReminderTarget` itself because a WhatsApp
 * send needs a phone number looked up from the guardian's OWN document, not
 * an in-app notification's title/body/action shape.
 */

/**
 * The guardian to redirect a reminder to, or `null` for an ordinary
 * self-funded subscription.
 *
 * Both writers of `subscriptionGrantedByGuardian` (the direct-beneficiary
 * grant in `subscriptionActivation.js` and the sibling cascade in
 * `guardianEntitlement.js`) stamp the GUARDIAN's uid, never the child's own
 * — so the only defensive check needed here is against it somehow naming the
 * account itself (a payment can't credit and be paid by the same uid; see
 * `guardianBillingCore.isGuardianPayment`), which would otherwise loop a
 * reminder back to the very account it was meant to redirect away from.
 *
 * @param {object} data  the expiring account's `users/{uid}` document.
 * @param {string} uid   that account's own uid.
 * @returns {string|null}
 */
function guardianUidFor(data, uid) {
  const guardianUid = typeof data?.subscriptionGrantedByGuardian === "string" ?
    data.subscriptionGrantedByGuardian.trim() : "";
  return guardianUid && guardianUid !== uid ? guardianUid : null;
}

/**
 * @param {object} args
 * @param {string} args.uid        the account whose `subscriptionExpiry` is
 *                                  in the reminder window — the credited
 *                                  account, child or self.
 * @param {object} args.data       that account's `users/{uid}` document.
 * @param {number} args.days       days until expiry (>= 1), already computed
 *                                  by the caller from `data.subscriptionExpiry`.
 * @param {string} args.dateKey    today's YYYY-MM-DD, for the dedupe key.
 * @returns {{
 *   recipientUid: string,
 *   guardianRouted: boolean,
 *   category: 'payments', type: string, title: string, body: string,
 *   action: {label: string, url: string}, dedupeKey: string,
 * }}
 */
function resolveExpiryReminderTarget({uid, data, days, dateKey} = {}) {
  const dayWord = `day${days === 1 ? "" : "s"}`;
  const guardianUid = guardianUidFor(data, uid);

  if (guardianUid) {
    const childName = (typeof data?.displayName === "string" && data.displayName.trim()) ||
      (typeof data?.firstName === "string" && data.firstName.trim()) ||
      null;
    return {
      recipientUid: guardianUid,
      guardianRouted: true,
      category: "payments",
      type: "guardian_subscription_expiry",
      title: "A linked child's plan is expiring soon",
      body: `${childName ? `${childName}'s` : "The"} plan ends in ${days} ${dayWord}. ` +
        "Renew from Family Plan to keep full access.",
      action: {label: "Manage family plan", url: "/family/plan"},
      // Keyed on the EXPIRING account, not the recipient — a guardian with
      // two children both due the same day must get two notifications, not
      // have the second look like a repeat of the first in their own feed.
      dedupeKey: `expiry-${dateKey}-${uid}`,
    };
  }

  return {
    recipientUid: uid,
    guardianRouted: false,
    category: "payments",
    type: "subscription_expiry",
    title: "Your subscription is expiring soon",
    body: `Your plan ends in ${days} ${dayWord}. Renew to keep full access.`,
    action: {label: "Renew now", url: "/my-subscription"},
    dedupeKey: `expiry-${dateKey}-${uid}`,
  };
}

module.exports = {guardianUidFor, resolveExpiryReminderTarget};
