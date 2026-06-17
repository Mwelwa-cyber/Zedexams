import { describe, expect, it } from 'vitest'
import { renderChatMarkdown } from './chatMarkdown'

describe('renderChatMarkdown', () => {
  it('renders **bold** as <strong> instead of literal asterisks', () => {
    const html = renderChatMarkdown('**Definition:** Photosynthesis is how plants make food.')
    expect(html).toContain('<strong>Definition:</strong>')
    expect(html).not.toContain('**')
  })

  it('renders *italic* as <em>', () => {
    const html = renderChatMarkdown('This is *important* to know.')
    expect(html).toContain('<em>important</em>')
  })

  it('renders bullet lists', () => {
    const html = renderChatMarkdown('- one\n- two\n- three')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>three</li>')
  })

  it('renders numbered lists', () => {
    const html = renderChatMarkdown('1. first\n2. second')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>first</li>')
  })

  it('returns empty string for blank input', () => {
    expect(renderChatMarkdown('')).toBe('')
    expect(renderChatMarkdown('   ')).toBe('')
    expect(renderChatMarkdown(null)).toBe('')
    expect(renderChatMarkdown(undefined)).toBe('')
  })

  it('strips dangerous tags (no script execution)', () => {
    const html = renderChatMarkdown('Hi <script>alert(1)</script> there')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('strips event-handler attributes and javascript: links', () => {
    const html = renderChatMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('forces external links to open safely in a new tab', () => {
    const html = renderChatMarkdown('See [ZedExams](https://zedexams.com).')
    expect(html).toContain('href="https://zedexams.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('keeps single newlines as line breaks (chat-style)', () => {
    const html = renderChatMarkdown('line one\nline two')
    expect(html).toContain('<br>')
  })
})
