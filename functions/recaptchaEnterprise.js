/**
 * Server-side reCAPTCHA Enterprise assessment I/O.
 *
 * The device SDK (native Android) mints an action token; this module trades it
 * with Google's reCAPTCHA Enterprise Assessment API for a risk score. It MUST
 * run server-side: a compromised client could otherwise fabricate a passing
 * result.
 *
 * Auth: Application Default Credentials. On Cloud Functions the runtime service
 * account is used automatically — no API key, no secret. That SA needs the
 * "reCAPTCHA Enterprise Agent" role (roles/recaptchaenterprise.agent) on the
 * project, and the reCAPTCHA Enterprise API must be enabled. See
 * docs/RECAPTCHA-ENTERPRISE-SETUP.md. We call the REST endpoint via
 * google-auth-library (already a functions dependency) rather than pulling in
 * @google-cloud/recaptcha-enterprise (gRPC + protobuf) for one call.
 *
 * Pure request/response logic lives in recaptchaAssessmentCore.js so it can be
 * unit-tested without this network dependency.
 */

const {GoogleAuth} = require("google-auth-library");
const {assessmentUrl, buildAssessmentRequest} = require("./recaptchaAssessmentCore");

// One GoogleAuth instance for the module — it caches and refreshes access
// tokens internally, so re-creating it per call would just re-do discovery.
let authClient = null;
function getAuth() {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
  }
  return authClient;
}

/**
 * Create a reCAPTCHA Enterprise assessment for a device-minted token.
 * Resolves to the raw assessment object ({riskAnalysis, tokenProperties, …});
 * rejects on auth / network / API errors so the caller can fail open.
 *
 * @param {{token: string, action?: string, siteKey: string, projectId: string}} args
 * @returns {Promise<object>} raw createAssessment response body
 */
async function createAssessment({token, action, siteKey, projectId}) {
  const client = await getAuth().getClient();
  const res = await client.request({
    url: assessmentUrl(projectId),
    method: "POST",
    data: buildAssessmentRequest({token, action, siteKey}),
    // Don't let a slow assessment hang the sign-in path — the callable's own
    // timeout is the backstop, but bound the outbound call too.
    timeout: 10000,
  });
  return res.data;
}

module.exports = {createAssessment};
