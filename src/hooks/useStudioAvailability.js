/**
 * The ONE binding between `src/config/studioAvailability.js` and React.
 *
 * It supplies the decision's single input — the live `settings/global`
 * feature flags — and contains no condition of its own, deliberately: the
 * moment a component starts deciding for itself which studios exist, there
 * are two answers and the flag can no longer be trusted to hide the studio
 * everywhere. Same split as `useAssessmentEngineFlag` over
 * `engines/assessment-engine/flags.js`.
 *
 *     const { isAvailable, isRouteAvailable, filterEntries } = useStudioAvailability()
 *     const tiles = filterEntries(QUICK_CREATE_TILES)     // keyed on `to`
 *     const studios = filterEntries(TEACHER_STUDIOS, 'route')
 *
 * `live === false` means the settings subscription died and these flags are
 * the last thing we HEARD, not the current value — Firestore never resumes a
 * listener after `onError`. A client in that state would hold a withdrawn
 * studio open until it reloaded, so the admin toggle could not reach it. The
 * flags are therefore withheld and the pure resolver reaches its own
 * fail-closed answer, exactly as it does before the first snapshot arrives.
 */
import { useMemo } from 'react'
import { usePlatformSettings } from '../contexts/PlatformSettingsContext'
import {
  filterAvailableEntries,
  isRouteAvailable as isRouteAvailableFor,
  isToolAvailable as isToolAvailableFor,
  retiredLabelForTool as retiredLabelFor,
} from '../config/studioAvailability'

export function useStudioAvailability() {
  const { settings, live } = usePlatformSettings()
  const featureFlags = live === false ? undefined : settings?.featureFlags

  return useMemo(() => ({
    featureFlags,
    isAvailable: (tool) => isToolAvailableFor(tool, featureFlags),
    isRouteAvailable: (to) => isRouteAvailableFor(to, featureFlags),
    filterEntries: (items, key = 'to') => filterAvailableEntries(items, featureFlags, key),
    retiredLabel: (tool) => retiredLabelFor(tool, featureFlags),
  }), [featureFlags])
}

export default useStudioAvailability
