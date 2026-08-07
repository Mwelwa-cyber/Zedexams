// The grip that replaced the ↑ / ↓ pair on every builder block.
//
// Two up/down buttons per block is four taps to move a question past three
// others, and it was two of the eight controls crowding the question card's
// header. A grip does the whole move in one gesture — and, because a grip that
// only works with a mouse is a control a keyboard user has just lost, the same
// handle moves the block with the arrow keys while focused.
//
// The drop target is the block, not a gap between blocks: `useBlockDropTarget`
// returns the props a block spreads onto itself. A block never accepts its own
// drag, and the payload rides on a custom MIME type so a URL or a dragged image
// cannot be mistaken for a block.

import { useState } from 'react'

export const BLOCK_DRAG_TYPE = 'application/x-zedexams-block'

/**
 * The grip itself.
 *
 * @param {number}   index    this block's position in `sections`
 * @param {string}   label    what is being moved, for the accessible name
 * @param {function} onMove   (index, delta) — the ↑/↓ primitive, for the keys
 */
export function BlockDragHandle({ index, label = 'block', onMove, disabled = false }) {
  return (
    <button
      type="button"
      className="sv-drag-handle"
      draggable={!disabled}
      disabled={disabled}
      aria-label={`Reorder ${label}. Drag, or press the up and down arrow keys.`}
      title="Drag to reorder — or focus this and use ↑ / ↓"
      onDragStart={(event) => {
        event.dataTransfer.setData(BLOCK_DRAG_TYPE, String(index))
        // Some browsers refuse a drag with no text/plain payload.
        event.dataTransfer.setData('text/plain', label)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); onMove?.(index, -1) }
        if (event.key === 'ArrowDown') { event.preventDefault(); onMove?.(index, 1) }
      }}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  )
}

/**
 * Props a block spreads onto itself to become a drop target, plus `isOver` for
 * the drop-line styling.
 *
 * `onReorder` is optional: a caller that has not wired reordering gets inert
 * props rather than a block that highlights and then does nothing.
 */
export function useBlockDropTarget({ index, onReorder }) {
  const [isOver, setIsOver] = useState(false)
  if (!onReorder) return { isOver: false, dropProps: {} }
  const carriesBlock = (event) => Array.from(event.dataTransfer?.types || []).includes(BLOCK_DRAG_TYPE)
  return {
    isOver,
    dropProps: {
      onDragOver: (event) => {
        if (!carriesBlock(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setIsOver(true)
      },
      onDragLeave: () => setIsOver(false),
      onDrop: (event) => {
        setIsOver(false)
        if (!carriesBlock(event)) return
        event.preventDefault()
        const from = Number(event.dataTransfer.getData(BLOCK_DRAG_TYPE))
        if (Number.isInteger(from) && from !== index) onReorder(from, index)
      },
    },
  }
}
