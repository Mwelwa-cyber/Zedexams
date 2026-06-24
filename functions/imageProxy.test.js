/**
 * Unit tests for the same-origin image proxy's URL gate (SSRF guard).
 *
 * resolveStorageTarget must accept ONLY https Storage URLs that point at one of
 * this project's buckets, and reject everything else (other hosts, other
 * buckets, non-https, metadata/internal targets). Run:
 *   node functions/imageProxy.test.js
 */

const assert = require("assert");
const {resolveStorageTarget} = require("./imageProxyCore");

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const BUCKET = process.env.GCLOUD_PROJECT || "examsprepzambia";

console.log("resolveStorageTarget — accepts our Storage URLs");
const fbUrl =
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}.firebasestorage.app` +
  "/o/assessment-images%2Fu1%2Fdiagrams%2F1.png?alt=media&token=abc";
check(resolveStorageTarget(fbUrl) === fbUrl, "firebase download URL (own bucket)");

const appspot =
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}.appspot.com` +
  "/o/x.png?alt=media&token=t";
check(resolveStorageTarget(appspot) === appspot, "legacy .appspot.com bucket");

const signed = `https://storage.googleapis.com/${BUCKET}.appspot.com/x.png?X-Goog-Signature=z`;
check(resolveStorageTarget(signed) === signed, "signed storage.googleapis.com URL");

console.log("\nresolveStorageTarget — rejects everything else");
check(resolveStorageTarget("") === null, "empty string");
check(resolveStorageTarget(null) === null, "null");
check(resolveStorageTarget("not a url") === null, "garbage string");
check(
  resolveStorageTarget("http://firebasestorage.googleapis.com/v0/b/" + BUCKET + ".appspot.com/o/x?alt=media") === null,
  "plain http (must be https)",
);
check(
  resolveStorageTarget("https://evil.example.com/x.png") === null,
  "unknown host",
);
check(
  resolveStorageTarget("https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/x?alt=media") === null,
  "another project's bucket",
);
check(
  resolveStorageTarget("https://storage.googleapis.com/evil-bucket/secret.png") === null,
  "arbitrary public GCS bucket",
);
check(
  resolveStorageTarget("https://169.254.169.254/latest/meta-data/") === null,
  "cloud metadata endpoint (SSRF)",
);
check(
  resolveStorageTarget("https://firebasestorage.googleapis.com/healthz") === null,
  "storage host but no /v0/b/<bucket>/o/ path",
);

assert.strictEqual(failures, 0, `${failures} image-proxy test(s) failed`);
console.log("\nAll image-proxy tests passed.");
