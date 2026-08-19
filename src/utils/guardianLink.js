/**
 * Re-export only. The rules live in the shared guardian package.
 *
 * @see functions/shared/guardian/guardianLinkCore.js
 *
 * This file exists so call sites in src/ keep a short import path, and so
 * the boundary is visible at the point of crossing rather than buried in a
 * relative path with four dot-dots in it. DO NOT ADD A RULE HERE. Anything
 * defined in this file is a rule the SERVER does not enforce — and what
 * this package decides is whether a child's account is in limited mode and
 * whether one guardian may loosen another's restriction, so a rule that
 * lives only in the browser is exactly the one a modified client would
 * ignore.
 *
 * `test:shim-guard` fails if this file grows a function body, a branch, or
 * a constant with a rule in it.
 */
export {
  BOOLEAN_PERMISSION_KEYS,
  GUARDIAN_CONTROL_COPY,
  GUARDIAN_VISIBILITY,
  LINK_CONSENT,
  LINK_METHOD,
  LINK_PERMISSION_KEYS,
  LINK_STATUS,
  NO_PERMISSIONS,
  describeConsentState,
  describeLinkMethod,
  guardianEmailKey,
  isLinkConsentState,
  isLinkMethod,
  isPermitted,
  linkId,
  linkIsApproved,
  linkStatusIsActive,
  normalizeLink,
  readLinkPermissions,
  readLinkState,
  resolveLinkConsent,
  resolveLinkPermissions,
} from '../../functions/shared/guardian/guardianLinkCore.js'
