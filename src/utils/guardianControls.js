/**
 * Re-export only. The rules live in the shared consent package.
 *
 * @see functions/shared/consent/guardianControlsCore.js
 *
 * Same contract as src/utils/guardianConsent.js, and the same warning:
 * DO NOT ADD A RULE HERE. What this package decides is what a guardian has
 * taken away from a child's account — a rule that lives only in the browser is
 * a rule the child's own device is free to disagree with, which is the exact
 * failure the Guardian Zone exists to avoid.
 */
export {
  GUARDIAN_CONTROL,
  DAILY_LIMIT_OPTIONS,
  PIN_MAX_ATTEMPTS,
  PIN_LOCKOUT_MS,
  SETUP_CODE_TTL_MS,
  normalizeGuardianControls,
  hasGuardianRestrictions,
  narrowCapabilities,
  isWellFormedGuardianPin,
  isWellFormedSetupCode,
  guardianPinAttemptState,
  guardianPinFailure,
  guardianPinSuccess,
  setupCodeState,
} from '../../functions/shared/consent/guardianControlsCore.js'
