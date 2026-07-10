import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PassageViewer from './PassageViewer'

const passage = {
  title: 'The River',
  passageKind: 'comprehension',
  passageText: 'The boy walked slowly towards the river.',
  instructions: 'Read the passage and answer the questions.',
}

// Read-aloud disabled → the TTS button renders nothing, keeping this spec
// focused on the passage-mode behaviour.
const ttsOff = { enabled: false, isActive: () => false }

describe('PassageViewer', () => {
  it('renders title, kind label, and question count', () => {
    render(<PassageViewer passage={passage} questionCount={4} tts={ttsOff} />)
    expect(screen.getByText('The River')).toBeInTheDocument()
    expect(screen.getByText('Comprehension Passage')).toBeInTheDocument()
    expect(screen.getByText('4 questions')).toBeInTheDocument()
    expect(screen.getByText(/The boy walked slowly/)).toBeInTheDocument()
  })

  it('map passages get the Map Questions label', () => {
    render(<PassageViewer passage={{ ...passage, passageKind: 'map' }} questionCount={1} tts={ttsOff} />)
    expect(screen.getByText('Map Questions')).toBeInTheDocument()
    expect(screen.getByText('1 question')).toBeInTheDocument()
  })

  it('collapses and re-shows the passage body when keepOpen is off', () => {
    render(<PassageViewer passage={passage} questionCount={2} tts={ttsOff} keepOpen={false} />)
    expect(screen.getByText(/The boy walked slowly/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide passage' }))
    expect(screen.queryByText(/The boy walked slowly/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show passage' }))
    expect(screen.getByText(/The boy walked slowly/)).toBeInTheDocument()
  })

  it('keepOpen hides the collapse control and always shows the passage', () => {
    render(<PassageViewer passage={passage} questionCount={2} tts={ttsOff} keepOpen />)
    expect(screen.queryByRole('button', { name: /passage$/i })).toBeNull()
    expect(screen.getByText(/The boy walked slowly/)).toBeInTheDocument()
  })

  it('shows line numbers via the body data attribute when enabled', () => {
    const { container } = render(<PassageViewer passage={passage} questionCount={2} tts={ttsOff} showLineNumbers />)
    expect(container.querySelector('.passage-body[data-line-numbers="true"]')).toBeTruthy()
  })

  it('has A− / A+ passage text-size controls', () => {
    render(<PassageViewer passage={passage} questionCount={2} tts={ttsOff} />)
    expect(screen.getByRole('button', { name: 'Smaller passage text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Larger passage text' })).toBeInTheDocument()
  })
})
