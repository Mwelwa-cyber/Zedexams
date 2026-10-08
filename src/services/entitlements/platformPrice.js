/**
 * platformPrice — `mayShowPrice` with the platform filled in.
 *
 * `planState.mayShowPrice` is pure and takes `native` explicitly, defaulting to
 * the withholding answer. Components cannot reasonably each remember to pass
 * it, and the one that forgot would be showing a price to a minor in the
 * Android build, so they call this instead: it reads the real platform once,
 * here.
 *
 * Kept out of `planState.js` because that module is exercised under plain
 * `node` (`test:entitlements`) and `utils/runtime` reaches Capacitor.
 */

import { isNativePlatform } from '../../utils/runtime'
import { mayShowPrice } from './planState'

export function platformMayShowPrice(profile) {
  return mayShowPrice(profile, { native: isNativePlatform() })
}

export default platformMayShowPrice
