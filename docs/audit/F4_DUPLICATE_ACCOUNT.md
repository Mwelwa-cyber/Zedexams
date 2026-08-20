# F4 — the second account, checked

> Snapshot as of 2026-08-20 — verify before acting.
> F4: registering with a malformed address produced uid `GGV6Uh…`; choosing
> "Use a different email" and entering a valid one produced `CTlHMAvc…`, leaving
> the first account behind — under-18, undeliverable address, no guardian.

## Confirmed: the second account is deliberate

`features/auth/pages/VerifyEmail.jsx:113-119`:

```js
async function handleChangeEmail() {
  // An unverified account can't prove it owns the old address, so the safe
  // "change email" is: sign out and register again with the right one.
  // (In-place verifyBeforeUpdateEmail is a possible future enhancement.)
  await logout()
  navigate('/register', { replace: true })
}
```

So this is a design decision with its reasoning recorded, not a broken path. The
reasoning is also sound as far as it goes: an unverified account genuinely
cannot prove it owns the address it is failing to verify.

## But one premise of the report does not hold

**A malformed address is already rejected client-side.** `Register.jsx:253`
validates `email: ['required', 'email']`, and `formValidation.js:43` is
`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Checked directly:

| Input | Accepted? |
|---|---|
| `plainaddress` | no |
| `a@b` | no |
| `a b@c.com` | no |
| `a@@b.com` | no |
| `user@gmial.com` | **yes** |

So what got through was almost certainly **syntactically valid but
undeliverable** — a typo in the domain. No regex can catch that, and no
validation change would have prevented this account.

That matters: there is nothing to tighten at the registration step, and
tightening it would only reject real addresses.

## What is actually wrong

Not that a second account is created — that the first is abandoned **silently**.
The link reads "Use a different email", which promises to change the address on
this account. It signs you out and registers a new one.

For an adult that is a stray unused record. For an under-18 signup it is a minor
record holding a date of birth, with an undeliverable address and no guardian
attached — kept for no purpose, which is a data-minimisation problem rather than
a security hole (nobody can reach it either).

## Changed here

Copy only, which is all that is safe to change on the auth path this close to
launch:

- the link now reads **"Start again with a different email"**
- with one line under it: *"Starting again makes a new account. This one stays
  unverified and unused."*

## The real fix, and why it is not in this change

`verifyBeforeUpdateEmail` — named in the code's own comment as "a possible
future enhancement". Worth noting the stated obstacle does not actually apply to
it: it does not require proving the OLD address. It sends a verification link to
the NEW one and swaps only when that link is clicked, which is exactly the proof
that is missing. So the in-place change is available, and would leave no orphan
at all.

It is not in this change because it needs an email input on this screen — new
UI on the signup path, two days before launch, in the flow every learner passes
through. That is a decision for the owner, not a copy fix.

Requirements when it is scheduled: a recent sign-in (fresh here, since the user
has just registered), a fallback to today's sign-out-and-register path on
`auth/requires-recent-login` or any other failure, and handling
`auth/email-already-in-use` for the new address.

## Owner action, unchanged

Delete `GGV6UhJHDwVIRwgHWQFmIh0n1ky2` from the Firebase console. Nothing in the
codebase can reach an abandoned auth record, and this one belongs to a minor.
