/**
 * Re-export only. The rules live in the shared consent package.
 *
 * @see functions/shared/consent/guardianConsentCore.js
 *
 * This file exists so call sites in src/ keep a short import path, and so the
 * boundary is visible at the point of crossing rather than buried in a
 * relative path with four dot-dots in it. DO NOT ADD A RULE HERE. Anything
 * defined in this file is a rule the SERVER does not enforce — and what this
 * package decides is whether a child's account may reach an AI, so a rule that
 * lives only in the browser is not a rule at all.
 */
export {
  CAPABILITY,
  CONSENT_STATUS,
  GUARDIAN_CONSENT_AGE,
  FULL_CAPABILITY_SET,
  LIMITED_CAPABILITY_SET,
  ageInYears,
  canLearnerUse,
  consentTokenState,
  requiresGuardianConsent,
  resolveLearnerAccess,
} from '../../functions/shared/consent/guardianConsentCore.js'
