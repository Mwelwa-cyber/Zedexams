/**
 * Re-export only. The rules live in the shared guardian package.
 *
 * @see functions/shared/guardian/guardianControlsCore.js
 *
 * This file exists so call sites in src/ keep a short import path, and so
 * the boundary is visible at the point of crossing rather than buried in a
 * relative path with four dot-dots in it. DO NOT ADD A RULE HERE. Anything
 * defined in this file is a rule the SERVER does not enforce — and what
 * this package decides is whether a guardian's restriction holds, so a
 * rule that lives only in the browser is exactly the restriction a
 * modified client would ignore.
 */
export {
  GUARDIAN_CONTROLS,
  GUARDIAN_CONTROL_KEYS,
  isGuardianControl,
  readGuardianControls,
  isAllowed,
  describeControlChange,
} from '../../functions/shared/guardian/guardianControlsCore.js'
