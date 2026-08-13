// node src/utils/quizImageUpload.test.js
//
// The bug these pin: the quiz editor (including the Past Paper Studio's quiz
// step and "Crop from page") answered every refused upload with "the image
// may be too large (10 MB max after compression). Try a smaller crop or a
// JPEG." Storage returns `storage/unauthorized` for every arm of the rule
// alike, so that sentence was a guess — and the guess was wrong often enough
// that an admin whose real problem was a role or a stale token would crop
// smaller and smaller forever.
//
// Two properties have to hold together:
//   1. the compressor's ladder always terminates under the cap, so size
//      genuinely cannot be the cause of a server refusal, and
//   2. the refusal copy says so, and names what IS worth checking.
// (2) is only honest while (1) holds, which is why both are tested here.

import assert from 'node:assert/strict'
import {
  IMAGE_TOO_LARGE,
  MAX_ENCODE_ATTEMPTS,
  MIN_ENCODE_WIDTH,
  QUALITY_LADDER,
  QUIZ_IMAGE_RULE_MAX_BYTES,
  QUIZ_IMAGE_TARGET_BYTES,
  formatMb,
  oversizeImageError,
  planNextEncode,
  uploadErrorMessage,
} from './quizImageUpload.js'

const MB = 1024 * 1024

// ── the budget itself ────────────────────────────────────────────────────
{
  // storage.rules' validQuizImageUpload() is `size < 10 * 1024 * 1024`, and
  // the client must aim strictly under it — a target equal to the cap would
  // make a blob of exactly that size pass here and be refused there.
  assert.equal(QUIZ_IMAGE_RULE_MAX_BYTES, 10 * MB)
  assert.ok(QUIZ_IMAGE_TARGET_BYTES < QUIZ_IMAGE_RULE_MAX_BYTES)
}

// ── planNextEncode ───────────────────────────────────────────────────────
{
  // Within budget: stop. Boundary included — `bytes === maxBytes` is fine,
  // the rule's exclusive `<` is covered by the target's headroom.
  assert.equal(planNextEncode({ bytes: 1 * MB, format: 'image/png', quality: 0.92, width: 1600 }).action, 'accept')
  assert.equal(
    planNextEncode({ bytes: QUIZ_IMAGE_TARGET_BYTES, format: 'image/jpeg', quality: 0.92, width: 1600 }).action,
    'accept',
  )
}

{
  // An oversize PNG jumps to JPEG at the TOP of the quality ladder and keeps
  // its width. This is the "Crop from page" case: the crop modal hands back
  // a lossless PNG of a scanned page, and dropping the alpha channel alone
  // usually sheds most of the weight — stepping the quality down first would
  // blur a page of small print for no reason.
  const step = planNextEncode({ bytes: 12 * MB, format: 'image/png', quality: 0.92, width: 1600 })
  assert.deepEqual(step, {
    action: 'retry',
    format: 'image/jpeg',
    quality: QUALITY_LADDER[0],
    maxWidth: 1600,
  })
}

{
  // Quality steps down before any pixels are lost — downscaling is what makes
  // exam-page text and figure labels unreadable.
  const step = planNextEncode({ bytes: 12 * MB, format: 'image/jpeg', quality: QUALITY_LADDER[0], width: 1600 })
  assert.equal(step.action, 'retry')
  assert.equal(step.quality, QUALITY_LADDER[1])
  assert.equal(step.maxWidth, 1600, 'width must not shrink while quality is still available')
}

{
  // Only once the ladder is spent does the width come down.
  const lowest = QUALITY_LADDER[QUALITY_LADDER.length - 1]
  const step = planNextEncode({ bytes: 12 * MB, format: 'image/jpeg', quality: lowest, width: 1600 })
  assert.equal(step.action, 'retry')
  assert.ok(step.maxWidth < 1600)
  assert.equal(step.quality, lowest)
}

{
  // It gives up rather than shrinking a page scan to illegibility.
  const lowest = QUALITY_LADDER[QUALITY_LADDER.length - 1]
  const step = planNextEncode({ bytes: 12 * MB, format: 'image/jpeg', quality: lowest, width: MIN_ENCODE_WIDTH })
  assert.equal(step.action, 'fail')
}

{
  // Termination, driven by the plan alone: whatever it starts from, the
  // ladder reaches accept-or-fail inside the compressor's attempt budget.
  // Without this the loop is a promise, not a property.
  for (const start of [{ format: 'image/png', quality: 0.92 }, { format: 'image/jpeg', quality: 0.92 }]) {
    let format = start.format
    let quality = start.quality
    let width = 1600
    let steps = 0
    let action = 'retry'
    while (action === 'retry') {
      // Worst case: nothing the ladder does ever helps.
      const plan = planNextEncode({ bytes: 40 * MB, format, quality, width })
      action = plan.action
      if (action !== 'retry') break
      format = plan.format
      quality = plan.quality
      width = plan.maxWidth
      steps += 1
      assert.ok(steps <= MAX_ENCODE_ATTEMPTS, `ladder from ${start.format} exceeded the attempt budget`)
    }
    assert.equal(action, 'fail')
  }
}

// ── uploadErrorMessage ───────────────────────────────────────────────────
{
  // THE REGRESSION. A refused write must not be blamed on the file size:
  // the compressor guarantees the blob fits, so every remaining cause is a
  // permissions one, and "try a smaller crop" is advice that cannot work.
  const msg = uploadErrorMessage({
    code: 'storage/unauthorized',
    message: "Firebase Storage: User does not have permission to access 'quiz-images/abc/1-2.png'",
  })
  assert.ok(!/too large|smaller crop/i.test(msg), 'must not blame the size on a permissions refusal')
  assert.ok(/role/i.test(msg) && /verif/i.test(msg), 'must name the checks that remain')
  assert.ok(/sign out/i.test(msg), 'a role or verification change only reaches Storage on a token refresh')
}

{
  // The same refusal arrives with an empty code and the permission wording
  // in the message on some SDK paths; it must classify the same way.
  const msg = uploadErrorMessage({
    code: 'storage/unknown',
    message: 'Firebase Storage: User does not have permission to access this object.',
  })
  assert.ok(!/too large/i.test(msg))
  assert.ok(/role/i.test(msg))
}

{
  // Size IS reported — but only when it was actually measured, and it says
  // the real number instead of a rule the admin has to take on faith.
  const msg = uploadErrorMessage(oversizeImageError(13 * MB))
  assert.ok(/13\.0 MB/.test(msg), 'names the measured size')
  assert.ok(/10\.0 MB/.test(msg), 'names the limit')
  assert.ok(/crop/i.test(msg), 'here, and only here, cropping smaller is the fix')
}

{
  const err = oversizeImageError(13 * MB)
  assert.equal(err.code, IMAGE_TOO_LARGE)
  assert.equal(err.bytes, 13 * MB)
}

{
  // App Check's own message is already a complete instruction — passed
  // through, not wrapped in a second "Upload failed:" preamble.
  const msg = uploadErrorMessage({
    code: 'appcheck/unattested',
    message: "We couldn't verify this device just now. Please try that upload again in a moment.",
  })
  assert.equal(msg, "We couldn't verify this device just now. Please try that upload again in a moment.")
  assert.ok(!/^Upload failed/.test(msg))
}

{
  // An enforced bucket refuses an unattested request with the SAME
  // `storage/unauthorized` a rules denial uses. When the App Check state
  // proves the build never attested, the role/verification advice is a dead
  // end — an admin already has the role — so the message must name the real
  // cause instead. Passing no state keeps the previous permissions wording.
  const unattested = uploadErrorMessage(
    { code: 'storage/unauthorized' },
    { native: false, recaptchaKeyConfigured: false, initialized: false },
  )
  assert.match(unattested, /App Check/i)
  assert.ok(
    !/sign out and back in|needs the teacher or admin role/i.test(unattested),
    'an unattested build must not be reported as a role problem',
  )

  const denied = uploadErrorMessage(
    { code: 'storage/unauthorized' },
    { native: false, recaptchaKeyConfigured: true, initialized: true },
  )
  assert.match(denied, /teacher or admin role/i)

  // Back-compat: callers that cannot see the state keep the old message.
  assert.match(uploadErrorMessage({ code: 'storage/unauthorized' }), /teacher or admin role/i)
}

{
  assert.match(uploadErrorMessage({ code: 'storage/canceled' }), /canceled/i)
  assert.match(uploadErrorMessage({ code: 'storage/retry-limit-exceeded' }), /connection/i)
  assert.match(uploadErrorMessage({ code: 'storage/unauthenticated' }), /sign in again/i)
  assert.match(uploadErrorMessage({ code: 'storage/quota-exceeded' }), /out of space/i)
  assert.match(uploadErrorMessage({ message: 'the network dropped' }), /connection/i)
  assert.match(uploadErrorMessage({}), /please try again/i)
}

{
  assert.equal(formatMb(0), '0 MB')
  assert.equal(formatMb(undefined), '0 MB')
  assert.equal(formatMb(1.5 * MB), '1.5 MB')
}

console.log('quizImageUpload: all assertions passed')
