import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import ExtraQuestionImages, { getExtraQuestionImages } from './ExtraQuestionImages'

// ZoomableImage pulls in a lightbox; stub it to a plain img so we can assert.
import { vi } from 'vitest'
vi.mock('./ZoomableImage', () => ({
  default: ({ src, alt }) => <img src={src} alt={alt} />,
}))

describe('getExtraQuestionImages', () => {
  it('returns [] for a question with no images', () => {
    expect(getExtraQuestionImages({})).toEqual([])
    expect(getExtraQuestionImages({ images: null })).toEqual([])
  })

  it('normalizes and drops empty/invalid entries', () => {
    const out = getExtraQuestionImages({
      images: [
        { url: 'https://x/a.png', alt: 'A', width: 'medium' },
        { url: '' },
        null,
        { alt: 'no url' },
        { url: 'https://x/b.png' },
      ],
    })
    expect(out).toEqual([
      { url: 'https://x/a.png', alt: 'A', width: 'medium' },
      { url: 'https://x/b.png', alt: '', width: 'full' },
    ])
  })
})

describe('ExtraQuestionImages', () => {
  it('renders nothing when there are no extras', () => {
    const { container } = render(<ExtraQuestionImages question={{ imageUrl: 'https://x/main.png' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one image per extra, stacked', () => {
    render(
      <ExtraQuestionImages
        question={{ images: [{ url: 'https://x/a.png', alt: 'Fig A' }, { url: 'https://x/b.png', alt: 'Fig B' }] }}
      />,
    )
    expect(screen.getByAltText('Fig A')).toHaveAttribute('src', 'https://x/a.png')
    expect(screen.getByAltText('Fig B')).toHaveAttribute('src', 'https://x/b.png')
  })
})
