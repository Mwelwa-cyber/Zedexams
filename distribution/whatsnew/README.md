# Play Store release notes ("What's new")

Files here are uploaded to Google Play as the per-release **What's new**
notes by `.github/workflows/android-play-release.yml` (the AAB / closed-testing
workflow), via the `whatsNewDirectory` input of `r0adkll/upload-google-play`.

## Format

- One file per listing language, named `whatsnew-<lang>` (BCP-47 tag), e.g.
  `whatsnew-en-US`, `whatsnew-en-GB`.
- **Max 500 characters** per file — the Play API rejects longer notes.
- `en-US` is the store's default listing language. Only add a `whatsnew-<lang>`
  file for a language that is an **active listing language** in Play Console —
  notes for a language that isn't in the listing make the publish step fail.

## Updating for a release

Edit `whatsnew-en-US` before cutting a release (tagging `v*.*.*`, or running the
Android Play Release workflow with `upload_to_play=true`). Keep the fuller
running history in `docs/CHANGELOG.md`; this file is the short tester-facing blurb.
