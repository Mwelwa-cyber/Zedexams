# Deploying zedexams.com

Every change you make should reach production via **`git push`**. No more hunting for Netlify tokens or Firebase logins on your machine. This doc explains how the auto-deploy works, the one-time setup to finish wiring it, and an emergency escape hatch.

---

## The big picture

There are two independent pipelines. A single `git push` triggers both.

**1. Netlify (frontend — React app)**
Netlify watches the `main` branch of `github.com/Mwelwa-cyber/Zedexams`. On every push it runs `npm run build` (defined in `netlify.toml`) and publishes the contents of `dist/` to zedexams.com. This is already set up and working — you don't need to do anything.

**2. Firebase (backend — Firestore rules + Cloud Functions)**
A GitHub Actions workflow at `.github/workflows/deploy-firebase.yml` runs on every push that touches a Firebase-related file (`firestore.rules`, `firestore.indexes.json`, `storage.rules`, `functions/**`, `firebase.json`, `.firebaserc`). It deploys only what changed. This pipeline needs a one-time setup (next section) before it can authenticate.

---

## One-time setup (5 minutes, once forever)

### Step 1 — Generate a Firebase CI token

On your laptop, in any directory:

```bash
npx firebase-tools@latest login:ci
```

A browser opens, you sign in, then the terminal prints a long token starting with `1//...`. Copy the whole thing.

### Step 2 — Add the token as a GitHub secret

1. Open <https://github.com/Mwelwa-cyber/Zedexams/settings/secrets/actions>
2. Click **New repository secret**
3. Name: `FIREBASE_TOKEN`
4. Value: paste the token from step 1
5. Click **Add secret**

### Step 3 — Verify Netlify is connected to GitHub

1. Open <https://app.netlify.com/sites/zedexams/configuration/deploys>
2. Under **Build settings**, confirm the repository is `Mwelwa-cyber/Zedexams` and the branch is `main`.
3. Under **Environment variables**, confirm the `VITE_FIREBASE_*` variables are present. If they aren't, copy them from your local `.env` file.

That's it. From now on, every push deploys.

---

## How it feels, day to day

```bash
git add .
git commit -m "Add Grade 8 Mathematics lesson plan sample"
git push
```

Open two tabs:

- <https://app.netlify.com/sites/zedexams/deploys> — watch the frontend build (usually 1–2 minutes)
- <https://github.com/Mwelwa-cyber/Zedexams/actions> — watch the Firebase deploy run if any backend file changed

If both go green, zedexams.com is updated.

If your commit only touched Markdown or docs, the Firebase workflow does nothing (path filters) and Netlify still rebuilds the frontend anyway.

---

## Manual escape hatch

If you need to force a Firebase deploy without pushing code:

1. Open <https://github.com/Mwelwa-cyber/Zedexams/actions/workflows/deploy-firebase.yml>
2. Click **Run workflow** (top right)
3. Pick what to deploy: `all`, `firestore`, `functions`, or `storage`
4. Click the green **Run workflow** button

This runs the same pipeline as a push but doesn't require any code change.

---

## If a deploy fails

### Firebase deploy in GitHub Actions fails with "FIREBASE_TOKEN secret is not set"

You skipped Step 2 above. Go back and add the secret.

### Firebase deploy fails with "token is invalid or expired"

Rotate the token: run `firebase login:ci` again, copy the new token, replace the `FIREBASE_TOKEN` secret value in GitHub. CI tokens don't expire from inactivity, but they do expire if you revoke them, if Google rotates them, or if you signed in from a suspicious location.

### Firebase functions deploy fails with "Secret Manager: ANTHROPIC_API_KEY not found"

The Anthropic API key isn't configured in Google Cloud Secret Manager. From your laptop, run:

```bash
npx firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY
```

Paste your `sk-ant-...` key when prompted. Then re-run the deploy from the Actions tab.

### Netlify build fails with "vite: command not found" or similar

Netlify isn't installing devDependencies. Check Netlify environment variables and confirm `NPM_FLAGS` is NOT set to `--production`. By default, Netlify installs everything including devDependencies, which is what you want.

### Netlify build succeeds but the site looks broken

The `VITE_FIREBASE_*` environment variables aren't set in Netlify. Without them the client can't reach Firebase. Copy them from your local `.env` into Netlify's environment variable panel.

### A function deploys but teachers see "AI is not configured yet"

The function ran but can't find `ANTHROPIC_API_KEY` at runtime. Check that the secret exists in Google Cloud Secret Manager with the value set, AND that the function is deployed **after** the secret was created (deploy binds secrets at deploy time).

```bash
npx firebase-tools@latest functions:secrets:access ANTHROPIC_API_KEY
```

If this prints your key, the secret is fine. Re-deploy functions to pick it up.

---

## What I'll never do again

- Run `npm run deploy` manually from Windows to push to Netlify.
- Run `npm run deploy:firebase:*` from Windows.
- Hunt for an expired Netlify personal access token.

All of those were bridges to automation. The bridges are now crossed. Just push.

---

## Smoke test after a deploy

After any deploy that touches user-facing features, walk this 3-minute test:

1. Open zedexams.com in an incognito window. Landing loads.
2. Go to `/teachers`. Landing page renders.
3. Click a sample at `/teachers/samples`. Sample detail renders, DOCX download works.
4. Sign in with an admin account. Teacher dashboard shows the three AI tool cards.
5. Generate a Grade 5 Maths Fractions lesson plan. Returns in under 30s.
6. Download it as DOCX. Opens in Word.
7. Open the library — the generation is listed. Click in. Re-export. Works.
8. Open `/admin/waitlist`. Loads (may show "index building" if you changed that index).

If all 8 pass, the deploy is healthy.

---

## Rolling back

If a deploy breaks production:

**Frontend (Netlify):**
1. <https://app.netlify.com/sites/zedexams/deploys>
2. Find the last green deploy
3. Click the `...` menu → **Publish deploy**

Takes 5 seconds, zero downtime. The broken build is preserved so you can diagnose it later.

**Firebase:**
Rollback is less clean. Your fastest option is to `git revert` the offending commit and push — the workflow runs again and re-deploys the previous code. For rules specifically, you can also edit them directly in the Firebase console as an emergency hotfix, then fix them in git later.
