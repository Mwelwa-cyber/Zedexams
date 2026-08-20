/**
 * ZambiaMap — the one map every Know Zambia mode draws on.
 *
 * Six modes share this: place-the-province, capitals, journey, odd one out,
 * neighbours and ceremonies. They differ in what they colour, what they label
 * and what they let you tap, and in nothing else — so the parts that are easy
 * to get subtly wrong are settled once, here.
 *
 * Four of those parts are worth naming, because each has already been a bug:
 *
 *   NAMES SIT ON THE POLE OF INACCESSIBILITY. Never the centre of the
 *   bounding box: Central wraps around Copperbelt, so its box centre lands
 *   inside Copperbelt — as do Eastern's, in Muchinga, and Luapula's, in
 *   Northern. Three of ten. The dataset carries the right anchor as `c`.
 *
 *   AND THEY ARE SIZED BY THE ROOM AT THAT ANCHOR, not by the width of the
 *   box either — that is the same mistake one step along, and it printed
 *   "North-Western" straight through "Copperbelt". `labelSizeFor` uses the
 *   inscribed radius.
 *
 *   TAPPABILITY IS IN THE MARKUP, NOT IN THE HANDLER. When a mode dims
 *   provinces (odd one out lights four and dims six), the dimmed ones get no
 *   click target, no tabIndex and no halo. Filtering them in the handler
 *   instead would leave them focusable and announced, so the Tab key and a
 *   screen reader would disagree with the picture.
 *
 *   EVERY TARGET IS 44px. Lusaka measures about 32px tall on a 360px screen,
 *   so short shapes get an invisible halo sized from the width the map is
 *   ACTUALLY rendered at, stacked smallest-last so Lusaka wins the tap over
 *   Central.
 *
 * Colour never carries the message on its own — a state always brings a glyph
 * (✓, ✗) or a number, because the palette's green and orange sit at almost
 * the same grey and a lot of these screens get photocopied or projected.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { haloRadius, labelSizeFor, project } from '../lib/knowZambiaCore'

/* The words a screen reader hears for each state. The place-the-province mode
   calls a finished province "placed" where the question modes call it
   "correct", so the map takes them rather than deciding for every mode. */
export const DEFAULT_STATE_WORDS = {
  ok: ', correct',
  no: ', wrong',
  anchor: ', already named',
  step: ', on the route',
  live: '',
  dim: '',
}

export default function ZambiaMap({
  geo,                 // code → shape, from buildGeometry
  provinces,           // the raw dataset provinces (for the `d` paths)
  viewBox,
  state = {},          // code → 'ok' | 'no' | 'anchor' | 'step' | 'live' | 'dim'
  tappable = null,     // array of codes, or null for "all of them"
  labels = [],         // codes to name on top of whatever `state` already names
  order = {},          // code → the number to print (journey crossing order)
  pin = null,          // { lon, lat, label } drawn from real coordinates
  projection = null,
  zones = null,        // [{ code, name, zone:[x,y,w,h], side }] for neighbours
  zoneState = {},      // code → 'ok' | 'no'
  onTapProvince = null,
  onTapZone = null,
  stateWords = DEFAULT_STATE_WORDS,
  ariaLabel = 'Map of Zambia and its ten provinces',
}) {
  const svgRef = useRef(null)
  const [scale, setScale] = useState(0)
  const viewWidth = Number(String(viewBox || '0 0 100 81.5').split(/\s+/)[2]) || 100

  // Measured, not assumed — and re-measured when the window changes, which is
  // what a rotated phone does.
  useEffect(() => {
    const measure = () => {
      const width = svgRef.current?.getBoundingClientRect().width || 0
      if (width) setScale(width / viewWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [viewWidth])

  const canTap = (code) => !!onTapProvince && (!tappable || tappable.includes(code))

  // Smallest-last, so a small province's halo sits on top of a big one's.
  const haloOrder = useMemo(
    () => Object.values(geo).filter((s) => canTap(s.code)).sort((a, b) => b.area - a.area),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo, tappable, onTapProvince],
  )

  const named = useMemo(() => {
    const out = []
    for (const shape of Object.values(geo)) {
      const st = state[shape.code]
      if (st === 'ok' || st === 'anchor' || st === 'step' || labels.includes(shape.code)) out.push(shape)
    }
    return out
  }, [geo, state, labels])

  const pinAt = pin && projection ? project(projection, pin.lon, pin.lat) : null

  return (
    <div className="lhx-kz-map">
      <svg ref={svgRef} className="lhx-kz-svg" viewBox={viewBox} role="group" aria-label={ariaLabel}>
        <defs>
          <pattern id="lhx-kz-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="#fbe3d2" />
            <rect width="1.4" height="3" fill="#d55e00" />
          </pattern>
        </defs>

        {/* Neighbour boxes sit outside the outline, so they are drawn first
            and a province can never be hidden behind one. */}
        {zones?.map((zone) => {
          const st = zoneState[zone.code] || ''
          const open = !st && !!onTapZone
          const [x, y, w, h] = zone.zone
          return (
            <g key={`zone-${zone.code}`}>
              <rect
                className={`lhx-kz-zone ${st ? `is-${st}` : ''}`}
                x={x} y={y} width={w} height={h} rx="2"
                role={open ? 'button' : undefined}
                tabIndex={open ? 0 : undefined}
                aria-label={`${zone.name}, to the ${zone.side} of Zambia${stateWords[st] || ''}`}
                onClick={open ? () => onTapZone(zone.code) : undefined}
                onKeyDown={open ? (e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onTapZone(zone.code)
                } : undefined}
              >
                <title>{zone.name}</title>
              </rect>
              {st === 'ok' && (
                <>
                  <text className="lhx-kz-zlab is-on" x={x + w / 2} y={y + h / 2 + 1}>{zone.name}</text>
                  <text className="lhx-kz-mark" x={x + w / 2} y={y + h / 2 - 3.4}>✓</text>
                </>
              )}
              {st === 'no' && <text className="lhx-kz-mark is-wrong" x={x + w / 2} y={y + h / 2 + 1.4}>✗</text>}
              {!st && <text className="lhx-kz-zlab" x={x + w / 2} y={y + h / 2 + 1}>?</text>}
            </g>
          )
        })}

        {Object.values(geo).map((shape) => {
          const st = state[shape.code] || ''
          const open = canTap(shape.code)
          return (
            <path
              key={shape.code}
              className={`lhx-kz-prov ${st ? `is-${st}` : ''}`}
              d={provinces[shape.code].d}
              role={open ? 'button' : undefined}
              tabIndex={open ? 0 : undefined}
              aria-label={`${shape.name} Province${stateWords[st] || ''}`}
              onClick={open ? () => onTapProvince(shape.code) : undefined}
              onKeyDown={open ? (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                onTapProvince(shape.code)
              } : undefined}
            >
              <title>{shape.name} Province</title>
            </path>
          )
        })}

        {named.map((shape) => {
          const size = labelSizeFor(shape)
          const st = state[shape.code]
          const muted = st === 'anchor' || st === 'live' || !st
          return (
            <g key={`label-${shape.code}`} aria-hidden="true">
              <text
                className={`lhx-kz-label ${muted ? 'is-anchor' : ''}`}
                x={shape.anchor[0]}
                y={shape.anchor[1]}
                style={{ fontSize: `${size.toFixed(2)}px` }}
              >
                {shape.name}
              </text>
              {st === 'ok' && (
                <text className="lhx-kz-mark" x={shape.anchor[0]} y={shape.anchor[1] - size - 1.2}>✓</text>
              )}
              {st === 'step' && order[shape.code] && (
                <text className="lhx-kz-mark is-step" x={shape.anchor[0]} y={shape.anchor[1] - size - 1.2}>
                  {order[shape.code]}
                </text>
              )}
            </g>
          )
        })}

        {Object.values(geo).filter((s) => state[s.code] === 'no').map((shape) => (
          <text
            key={`x-${shape.code}`}
            className="lhx-kz-mark is-wrong"
            aria-hidden="true"
            x={shape.anchor[0]}
            y={shape.anchor[1]}
          >
            ✗
          </text>
        ))}

        {pinAt && (
          <g className="lhx-kz-pin" aria-hidden="true">
            <circle cx={pinAt[0].toFixed(2)} cy={pinAt[1].toFixed(2)} r="1.5" />
            <text x={pinAt[0].toFixed(2)} y={(pinAt[1] - 2.6).toFixed(2)}>{pin.label}</text>
          </g>
        )}

        {/* Halos: 0 until the map has been measured, and 0 for any shape
            already big enough to tap. A halo nothing needed only steals taps
            from the province underneath it. */}
        <g className="lhx-kz-halos">
          {haloOrder.map((shape) => {
            const radius = haloRadius(Math.min(shape.bbox.w, shape.bbox.h), scale)
            if (!radius) return null
            return (
              <circle
                key={`halo-${shape.code}`}
                className="lhx-kz-halo"
                cx={shape.anchor[0]}
                cy={shape.anchor[1]}
                r={radius}
                aria-hidden="true"
                onClick={() => onTapProvince(shape.code)}
              />
            )
          })}
          {zones?.filter((z) => !zoneState[z.code] && onTapZone).map((zone) => {
            const [x, y, w, h] = zone.zone
            const radius = haloRadius(Math.min(w, h), scale)
            if (!radius) return null
            return (
              <circle
                key={`zhalo-${zone.code}`}
                className="lhx-kz-halo"
                cx={x + w / 2}
                cy={y + h / 2}
                r={radius}
                aria-hidden="true"
                onClick={() => onTapZone(zone.code)}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}
