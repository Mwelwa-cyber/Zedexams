/**
 * The family plan strip — the one that replaced the app-level
 * "You're on the free plan — upgrade to unlock Pro" bar on /family/*.
 *
 * Three properties are pinned here because each was a reported bug:
 *
 *   • It never says "Pro". Pro and Max are the TEACHER tiers; a guardian
 *     buys the learner plan, which covers the child. The old strip both
 *     named the wrong product and pointed at a checkout that does not
 *     apply to a guardian.
 *   • It describes the CHILD's plan, not the guardian's. The old strip
 *     read `useSubscriptionReminder`, which resolves the signed-in
 *     account — so a parent who had paid for both their children still
 *     read "You're on the free plan", because they personally were.
 *   • It keeps its action at phone widths. The old copy truncated before
 *     the "Upgrade →" link, leaving a banner whose only remaining
 *     control was the dismiss ✕.
 *
 * Whether the two sentences swap at the right WIDTH is a CSS question and
 * lives in `npm run layout:parent`, which measures in a real browser —
 * jsdom has no layout engine and would report both as visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockChildren
vi.mock('../hooks/useGuardianChildren', () => ({ default: () => mockChildren }))

import FamilyPlanBanner from './FamilyPlanBanner'

const free = { childUid: 'a', displayName: 'Chanda Mwansa', premium: false }
const paid = { childUid: 'b', displayName: 'Bupe Mwansa', premium: true }

function renderBanner(state) {
  mockChildren = { loading: false, error: null, reload: () => {}, ...state }
  return render(<MemoryRouter><FamilyPlanBanner /></MemoryRouter>)
}

beforeEach(() => { sessionStorage.clear() })

describe('FamilyPlanBanner', () => {
  it('names the child and points at the parent checkout', () => {
    renderBanner({ children: [free] })
    expect(screen.getByText(/Chanda is on the free plan/)).toBeInTheDocument()
    // /family/plan, never /pricing (teacher tiers) or /my-subscription
    // (written for the account that HOLDS the plan, which a guardian
    // never is — the money credits the child).
    expect(document.querySelector('a').getAttribute('href')).toBe('/family/plan')
  })

  it('never says Pro, and never prices the teacher tiers', () => {
    renderBanner({ children: [free] })
    expect(document.body.textContent).not.toMatch(/\bPro\b/)
    expect(document.body.textContent).not.toMatch(/\bMax\b/)
    expect(document.body.textContent).not.toMatch(/K\d/)
  })

  it('keeps a visible action alongside the message', () => {
    renderBanner({ children: [free] })
    // The action is a separate element from the sentence, which is what
    // stops a narrow screen eating it: the sentence is allowed to run out
    // of room, the CTA is not.
    expect(screen.getByText(/See plans/)).toBeInTheDocument()
  })

  it('says nothing when every child is already covered', () => {
    const { container } = renderBanner({ children: [paid] })
    expect(container).toBeEmptyDOMElement()
  })

  it('says nothing before the children are known, or when the read failed', () => {
    expect(renderBanner({ loading: true, children: [] }).container).toBeEmptyDOMElement()
    expect(renderBanner({ error: 'nope', children: [] }).container).toBeEmptyDOMElement()
  })

  it('says nothing when there is nobody to unlock anything for', () => {
    // The empty state already asks for the one thing that matters first;
    // an upgrade offer on top of it sells before it explains.
    const { container } = renderBanner({ children: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('stays dismissed for the session', () => {
    renderBanner({ children: [free] })
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(/free plan/i)).toBeNull()

    const { container } = renderBanner({ children: [free] })
    expect(container).toBeEmptyDOMElement()
  })
})
