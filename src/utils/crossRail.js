/**
 * Re-export only. The rules live in the shared billing package.
 *
 * @see functions/shared/billing/crossRailCore.js
 *
 * This file exists so call sites in src/ keep a short import path, and so
 * the boundary is visible at the point of crossing rather than buried in a
 * relative path with four dot-dots in it. DO NOT ADD A RULE HERE. Anything
 * defined in this file is a rule the SERVER does not enforce — and what
 * this package decides is whether a parent is offered a second checkout
 * while they are already paying somewhere else, which is exactly the rule
 * a modified client would ignore and exactly the one whose failure charges
 * a family twice a month.
 */
export {
  RAIL,
  RAIL_LABEL,
  railOfProvider,
  activeRailFor,
  decideCrossRail,
  crossRailMessage,
} from '../../functions/shared/billing/crossRailCore.js'
