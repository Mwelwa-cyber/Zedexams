/**
 * Drawing the ride: sky, road, rows, rider.
 *
 * Canvas 2D, because the bar is sixty frames a second inside a Capacitor
 * WebView on a cheap Android handset. Three things follow from that bar and
 * are not stylistic:
 *
 *   NOTHING IS ALLOCATED PER FRAME. The gradients are built once per resize
 *   and cached; the verge trees are computed into a preallocated scratch array
 *   and insertion-sorted in place; particles live in a fixed-capacity pool that
 *   is never grown and never filtered. A `.map()` in a draw loop is sixty
 *   arrays a second for the length of the ride.
 *
 *   THE DEVICE PIXEL RATIO IS CAPPED AT 2. A 3x phone would otherwise be
 *   painting 2.25 times the pixels for a difference nobody can see on a
 *   six-inch screen.
 *
 *   `prefers-reduced-motion` REMOVES SHAKE AND PARTICLES, not the game. The
 *   road still moves — that is the mechanic — but nothing jolts the frame and
 *   nothing sprays.
 *
 * ── The two mistakes made during the prototype's development ────────────
 *
 * Both were corrected there and both are easy to reintroduce, so they are
 * written down here rather than left to a reviewer's eye:
 *
 *   THE ROAD RECEDES. Its width comes from `halfWidthAt`, which goes to zero
 *   at the vanishing point. A constant-width road reads as a wall.
 *
 *   THE WHEEL IS SEEN FROM DIRECTLY BEHIND, so it is a narrow VERTICAL ELLIPSE
 *   running down the centre between the rider's legs — not a circle, which
 *   would be a wheel turned sideways, sliding along the tarmac. Nothing is
 *   drawn across it: the pedals and shoes sit outside the tyre, and the spokes
 *   are projected onto the same ellipse so they sweep round the axle instead
 *   of tracing a circle.
 */

import {
  depthScale,
  fadeIn,
  fadeOut,
  halfWidthAt,
  laneCentreAt,
  laneWidthAt,
  roadGeometry,
  trackToScreen,
} from './spellingRideRoad.js'

/**
 * The scene's two palettes.
 *
 * A canvas scene is ARTWORK, not chrome: it cannot read a CSS custom property
 * per frame, so the colours are literals here and the night set is a second
 * literal set rather than a filter over the first. Tile faces stay light in
 * both, because a learner has to READ the letter — a dark tile with pale ink
 * is the one thing the night palette must not do.
 */
const DAY = Object.freeze({
  sky: ['#2E6FB7', '#7FB2E0', '#F6C98A'],
  sun: '#FFD35C',
  hillFar: '#7FA877',
  hillNear: '#5C8A56',
  grass: '#4A7C42',
  trunk: '#7A5230',
  leafDark: '#24512B',
  leafMid: '#2E6B34',
  leafLight: '#3C8440',
  shoulder: '#C9A46A',
  tar: '#3A3F47',
  edge: '#E8E4DA',
  dash: '#F0C24A',
  tile: '#FBF8F0',
  tileEdge: '#C9C2B2',
  tileInk: '#1B1D24',
})

const NIGHT = Object.freeze({
  sky: ['#0A1730', '#16305A', '#3A4A63'],
  sun: '#E8ECF7',
  hillFar: '#2A4433',
  hillNear: '#1E3527',
  grass: '#18291C',
  trunk: '#4A3320',
  leafDark: '#15301B',
  leafMid: '#1B4022',
  leafLight: '#245029',
  shoulder: '#7A6544',
  tar: '#22252B',
  edge: '#9AA0AA',
  dash: '#B7902F',
  tile: '#F2EFE6',
  tileEdge: '#9C968A',
  tileInk: '#1B1D24',
})

const RIGHT_TINT = '#1E8A4C'
const WRONG_TINT = '#D62828'
const SPARK_GOOD = '#66E39A'
const SPARK_BAD = '#FF7B72'
const SPARK_GOLD = '#F0B429'

/** Particles alive at once. A burst is 10–14, so this is a few bursts deep. */
const MAX_PARTICLES = 120

export function createRideRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false })
  let geom = roadGeometry(360, 640)
  let sky = null
  let palette = DAY

  // Preallocated scratch. `trees` holds {x, y, scale} objects that are REUSED
  // — the array never grows past its high-water mark and is never rebuilt.
  const trees = []
  const particles = []
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, r: 0, colour: SPARK_GOOD })
  }
  let particleAt = 0

  function buildSky() {
    const g = ctx.createLinearGradient(0, 0, 0, geom.horizonY + 20)
    g.addColorStop(0, palette.sky[0])
    g.addColorStop(0.55, palette.sky[1])
    g.addColorStop(1, palette.sky[2])
    sky = g
  }

  function resize(width, height, dpr = 1) {
    const ratio = Math.min(Math.max(1, dpr), 2)
    geom = roadGeometry(width, height)
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    buildSky()
  }

  function setNight(night) {
    const next = night ? NIGHT : DAY
    if (next === palette) return
    palette = next
    buildSky()
  }

  /** Throw a handful of sparks. A no-op under reduced motion. */
  function burst(x, y, colour, count) {
    for (let i = 0; i < count; i += 1) {
      const p = particles[particleAt]
      particleAt = (particleAt + 1) % MAX_PARTICLES
      p.x = x
      p.y = y
      p.vx = (Math.random() - 0.5) * 180
      p.vy = -Math.random() * 200 - 40
      p.life = 0.55
      p.r = 2 + Math.random() * 3
      p.colour = colour
    }
  }

  function stepParticles(dt) {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = particles[i]
      if (p.life <= 0) continue
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 620 * dt
      p.life -= dt
    }
  }

  /* ── the scene ─────────────────────────────────────────────────────── */

  function drawSky() {
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, geom.width, geom.horizonY + 22)
    ctx.fillStyle = palette.sun
    ctx.beginPath()
    ctx.arc(geom.width * 0.17, geom.horizonY * 0.66, geom.width * 0.062, 0, Math.PI * 2)
    ctx.fill()
  }

  function hill(yBase, amp, phase, colour) {
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.moveTo(0, geom.height)
    for (let x = 0; x <= geom.width; x += 12) {
      const t = (x / geom.width) * Math.PI
      const y = yBase + Math.sin(t * 2 + phase) * amp + Math.sin(t * 5 + phase * 1.7) * amp * 0.35
      ctx.lineTo(x, y)
    }
    ctx.lineTo(geom.width, geom.height)
    ctx.closePath()
    ctx.fill()
  }

  function drawTree(x, y, scale) {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    ctx.fillStyle = palette.trunk
    ctx.fillRect(-3.5, -28, 7, 28)
    ctx.fillStyle = palette.leafDark
    ctx.beginPath(); ctx.ellipse(0, -31, 24, 8, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = palette.leafMid
    ctx.beginPath(); ctx.ellipse(-9, -38, 14, 7.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(10, -37, 13, 7, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = palette.leafLight
    ctx.beginPath(); ctx.ellipse(0, -43, 12, 6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  function drawScenery(distance) {
    const hz = geom.horizonY
    hill(hz - geom.height * 0.02, geom.height * 0.02, 1.2, palette.hillFar)
    hill(hz + geom.height * 0.008, geom.height * 0.014, 3.4, palette.hillNear)
    ctx.fillStyle = palette.grass
    ctx.fillRect(0, hz + geom.height * 0.015, geom.width, geom.height)

    for (let i = 0; i < 7; i += 1) {
      const x = (i + 0.5) * (geom.width / 7) + Math.sin(i * 2.3) * 10
      drawTree(x, hz + geom.height * 0.028, 0.5)
    }

    // Verge trees ride the same perspective as the road. Written into the
    // scratch array rather than a fresh one, then insertion-sorted in place —
    // n is under a dozen, so the sort is cheaper than the allocation it saves.
    const spacing = 240
    const span = geom.riderY + 330
    let count = 0
    const rounds = Math.ceil(span / spacing) + 1
    for (let k = 0; k < rounds; k += 1) {
      for (let s = 0; s < 2; s += 1) {
        const side = s === 0 ? -1 : 1
        const worldY = ((k * spacing + side * 110 + distance) % span) - 70
        const screenY = trackToScreen(worldY, geom)
        if (screenY <= geom.roadTopY + 2 || screenY > geom.height + 80) continue
        const scale = depthScale(screenY, geom)
        if (!trees[count]) trees[count] = { x: 0, y: 0, scale: 1 }
        const tree = trees[count]
        tree.x = geom.width / 2 + side * (halfWidthAt(screenY, geom) + 20 + 30 * scale)
        tree.y = screenY
        tree.scale = 0.35 + scale * 0.95
        count += 1
      }
    }
    for (let i = 1; i < count; i += 1) {
      const item = trees[i]
      let j = i - 1
      while (j >= 0 && trees[j].y > item.y) { trees[j + 1] = trees[j]; j -= 1 }
      trees[j + 1] = item
    }
    for (let i = 0; i < count; i += 1) drawTree(trees[i].x, trees[i].y, trees[i].scale)
  }

  function drawRoad(distance) {
    const top = geom.roadTopY
    const cx = geom.width / 2
    const hTop = halfWidthAt(top, geom)
    const hBottom = halfWidthAt(geom.height, geom)

    ctx.fillStyle = palette.shoulder
    ctx.beginPath()
    ctx.moveTo(cx - hTop - 6, top); ctx.lineTo(cx + hTop + 6, top)
    ctx.lineTo(cx + hBottom + 26, geom.height); ctx.lineTo(cx - hBottom - 26, geom.height)
    ctx.closePath(); ctx.fill()

    ctx.fillStyle = palette.tar
    ctx.beginPath()
    ctx.moveTo(cx - hTop, top); ctx.lineTo(cx + hTop, top)
    ctx.lineTo(cx + hBottom, geom.height); ctx.lineTo(cx - hBottom, geom.height)
    ctx.closePath(); ctx.fill()

    ctx.strokeStyle = palette.edge
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(cx - hTop, top); ctx.lineTo(cx - hBottom, geom.height); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx + hTop, top); ctx.lineTo(cx + hBottom, geom.height); ctx.stroke()

    // Lane dashes, drawn per dash so the far ones shrink with the road.
    ctx.strokeStyle = palette.dash
    ctx.lineCap = 'butt'
    const period = 110
    const span = geom.riderY + 330
    const rounds = Math.ceil(span / period) + 1
    for (let s = 0; s < 2; s += 1) {
      const side = s === 0 ? -1 : 1
      for (let k = 0; k < rounds; k += 1) {
        const worldY = ((k * period + distance) % span) - 70
        const y1 = trackToScreen(worldY, geom)
        const y2 = trackToScreen(worldY + 44, geom)
        if (y2 <= top + 1 || y1 > geom.height + 20) continue
        const x1 = cx + (side * halfWidthAt(y1, geom)) / 3
        const x2 = cx + (side * halfWidthAt(y2, geom)) / 3
        ctx.lineWidth = 1.5 + (3.5 * (y1 - geom.vanishY)) / (geom.height - geom.vanishY)
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, Math.min(y2, geom.height)); ctx.stroke()
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function drawTile(cx, cy, laneW, text, wordy, tint, pop) {
    const k = pop || 1
    const w = (wordy ? laneW * 0.94 : Math.min(laneW * 0.7, 82)) * k
    const h = Math.min(wordy ? 46 : 62, wordy ? w * 0.44 : w * 0.85) * k
    const x = cx - w / 2
    const y = cy - h / 2
    const r = Math.max(4, 12 * (w / 82))

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,.35)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 4
    ctx.fillStyle = tint || palette.tile
    roundRect(x, y, w, h, r)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = tint ? 'rgba(255,255,255,.55)' : palette.tileEdge
    ctx.lineWidth = 2
    roundRect(x, y, w, h, r)
    ctx.stroke()

    ctx.fillStyle = tint ? '#ffffff' : palette.tileInk
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = Math.max(8, wordy ? h * 0.42 : h * 0.56)
    ctx.font = `800 ${size}px system-ui, sans-serif`
    const label = wordy ? text : String(text).toUpperCase()
    while (ctx.measureText(label).width > w - 14 && size > 9) {
      size -= 1
      ctx.font = `800 ${size}px system-ui, sans-serif`
    }
    ctx.fillText(label, cx, cy + 1)
  }

  /**
   * The rows, in one of two passes.
   *
   * UNRESOLVED ROWS ARE DRAWN UNDER THE RIDER and RESOLVED ONES OVER, which is
   * a legibility fix rather than a stacking preference. A row resolves at the
   * rider's own line, so the MIDDLE lane's tile is directly behind the child on
   * the frame it turns green or red — and that tint is the entire feedback for
   * the choice just made. Under the rider it is invisible for the whole 0.45s
   * it exists. The approach still reads correctly, because an unresolved row
   * is never at the rider yet.
   */
  function drawRows(ride, resolvedPass) {
    for (let i = 0; i < ride.rows.length; i += 1) {
      const row = ride.rows[i]
      if (row.resolved !== resolvedPass) continue
      const screenY = trackToScreen(row.y, geom)
      if (screenY <= geom.roadTopY + 2 || screenY > geom.height + 80) continue
      const scale = depthScale(screenY, geom)
      const out = row.resolved ? fadeOut(row.age) : 1
      ctx.globalAlpha = fadeIn(scale) * out
      const pop = row.resolved ? 1 + (1 - out) * 0.25 : 1
      const laneW = laneWidthAt(screenY, geom)
      for (let lane = 0; lane < 3; lane += 1) {
        const wrongPick = row.resolved && lane === row.chosenLane && lane !== row.correctLane
        const isRight = row.resolved && lane === row.correctLane
        drawTile(
          laneCentreAt(lane, screenY, geom), screenY, laneW,
          row.options[lane], row.challenge.wordy,
          isRight ? RIGHT_TINT : (wrongPick ? WRONG_TINT : null),
          pop,
        )
      }
      ctx.globalAlpha = 1
    }
  }

  /**
   * The rider, seen from behind: yellow helmet, black hair, green shirt, red
   * backpack with straps, navy shorts, red sneakers with white soles, orange
   * bike. Read the wheel note at the top of this file before touching it.
   */
  function drawRider(x, targetX, wobble, damage, distance) {
    const y = geom.riderY
    // Lean into the turn, capped well under 10° — a bike that pivots reads as
    // a skid rather than a lane change.
    const lean = Math.max(-0.14, Math.min(0.14, (targetX - x) * 0.0016 + Math.sin(wobble) * damage * 0.006))
    const pedal = Math.sin(wobble * 2)
    const pedalL = 20 - pedal * 5
    const pedalR = 20 + pedal * 5

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(lean)
    ctx.scale(1.35, 1.35)

    ctx.fillStyle = 'rgba(0,0,0,.20)'
    ctx.beginPath(); ctx.ellipse(0, 43, 17, 4.5, 0, 0, Math.PI * 2); ctx.fill()

    // ── the wheel: edge-on, so a NARROW VERTICAL ELLIPSE down the centre ──
    const WX = 0; const WY = 19; const WRX = 7; const WRY = 21
    ctx.strokeStyle = '#17181D'; ctx.lineWidth = 6
    ctx.beginPath(); ctx.ellipse(WX, WY, WRX, WRY, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = '#D2D7DE'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.ellipse(WX, WY, WRX - 2.8, WRY - 4.5, 0, 0, Math.PI * 2); ctx.stroke()
    // Spokes PROJECTED onto that same ellipse, so they sweep round the axle.
    ctx.strokeStyle = 'rgba(150,157,168,.5)'; ctx.lineWidth = 0.8
    for (let a = 0; a < 4; a += 1) {
      const angle = (a * Math.PI) / 2 + distance * 0.06
      ctx.beginPath()
      ctx.moveTo(WX, WY)
      ctx.lineTo(WX + Math.cos(angle) * (WRX - 2.8), WY + Math.sin(angle) * (WRY - 4.5))
      ctx.stroke()
    }
    ctx.fillStyle = '#2A2E36'
    ctx.beginPath(); ctx.arc(WX, WY, 2, 0, Math.PI * 2); ctx.fill()

    // Orange fork straddling the wheel — never across it.
    ctx.strokeStyle = '#EF7D00'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-4, -10); ctx.quadraticCurveTo(-9, 2, -8, 14); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(4, -10); ctx.quadraticCurveTo(9, 2, 8, 14); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, -8); ctx.stroke()

    // Legs straddle the wheel; feet sit well outside the tyre.
    ctx.strokeStyle = '#8A5A32'; ctx.lineWidth = 7
    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.quadraticCurveTo(-18, 4, -16, pedalL - 3); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.quadraticCurveTo(18, 4, 16, pedalR - 3); ctx.stroke()

    ctx.fillStyle = '#15171D'
    roundRect(-21.5, pedalL + 3, 12, 3.5, 1.5); ctx.fill()
    roundRect(9.5, pedalR + 3, 12, 3.5, 1.5); ctx.fill()
    ctx.fillStyle = '#D53A33'
    roundRect(-21, pedalL - 4, 11, 8, 3); ctx.fill()
    roundRect(10, pedalR - 4, 11, 8, 3); ctx.fill()
    ctx.fillStyle = '#F4F1E8'
    roundRect(-21, pedalL + 1.6, 11, 2.6, 1.3); ctx.fill()
    roundRect(10, pedalR + 1.6, 11, 2.6, 1.3); ctx.fill()

    ctx.fillStyle = '#2C3E66'
    roundRect(-14, -18, 28, 13, 6); ctx.fill()

    ctx.strokeStyle = '#1B1D24'; ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(-10, -14); ctx.quadraticCurveTo(-22, -17, -27, -12); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(10, -14); ctx.quadraticCurveTo(22, -17, 27, -12); ctx.stroke()

    ctx.fillStyle = '#2E8B4F'
    roundRect(-17, -50, 34, 36, 11); ctx.fill()

    ctx.fillStyle = '#C0392B'
    roundRect(-11, -45, 22, 24, 8); ctx.fill()
    ctx.strokeStyle = '#96261B'; ctx.lineWidth = 2
    roundRect(-11, -45, 22, 24, 8); ctx.stroke()
    ctx.fillStyle = '#D14B3A'
    roundRect(-7, -33, 14, 9, 4); ctx.fill()
    ctx.strokeStyle = '#96261B'; ctx.lineWidth = 3.5
    ctx.beginPath(); ctx.moveTo(-8, -48); ctx.lineTo(-13, -42); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(8, -48); ctx.lineTo(13, -42); ctx.stroke()

    ctx.strokeStyle = '#2E8B4F'; ctx.lineWidth = 7
    ctx.beginPath(); ctx.moveTo(-14, -44); ctx.quadraticCurveTo(-25, -34, -24, -15); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(14, -44); ctx.quadraticCurveTo(25, -34, 24, -15); ctx.stroke()
    ctx.fillStyle = '#8A5A32'
    ctx.beginPath(); ctx.arc(-24, -13.5, 4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(24, -13.5, 4, 0, Math.PI * 2); ctx.fill()

    ctx.fillStyle = '#1A1A1E'
    ctx.beginPath(); ctx.arc(0, -55, 10, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#F2B117'
    ctx.beginPath(); ctx.arc(0, -58, 13.5, Math.PI, 0); ctx.closePath(); ctx.fill()
    roundRect(-14.5, -60, 29, 6, 3); ctx.fill()
    ctx.fillStyle = '#D99A0B'
    roundRect(-14.5, -55.5, 29, 2, 1); ctx.fill()

    ctx.restore()

    if (damage >= 3) {
      for (let i = 0; i < 2; i += 1) {
        const t = (distance * 0.02 + i * 3) % 10
        ctx.fillStyle = `rgba(120,120,130,${0.3 - t * 0.028})`
        ctx.beginPath()
        ctx.arc(x - 16 - t * 1.5, y + 20 - t * 4, 4 + t * 0.9, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  function drawParticles() {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = particles[i]
      if (p.life <= 0) continue
      ctx.globalAlpha = Math.max(0, p.life / 0.55)
      ctx.fillStyle = p.colour
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  /**
   * One frame. `view` carries the presentation-only state the ride core has no
   * business knowing about — where the bike has smoothly slid to, how far
   * through its pedal stroke it is, and whether this device wants motion.
   */
  function draw(ride, view) {
    const reduced = Boolean(view?.reducedMotion)
    ctx.save()
    if (!reduced && ride.shake > 0) {
      const m = ride.shake * 10
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m)
    }
    drawSky()
    drawScenery(ride.distance)
    drawRoad(ride.distance)
    drawRows(ride, false)
    drawRider(view.x, view.targetX, view.wobble, Math.max(0, 5 - ride.hearts), ride.distance)
    drawRows(ride, true)
    if (!reduced) drawParticles()
    ctx.restore()
  }

  return {
    resize,
    setNight,
    draw,
    burst,
    stepParticles,
    get geometry() { return geom },
    LANE_SPARK: { good: SPARK_GOOD, bad: SPARK_BAD, gold: SPARK_GOLD },
  }
}
