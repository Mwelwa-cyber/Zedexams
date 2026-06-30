import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichContent from './RichContent'

/**
 * Regression guard for the exam-runner React error #31 crash.
 *
 * Daily-exam options can be plain strings OR Tiptap rich-text docs
 * ({ type: 'doc', content: [...] }). The exam runner used to render the
 * option object directly as a JSX child, which throws "Objects are not valid
 * as a React child (object with keys {type, content})" and white-screened the
 * exam. Routing the option through RichContent fixes it — these tests pin the
 * behaviour RichContent must keep: a doc renders its text, a string renders
 * unchanged, and neither throws.
 */
describe('RichContent — renders option shapes safely (exam React #31 guard)', () => {
  it('renders a Tiptap doc as text, not as an object child', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }],
    }
    const { container } = render(<RichContent value={doc} />)
    expect(container.textContent).toContain('42')
  })

  it('renders a plain string option unchanged', () => {
    const { container } = render(<RichContent value="Lusaka" />)
    expect(container.textContent).toContain('Lusaka')
  })

  it('returns the fallback for an empty value', () => {
    const { container } = render(<RichContent value="" fallback={<span>—</span>} />)
    expect(container.textContent).toContain('—')
  })
})
