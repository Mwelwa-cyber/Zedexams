"use strict";

/**
 * The pages a guardian sees after clicking the link in their message.
 *
 * Server-rendered HTML rather than a React route, deliberately. The audience
 * is a Zambian parent opening a link from WhatsApp or email, often on a
 * low-end Android phone on a slow connection. A 12 MB SPA that must boot,
 * hydrate and resolve a route before it can show a button is the wrong
 * mechanism for a page whose entire job is one decision. This renders in one
 * request, needs no JavaScript at all, and cannot be broken by a chunk-load
 * failure.
 *
 * ── The decision is a POST, never a GET ──────────────────────────────────
 *
 * The link in the message does NOT act. It renders this page, and the
 * guardian clicks a button that POSTs back. That is not ceremony: corporate
 * mail gateways, link scanners, WhatsApp's own preview fetcher and antivirus
 * proxies all follow URLs in messages automatically. If approving were a GET,
 * a scanner would approve accounts nobody looked at — and since the same
 * mechanism offers "decline", which deactivates and schedules deletion, a
 * prefetcher could destroy a child's account before their parent ever read
 * the email.
 *
 * ── Approving requires saying who you are ───────────────────────────────
 *
 * The approve form carries a required "I am this child's parent or guardian"
 * checkbox, and the server refuses an approve POST without it — `required` in
 * the markup is a convenience for the person, not the enforcement, because a
 * POST does not have to come from this page. It is what makes the
 * hand-the-phone-over route honest: that path skips the message but lands on
 * this same page, so the adult standing next to the child answers exactly the
 * question the adult reading an email answers, and the consent record either
 * route writes says the same thing.
 *
 * Decline carries no such box on purpose. The person who did NOT expect this
 * message is precisely the one who may not be a guardian, and making them
 * claim to be one before they can say "this wasn't me" would turn the safety
 * route into the harder of the two.
 *
 * Pure module — string building only, no I/O.
 */

const {
  APP_NAME,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP,
  PRIVACY_URL,
  DELETE_URL,
  LEARNER_DATA_SUMMARY,
} = require("./consentMessages");

/**
 * Escape for HTML text and attribute contexts.
 *
 * Everything interpolated into these pages is attacker-influenced — the
 * child's name is typed at signup and the token comes from the query string —
 * and this page is rendered by a Cloud Function with no framework doing the
 * escaping for us. So it is done here, once, on every value.
 */
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
  :root{--ink:#1f2937;--muted:#6b7280;--brand:#0f766e;--brand-dark:#115e59;
        --bg:#f8fafc;--card:#fff;--border:#e5e7eb;--danger:#b91c1c}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:var(--bg);color:var(--ink);line-height:1.6;padding:24px 16px 64px}
  .wrap{max-width:560px;margin:0 auto}
  .brand{font-weight:800;font-size:1.25rem;color:var(--brand);margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;
        padding:24px;margin-bottom:16px}
  h1{font-size:1.35rem;margin-bottom:10px}
  h2{font-size:1rem;margin:18px 0 8px}
  p{margin-bottom:12px}
  ul{padding-left:20px;margin-bottom:12px}
  li{margin-bottom:4px;color:var(--muted)}
  .muted{color:var(--muted);font-size:.92rem}
  form{display:inline}
  button{font:inherit;font-weight:700;border:none;border-radius:8px;
         padding:14px 20px;cursor:pointer;width:100%;margin-top:10px}
  .confirm{display:flex;gap:10px;align-items:flex-start;background:#f8fafc;
           border:1px solid var(--border);border-radius:8px;padding:12px;
           margin:18px 0 4px;font-weight:600;cursor:pointer}
  .confirm input{width:20px;height:20px;margin:2px 0 0;flex:0 0 auto;cursor:pointer}
  .approve{background:var(--brand);color:#fff}
  .approve:hover{background:var(--brand-dark)}
  .decline{background:#fff;color:var(--danger);border:1px solid var(--danger)}
  .ok{border-left:4px solid var(--brand)}
  .bad{border-left:4px solid var(--danger)}
  a{color:var(--brand);font-weight:600}
  footer{text-align:center;font-size:.85rem;color:var(--muted);margin-top:24px}
`;

function page(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — ${esc(APP_NAME)}</title>
<style>${STYLE}</style></head><body><div class="wrap">
<div class="brand">${esc(APP_NAME)}</div>
${body}
<footer><a href="${PRIVACY_URL}">Privacy Policy</a> · ${esc(SUPPORT_EMAIL)} · WhatsApp ${esc(SUPPORT_WHATSAPP)}</footer>
</div></body></html>`;
}

/**
 * The decision page. Both buttons POST to the same URL; the token travels in
 * a hidden field so it is not left in a referrer header when the guardian
 * follows a link away from the result page.
 */
function renderDecisionPage({childName, token, actionUrl}) {
  const name = esc(childName);
  return page("Approve a learner account", `
<div class="card">
  <h1>Approve ${name}'s account?</h1>
  <p>${name} created a learner account on ${esc(APP_NAME)}, a Zambian learning
     platform for the CBC curriculum. Because they are under 18, we need a parent
     or guardian to approve it.</p>
  <p class="muted">Until you approve, they can only read lessons and past papers —
     no AI study assistant, no classes, no leaderboards, and no purchases.</p>

  <h2>What we store about ${name}</h2>
  <ul>${LEARNER_DATA_SUMMARY.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  <p class="muted">We do not show them advertising, sell their data, record their
     screen, or track their location. You can ask us to show, correct or delete
     any of it at any time — <a href="${DELETE_URL}">zedexams.com/delete-account</a>.</p>

  <form method="POST" action="${esc(actionUrl)}">
    <input type="hidden" name="token" value="${esc(token)}">
    <input type="hidden" name="decision" value="approve">
    <label class="confirm" for="confirm-guardian">
      <input type="checkbox" id="confirm-guardian" name="confirm" value="yes" required>
      <span>I am ${name}'s parent or guardian, and I agree to this account.</span>
    </label>
    <button type="submit" class="approve">Yes, approve this account</button>
  </form>
  <form method="POST" action="${esc(actionUrl)}">
    <input type="hidden" name="token" value="${esc(token)}">
    <input type="hidden" name="decision" value="decline">
    <button type="submit" class="decline">I did not expect this — remove the account</button>
  </form>
</div>`);
}

function renderApprovedPage({childName}) {
  const name = esc(childName);
  return page("Approved", `
<div class="card ok">
  <h1>Thank you</h1>
  <p><strong>${name}'s account is now fully active.</strong></p>
  <p>As a parent or guardian you can, at any time, review or correct what we hold
     about ${name}, or delete the account entirely — in the app under
     Settings → Account, or at <a href="${DELETE_URL}">zedexams.com/delete-account</a>.</p>
  <p class="muted">Changed your mind? Email <a href="mailto:${SUPPORT_EMAIL}">${esc(SUPPORT_EMAIL)}</a>
     or WhatsApp ${esc(SUPPORT_WHATSAPP)} and we will remove the account.</p>
</div>`);
}

function renderDeclinedPage() {
  return page("Account deactivated", `
<div class="card bad">
  <h1>Account deactivated</h1>
  <p>The account has been deactivated immediately and can no longer be used.</p>
  <p>If nobody resolves this within 30 days, the account and all of its data are
     deleted permanently.</p>
  <p class="muted">If this was a mistake, email
     <a href="mailto:${SUPPORT_EMAIL}">${esc(SUPPORT_EMAIL)}</a> or WhatsApp
     ${esc(SUPPORT_WHATSAPP)}.</p>
</div>`);
}

/**
 * Every failure a guardian can hit, phrased so it tells them what to DO.
 *
 * "Invalid link" on its own is a dead end for someone who is trying to do the
 * right thing, so each case names the next step. The wording never reveals
 * whether a token existed — an invalid token and a token for another family's
 * account produce the same page.
 */
const OUTCOME_PAGES = {
  invalid: () => page("Link not valid", `
<div class="card bad">
  <h1>This link is not valid</h1>
  <p>It may have been copied incompletely — links sometimes break across two lines
     in an email or message.</p>
  <p>Ask the learner to open ${esc(APP_NAME)} and tap <strong>Resend</strong> on the
     banner at the top of their screen, and we will send a fresh link.</p>
</div>`),
  expired: () => page("Link expired", `
<div class="card bad">
  <h1>This link has expired</h1>
  <p>For safety, approval links stop working after 7 days.</p>
  <p>Ask the learner to open ${esc(APP_NAME)} and tap <strong>Resend</strong> on the
     banner at the top of their screen, and we will send a new one.</p>
</div>`),
  used: () => page("Already handled", `
<div class="card">
  <h1>Already handled</h1>
  <p>This request has already been answered — there is nothing more to do.</p>
  <p class="muted">If you did not answer it yourself, contact us at
     <a href="mailto:${SUPPORT_EMAIL}">${esc(SUPPORT_EMAIL)}</a> straight away.</p>
</div>`),
  unconfirmed: () => page("One more tick", `
<div class="card">
  <h1>Please confirm you are the parent or guardian</h1>
  <p>We did not receive the tick that says you are this learner's parent or
     guardian, so nothing has been approved.</p>
  <p>Open the link again, tick the box, and press <strong>Yes, approve this
     account</strong>.</p>
</div>`),
  error: () => page("Something went wrong", `
<div class="card bad">
  <h1>Something went wrong</h1>
  <p>We could not process this just now. Please try the link again in a few minutes.</p>
  <p class="muted">If it keeps failing, email
     <a href="mailto:${SUPPORT_EMAIL}">${esc(SUPPORT_EMAIL)}</a> or WhatsApp
     ${esc(SUPPORT_WHATSAPP)} and we will sort it out for you.</p>
</div>`),
};

function renderOutcomePage(kind) {
  return (OUTCOME_PAGES[kind] || OUTCOME_PAGES.error)();
}

module.exports = {
  esc,
  page,
  renderDecisionPage,
  renderApprovedPage,
  renderDeclinedPage,
  renderOutcomePage,
  OUTCOME_KINDS: Object.keys(OUTCOME_PAGES),
};
