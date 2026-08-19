/**
 * NOT a behaviour test — a MARKUP DUMP for the layout harness.
 *
 * jsdom has no layout engine, so no Vitest spec can answer FIX 12's
 * questions ("does the page scroll sideways at 390px", "is the greeting
 * above the fold", "is the note behind the bottom nav"). Those need a
 * real browser. What a real browser cannot easily do is render `/family`,
 * because that route needs an authenticated parent session.
 *
 * So this splits the problem: Vitest renders the REAL components with the
 * real class names and writes the HTML out; `scripts/test-parent-layout.mjs`
 * loads that HTML into headless Chromium with the REAL built stylesheets
 * and measures it. The alternative — hand-transcribing the DOM into the
 * harness — measures a copy that drifts from the components the moment
 * anybody edits them.
 *
 * It writes to a gitignored scratch path and is skipped unless
 * PARENT_LAYOUT_DUMP is set, so it costs the ordinary Vitest run nothing.
 */
import { describe, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 2 }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'parent-1' },
    userProfile: { displayName: 'Paco Mwansa', role: 'parent' },
  }),
}))
vi.mock('../services/parentApp', () => ({
  listGuardianApprovals: () => Promise.resolve([]),
  declineGuardianApproval: vi.fn(),
  listGuardianChildren: () => Promise.resolve([]),
}))
vi.mock('../services/familyPortal', () => ({
  listMyChildren: () => Promise.resolve([]),
  redeemFamilyInviteCode: vi.fn(),
}))

// One linked child on the free plan, so the plan strip renders — it is
// part of the chrome the harness has to measure.
vi.mock('../hooks/useGuardianChildren', () => ({
  default: () => ({
    loading: false,
    error: null,
    reload: () => {},
    children: [{
      childUid: 'kid-1',
      displayName: 'Chanda Mwansa',
      grade: '7',
      status: 'on_track',
      lastActiveAt: Date.now(),
      guardianCount: 1,
      premium: false,
    }],
  }),
  GuardianChildrenProvider: ({ children }) => children,
}))

import ParentBottomNav from '../components/ParentBottomNav'
import FamilyPlanBanner from '../components/FamilyPlanBanner'
import ParentHome from '../pages/ParentHome'
import ParentChildren from '../pages/ParentChildren'

const OUT = process.env.PARENT_LAYOUT_DUMP

const PAGES = {
  home: ParentHome,
  children: ParentChildren,
}

describe.runIf(OUT)('parent layout markup dump', () => {
  for (const [name, Page] of Object.entries(PAGES)) {
    it(`writes ${name}`, () => {
      // The same tree ParentShell renders: `.lhx .pax` → `.lhx-page` →
      // the plan strip and the page, with the nav as a sibling.
      const { container } = render(
        <MemoryRouter>
          <div className="lhx pax">
            <div className="lhx-page">
              <FamilyPlanBanner />
              <Page />
            </div>
            <ParentBottomNav />
          </div>
        </MemoryRouter>,
      )
      const file = `${OUT}/${name}.html`
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, container.innerHTML, 'utf8')
    })
  }
})
