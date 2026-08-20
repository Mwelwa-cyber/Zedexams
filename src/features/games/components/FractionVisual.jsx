/**
 * FractionVisual — the one component that draws a fraction as a picture.
 *
 * Every fraction diagram in the ladder comes through here, and the partition
 * it draws comes from `fractionVisualCore`, which refuses a picture that
 * disagrees with its fraction. That split is the point: a wrong picture is
 * invisible — a circle in five wedges labelled "three quarters" renders
 * perfectly — so the check has to be somewhere a test can reach, and the
 * drawing has to have nothing left to decide.
 *
 * THE ARTWORK AND THE MATHS ARE SEPARATE LAYERS. An orange is a colour, a
 * stalk and a leaf; the four equal wedges over it are computed. Nothing here
 * asks anyone — illustrator or model — to draw geometrically perfect thirds,
 * which is the one thing neither can be trusted with. Change the object and
 * the maths is untouched; change the fraction and the object is untouched.
 *
 * INTERACTIVE REGIONS ARE BUTTONS. Shading a bar and picking a fraction of a
 * basket are the two places a learner acts on the picture, and both are real
 * `<button>`s inside a group with a name — so a keyboard reaches them, a
 * screen reader says "piece 3 of 4, shaded", and the touch target is the whole
 * region rather than a hairline of SVG.
 *
 * Everything scales from a viewBox, so the same component is a thumbnail in an
 * option row and a full-width diagram on a phone.
 */
import { fracWords } from '../../../shared/utils/fractionMath.js'
import {
  barSegments,
  buildVisual,
  groupBox,
  groupItems,
  objectNoun,
  pieWedges,
} from '../lib/fractionVisualCore.js'

const PIE_SIZE = 148
const BAR_WIDTH = 260
const BAR_HEIGHT = 66
const STRIP_HEIGHT = 46

/** The stalk and leaf that make a circle read as an orange rather than a chart. */
function Stalk({ cx, cy, r, edge }) {
  return (
    <g aria-hidden="true">
      <rect x={cx - 2} y={cy - r - 12} width="4" height="12" rx="2" fill="#5c7a35" />
      <path d={`M${cx + 1},${cy - r - 8} q11,-7 15,2 q-11,6 -15,-2 z`} fill="#6f9a41" />
      <circle cx={cx} cy={cy - r - 12} r="1.6" fill={edge} />
    </g>
  )
}

function Pie({ built, interactive, chosen, onToggle, labelFor }) {
  const wedges = pieWedges({ parts: built.parts, size: PIE_SIZE, shares: built.shares })
  const r = PIE_SIZE / 2 - 11
  const cx = PIE_SIZE / 2
  const cy = PIE_SIZE / 2 + 5
  const { ink, pale, edge, top } = built.object
  return (
    <svg
      className="lhx-fv-svg"
      viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
      width={PIE_SIZE}
      height={PIE_SIZE}
      role={interactive ? 'group' : 'img'}
      aria-label={interactive ? undefined : labelFor()}
    >
      <circle cx={cx} cy={cy} r={r + 3} fill={edge} opacity=".26" aria-hidden="true" />
      {wedges.map((wedge) => {
        const on = chosen.has(wedge.index)
        const fill = on ? ink : pale
        if (!interactive) {
          return <path key={wedge.index} d={wedge.path} fill={fill} stroke="#fff" strokeWidth="3" aria-hidden="true" />
        }
        return (
          <path
            key={wedge.index}
            d={wedge.path}
            fill={fill}
            stroke="#fff"
            strokeWidth="3"
            className="lhx-fv-hit"
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`Piece ${wedge.index + 1} of ${built.parts}`}
            onClick={() => onToggle(wedge.index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(wedge.index) }
            }}
          />
        )
      })}
      {top === 'stalk' && <Stalk cx={cx} cy={cy} r={r} edge={edge} />}
    </svg>
  )
}

function Bar({ built, tall, interactive, chosen, onToggle, labelFor }) {
  const height = tall ? BAR_HEIGHT : STRIP_HEIGHT
  const segments = barSegments({ parts: built.parts, width: BAR_WIDTH, height, shares: built.shares })
  const { ink, pale, edge } = built.object
  return (
    <svg
      className="lhx-fv-svg"
      viewBox={`0 0 ${BAR_WIDTH} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role={interactive ? 'group' : 'img'}
      aria-label={interactive ? undefined : labelFor()}
    >
      <rect x="0" y="0" width={BAR_WIDTH} height={height} rx="9" fill={edge} opacity=".18" aria-hidden="true" />
      {segments.map((segment) => {
        const on = chosen.has(segment.index)
        const common = {
          x: segment.x, y: 0, width: segment.width, height, rx: 8,
          fill: on ? ink : pale, stroke: '#fff', strokeWidth: 3,
        }
        if (!interactive) return <rect key={segment.index} {...common} aria-hidden="true" />
        return (
          <rect
            key={segment.index}
            {...common}
            className="lhx-fv-hit"
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`Piece ${segment.index + 1} of ${built.parts}`}
            onClick={() => onToggle(segment.index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(segment.index) }
            }}
          />
        )
      })}
    </svg>
  )
}

/**
 * A group — six oranges in a basket, eight sweets. Nothing is cut: the whole
 * IS the set, and the bottom number is how many things there are. That is a
 * different drawing because it is a different idea, and level 1 crosses from
 * one to the other on purpose.
 */
function Group({ built, interactive, chosen, onToggle, labelFor }) {
  const perRow = built.parts > 6 ? 4 : 3
  const items = groupItems({ count: built.parts, perRow })
  const box = groupBox({ count: built.parts, perRow })
  const { ink, pale, edge, top } = built.object
  return (
    <svg
      className="lhx-fv-svg"
      viewBox={`0 0 ${box.width} ${box.height}`}
      width="100%"
      height={box.height}
      preserveAspectRatio="xMidYMid meet"
      role={interactive ? 'group' : 'img'}
      aria-label={interactive ? undefined : labelFor()}
    >
      {items.map((item) => {
        const on = chosen.has(item.index)
        const cx = item.x + item.size / 2
        const cy = item.y + item.size / 2
        const r = item.size / 2 - 4
        const body = (
          <>
            <circle cx={cx} cy={cy} r={r} fill={on ? ink : pale} stroke={edge} strokeWidth="2" opacity={on ? 1 : 0.9} />
            {top === 'stalk' && <path d={`M${cx},${cy - r} q5,-4 8,1`} stroke="#5c7a35" strokeWidth="3" fill="none" strokeLinecap="round" />}
          </>
        )
        if (!interactive) return <g key={item.index} aria-hidden="true">{body}</g>
        return (
          <g
            key={item.index}
            className="lhx-fv-hit"
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${objectNoun(built.objectKey)} ${item.index + 1} of ${built.parts}`}
            onClick={() => onToggle(item.index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(item.index) }
            }}
          >
            {/* A transparent square behind the circle, so the tap target is the
                whole cell rather than the drawn edge of a small orange. */}
            <rect x={item.x} y={item.y} width={item.size} height={item.size} fill="transparent" />
            {body}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * @param {object} props
 * @param {object} props.visual `{ shape, object, parts, numerator, shaded, shares, expectEqual }`
 * @param {boolean} [props.interactive] regions become buttons
 * @param {number[]} [props.chosen] the learner's own selection, when interactive
 * @param {(index:number)=>void} [props.onToggle]
 * @param {string} [props.caption] shown under the picture
 * @param {'sm'|'md'} [props.size]
 */
export default function FractionVisual({
  visual,
  interactive = false,
  chosen = null,
  onToggle = () => {},
  caption = null,
  size = 'md',
  className = '',
}) {
  let built
  try {
    built = buildVisual(visual)
  } catch {
    // A malformed picture is refused rather than drawn wrongly. It should
    // never reach a learner — `test:fraction-content` fails the build on one —
    // but a pack edited live in Firestore can carry one, and a missing diagram
    // is recoverable where a lying diagram is not.
    return null
  }

  // WHOSE SHADING IS DRAWN, and it is the learner's whenever they have done
  // any. `interactive` decides only whether the regions are BUTTONS — it used
  // to decide the fill as well, so the moment a shading question was marked
  // the picture reverted to the pack's own (empty) shading and the two pieces
  // the learner had just tapped disappeared underneath the words "that's one
  // half". Their work has to stay on the screen while they are being told
  // about it.
  //
  // `Array.isArray` rather than `chosen || []`: a picture handed something
  // that is not a list of regions has been given another question's answer,
  // and drawing nothing is the only honest response to that.
  const chosenSet = Array.isArray(chosen)
    ? new Set(chosen.map(Number))
    : built.shaded

  const labelFor = () => {
    const noun = objectNoun(built.objectKey)
    const count = chosenSet.size
    if (!built.equal) return `A ${noun} cut into ${built.parts} pieces that are not the same size`
    if (!count) return `A ${noun} in ${built.parts} equal pieces`
    return `A ${noun} in ${built.parts} equal pieces, ${count} shaded — ${fracWords(count, built.parts)}`
  }

  const shared = { built, interactive, chosen: chosenSet, onToggle, labelFor }

  return (
    <figure className={`lhx-fv is-${size} is-${built.shape} ${className}`.trim()}>
      <div className="lhx-fv-frame">
        {built.shape === 'circle' && <Pie {...shared} />}
        {built.shape === 'bar' && <Bar {...shared} tall />}
        {built.shape === 'strip' && <Bar {...shared} tall={false} />}
        {built.shape === 'group' && <Group {...shared} />}
      </div>
      {Array.isArray(chosen) && (
        // The count is announced as it changes, because the visual state of a
        // shaded region is not available to a learner using a screen reader
        // until they walk back over every region to find out.
        <div className="lhx-sr-only" aria-live="polite">
          {chosenSet.size} of {built.parts} shaded
        </div>
      )}
      {caption && <figcaption className="lhx-fv-cap">{caption}</figcaption>}
    </figure>
  )
}
