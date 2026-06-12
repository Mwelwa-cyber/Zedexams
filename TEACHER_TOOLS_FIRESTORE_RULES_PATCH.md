# Firestore rules additions for Teacher Tools MVP

> **⚠️ STATUS — re-verified 2026-05-29: ALREADY APPLIED. Do not paste these blocks again.** All six rule blocks below are live in `firestore.rules` (the `aiGenerations`, `teacherLibraries`, `usageMeters`, `cbcKnowledgeBase`, `promptTemplates`, and `schoolLicences` matches; `agentJobs` exists too). `firestore.rules` is the source of truth, not this file. Two caveats:
>
> - **The `aiGenerations` `update` block has since widened.** The live rule's `changedKeys().hasOnly([...])` now also allows `output` and `library` (plus immutability guards on `ownerUid` / `tool`), not just the `['teacherEdited', 'visibility', 'exportedFormats']` shown below. Don't treat the snippet below as current.
> - **The deploy command is stale.** Rules ship via CI (`deploy-firebase.yml`), not `npm run deploy:firebase:firestore` from a workstation.
>
> _Original patch kept below for history._

Paste these blocks **inside** the root `match /databases/{database}/documents { ... }` block in `firestore.rules`, next to the existing `// ── lessons ──` and `// ── payments ──` sections. They follow the same `isAuthed()`, `isOwner()`, `isAdmin()`, `callerRole()` helper pattern already defined at the top of the rules file.

After pasting, deploy with:

```bash
npm run deploy:firebase:firestore
```

---

```javascript
// ── aiGenerations ─────────────────────────────────────────
match /aiGenerations/{genId} {
  allow read:   if isAuthed() && (resource.data.ownerUid == request.auth.uid || isAdmin());
  // Client never creates these — only the Cloud Function does (admin SDK bypasses rules).
  allow create: if false;
  // Teachers can flip a few fields on their own generations: mark as edited,
  // change visibility, append to exportedFormats.
  allow update: if isAuthed()
                   && resource.data.ownerUid == request.auth.uid
                   && changedKeys().hasOnly(['teacherEdited', 'visibility', 'exportedFormats']);
  allow delete: if isAuthed() && (resource.data.ownerUid == request.auth.uid || isAdmin());
}

// ── teacherLibraries ──────────────────────────────────────
match /teacherLibraries/{uid} {
  allow read: if isAuthed() && (isOwner(uid) || isAdmin());
  match /items/{itemId} {
    allow read, write, delete: if isAuthed() && isOwner(uid);
  }
  match /folders/{folderId} {
    allow read, write, delete: if isAuthed() && isOwner(uid);
  }
}

// ── usageMeters ───────────────────────────────────────────
match /usageMeters/{uid} {
  allow read: if isAuthed() && (isOwner(uid) || isAdmin());
  match /periods/{periodId} {
    allow read:  if isAuthed() && (isOwner(uid) || isAdmin());
    // Only Cloud Functions (admin SDK) write these.
    allow write: if false;
  }
}

// ── cbcKnowledgeBase ──────────────────────────────────────
match /cbcKnowledgeBase/{version} {
  allow read:  if isAuthed();
  allow write: if isAdmin();
  match /topics/{topicId} {
    allow read:  if isAuthed();
    allow write: if isAdmin();
  }
}

// ── promptTemplates ───────────────────────────────────────
// Admin-only. Never exposed to non-admin clients.
match /promptTemplates/{toolId} {
  allow read:  if isAdmin();
  allow write: if isAdmin();
  match /versions/{versionId} {
    allow read, write: if isAdmin();
  }
}

// ── schoolLicences ────────────────────────────────────────
match /schoolLicences/{licenceId} {
  allow read:  if isAuthed() && (request.auth.uid in resource.data.memberUids || isAdmin());
  allow write: if isAdmin();
}
```
