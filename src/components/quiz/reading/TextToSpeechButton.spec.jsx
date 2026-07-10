import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TextToSpeechButton from './TextToSpeechButton'

function makeTts(overrides = {}) {
  return {
    enabled: true,
    supported: true,
    activeId: null,
    speaking: false,
    paused: false,
    play: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(() => false),
    ...overrides,
  }
}

describe('TextToSpeechButton', () => {
  it('renders nothing when read-aloud is disabled', () => {
    const tts = makeTts({ enabled: false })
    const { container } = render(<TextToSpeechButton id="q1" getText={() => 'hi'} tts={tts} label="question" />)
    expect(container.firstChild).toBeNull()
  })

  it('idle: shows a "Read … aloud" button that toggles playback', () => {
    const tts = makeTts()
    render(<TextToSpeechButton id="q1" getText={() => 'the question'} tts={tts} label="question" />)
    const btn = screen.getByRole('button', { name: 'Read question aloud' })
    fireEvent.click(btn)
    expect(tts.toggle).toHaveBeenCalledWith('q1', expect.any(Function))
  })

  it('playing: shows pause + stop controls', () => {
    const tts = makeTts({ isActive: () => true, speaking: true, paused: false })
    render(<TextToSpeechButton id="q1" getText={() => 'x'} tts={tts} label="question" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause reading' }))
    expect(tts.pause).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }))
    expect(tts.stop).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Resume reading' })).toBeNull()
  })

  it('paused: shows resume + stop controls', () => {
    const tts = makeTts({ isActive: () => true, speaking: true, paused: true })
    render(<TextToSpeechButton id="q1" getText={() => 'x'} tts={tts} label="question" />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume reading' }))
    expect(tts.resume).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Pause reading' })).toBeNull()
  })
})
