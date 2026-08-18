/**
 * BlocksPreview — the authoring preview of a study note.
 *
 * Renders a block list through `ReaderBlock`, the SAME component the
 * learner reader renders, so the studio cannot show an author something
 * different from what a learner gets. The editor used to preview through
 * the legacy `StudyNoteReader`, which has no case for the reader-engine
 * block types (`tapexplore`, `labeldiagram`, `startend`, `flow`,
 * `keypoints`, `glossary`, `practice`, `sectioncheck`) and rendered
 * nothing for them — so the Digestive System note's eight organ pictures
 * and its label-the-diagram figure were invisible in the studio while
 * being perfectly present in the note.
 *
 * Two deliberate differences from the learner reader:
 *
 *   • NO mode filtering. Learn hides the key points and Revise hides the
 *     quiz and the label game (readerCore.blockPlacement) — correct for a
 *     learner, wrong for an author, who needs to see everything they
 *     wrote. This previews the CONTENT; the two doorways decide placement
 *     at read time.
 *
 *   • No word sheet. `[[keyword]]` marks still render as chips (that is
 *     how they look on the page) but tapping one does nothing here rather
 *     than opening a second copy of ReaderEngine's WordSheet.
 *
 * Section numbers are assigned over level-2 headings in authored order —
 * the same rule planNoteView uses, so a heading previews as the number it
 * will carry.
 */
import '../../../shared/styles/learnerTheme.css'
import './reader.css'
import ReaderBlock from './ReaderBlock'

export default function BlocksPreview({ blocks = [] }) {
  const list = Array.isArray(blocks) ? blocks : []
  let section = 0

  return (
    <div className="lhx">
      <div className="lhx-page" style={{ padding: 0 }}>
        {list.map((block, i) => {
          if (!block) return null
          const isSection = block.type === 'heading' && (block.level ?? 2) === 2
          if (isSection) section += 1
          return (
            <ReaderBlock
              key={block.id || i}
              block={block}
              sectionNumber={isSection ? section : null}
              revealed
            />
          )
        })}
      </div>
    </div>
  )
}
