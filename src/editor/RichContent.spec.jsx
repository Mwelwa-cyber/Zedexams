import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

/**
 * Formatting-fidelity guard for the "everything looks bold" fix. Intentionally
 * marked words in the exam paper must render as real semantic tags (bold as
 * <strong>, and <u>/<mark>/<sup>/<sub>) while surrounding text is plain — so a
 * "what does the underlined/highlighted word mean?" question is answerable.
 */
describe('RichContent — preserves intentional marks (readability fix)', () => {
  it('renders a bold word as <strong>, leaving surrounding text unmarked', async () => {
    const html = '<p>The boy was <strong>exhausted</strong> after the race.</p>'
    const { container } = render(<RichContent value={html} />)
    await waitFor(() => expect(container.querySelector('strong')).toBeTruthy())
    expect(container.querySelector('strong').textContent).toBe('exhausted')
    // The rest of the sentence must NOT be wrapped in <strong>.
    expect(container.textContent).toContain('The boy was')
    expect(container.textContent).toContain('after the race.')
  })

  it('renders an underlined word as <u>', async () => {
    const { container } = render(<RichContent value="<p>the <u>capital</u> of Zambia</p>" />)
    await waitFor(() => expect(container.querySelector('u')).toBeTruthy())
    expect(container.querySelector('u').textContent).toBe('capital')
  })

  it('renders a highlighted word as <mark>', async () => {
    const { container } = render(<RichContent value="<p>Choose the <mark>highlighted</mark> word.</p>" />)
    await waitFor(() => expect(container.querySelector('mark')).toBeTruthy())
    expect(container.querySelector('mark').textContent).toBe('highlighted')
  })

  it('renders superscript and subscript', async () => {
    const { container } = render(<RichContent value="<p>H<sub>2</sub>O and x<sup>2</sup></p>" />)
    await waitFor(() => expect(container.querySelector('sub')).toBeTruthy())
    expect(container.querySelector('sub').textContent).toBe('2')
    expect(container.querySelector('sup').textContent).toBe('2')
  })

  it('strips a <script> tag from stored HTML (defence-in-depth)', async () => {
    const { container } = render(
      <RichContent value="<p>safe <strong>word</strong></p><script>window.__x=1</script>" />
    )
    await waitFor(() => expect(container.querySelector('strong')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('window.__x')
  })
})
