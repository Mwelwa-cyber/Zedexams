/**
 * Reading heights off a rendered document.
 *
 * Two of these pin defects that a pure test could not have caught and a real
 * browser did — both found by comparing the measured count against the page
 * count Chromium actually printed for the same paper:
 *
 *   - adjacent vertical margins COLLAPSE, so summing each block's own margins
 *     over-counts every gap. On twelve ruled essay answers that came to a whole
 *     extra sheet.
 *   - `.pagebreak` is a zero-height element, so a filter that dropped
 *     zero-height blocks dropped every teacher-inserted page break with them.
 *
 * jsdom reports zero for every geometry, so the rects are stubbed. What is under
 * test is the ARITHMETIC over those rects — which block a height is attributed
 * to, and which blocks survive the filter — not the browser's layout.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { measureBlocks } from './paperPaginationMeasure'

/** A document whose elements report the geometry we give them. */
function docWith(blocks) {
  const container = { getBoundingClientRect: () => ({ bottom: blocks.containerBottom }) }
  const els = blocks.items.map((item) => ({
    id: item.id,
    className: item.className || 'question',
    classList: { contains: (c) => (item.classes || []).includes(c) },
    getAttribute: (name) => item.attrs?.[name] ?? null,
    getBoundingClientRect: () => ({ top: item.top, bottom: item.top + item.h, height: item.h, width: item.width ?? 400 }),
    closest: () => null,
    querySelector: () => null,
    scrollHeight: item.scrollHeight ?? item.h,
  }))
  return {
    querySelector: () => container,
    querySelectorAll: () => els,
    defaultView: {
      getComputedStyle: (el) => {
        const item = blocks.items.find((i) => i.id === el.id) || {}
        return {
          marginTop: `${item.marginTop ?? 0}px`,
          marginBottom: `${item.marginBottom ?? 0}px`,
          breakBefore: item.breakBefore ? 'page' : 'auto',
          pageBreakBefore: 'auto',
          breakAfter: item.breakAfter ? 'page' : 'auto',
          pageBreakAfter: 'auto',
          breakInside: 'auto',
          pageBreakInside: 'auto',
          overflow: item.overflow || 'visible',
        }
      },
    },
  }
}

describe('measureBlocks', () => {
  it('reads a block’s height as the distance to the next block', () => {
    // Two blocks 100 tall with a 20px gap between them: the first occupies 120
    // of the flow, not 100 — and not 140, which is what adding both margins to
    // the box would give.
    const doc = docWith({
      containerBottom: 220,
      items: [
        { id: 'a', top: 0, h: 100, marginBottom: 20 },
        { id: 'b', top: 120, h: 100, marginTop: 20 },
      ],
    })
    const [a, b] = measureBlocks(doc)
    expect(a.heightPx).toBe(120)
    expect(b.heightPx).toBe(100)
  })

  it('collapsed margins are counted once, not twice', () => {
    const doc = docWith({
      containerBottom: 220,
      items: [
        { id: 'a', top: 0, h: 100, marginBottom: 20 },
        { id: 'b', top: 120, h: 100, marginTop: 20 },
      ],
    })
    const total = measureBlocks(doc).reduce((sum, b) => sum + b.heightPx, 0)
    // 220, the container's real height. Summing box + both margins gives 260,
    // and 40px per pair over forty blocks is a page.
    expect(total).toBe(220)
  })

  it('the last block runs to the bottom of the container', () => {
    const doc = docWith({ containerBottom: 300, items: [{ id: 'only', top: 50, h: 100 }] })
    expect(measureBlocks(doc)[0].heightPx).toBe(250)
  })

  it('keeps a zero-height page break, and marks what it does', () => {
    const doc = docWith({
      containerBottom: 200,
      items: [
        { id: 'a', top: 0, h: 100 },
        { id: 'brk', top: 100, h: 0, classes: ['pagebreak'], className: 'pagebreak' },
        { id: 'b', top: 100, h: 100 },
      ],
    })
    const blocks = measureBlocks(doc)
    const brk = blocks.find((b) => b.id === 'brk')
    expect(brk, 'the break element must survive the zero-height filter').toBeTruthy()
    expect(brk.breakAfter).toBe(true)
    expect(brk.structural).toBe(true)
  })

  it('drops zero-height noise that is not a break', () => {
    const doc = docWith({
      containerBottom: 100,
      items: [{ id: 'a', top: 0, h: 100 }, { id: 'empty', top: 100, h: 0 }],
    })
    expect(measureBlocks(doc).map((b) => b.id)).toEqual(['a'])
  })

  it('a figure the renderer could not draw is marked as not rendered', () => {
    const doc = docWith({
      containerBottom: 100,
      items: [{ id: 'fig', top: 0, h: 0, classes: ['figure-missing'], className: 'q-diagram figure-missing' }],
    })
    const [fig] = measureBlocks(doc)
    expect(fig.rendered).toBe(false)
  })

  it('an empty or unrecognised document measures nothing rather than guessing', () => {
    expect(measureBlocks({ querySelector: () => null, querySelectorAll: () => [] })).toEqual([])
  })
})
