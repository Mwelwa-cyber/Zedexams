import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BottomSheet from './BottomSheet'

/**
 * A minimal harness mirroring how the dashboard uses the sheet: an opener
 * button captures focus, and the sheet's onClose is an inline callback (new
 * identity every render). A counter button inside the sheet forces the parent
 * to rerender WHILE the sheet stays open — the exact situation that regressed
 * focus restoration ("Next recommendation" / "View all").
 */
function Harness() {
  const [open, setOpen] = useState(false)
  const [n, setN] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open sheet</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Sheet">
        <button type="button" onClick={() => setN((v) => v + 1)}>Bump {n}</button>
      </BottomSheet>
    </>
  )
}

describe('BottomSheet', () => {
  it('keeps focus inside the sheet across in-sheet rerenders, then restores the opener on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Open sheet' })
    opener.focus()
    await user.click(opener)

    const bump = screen.getByRole('button', { name: /Bump/ })

    // Rerender the sheet WITHOUT closing it (the "Next recommendation" /
    // "View all" case, which changes the inline onClose identity). Regression
    // guard: the old effect keyed on `onClose` re-ran on every such rerender,
    // and its setup re-stole focus to the sheet's own close button (and its
    // cleanup transiently yanked focus back to the opener). Focus must simply
    // stay on the control the user just activated.
    await user.click(bump)
    expect(bump).toHaveFocus()
    expect(opener).not.toHaveFocus()
    await user.click(bump)
    expect(bump).toHaveFocus()

    // Closing still returns focus to the element that opened the sheet.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Sheet' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('locks body scroll while open and releases it on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(document.body.style.overflow).toBe('')
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })
})
