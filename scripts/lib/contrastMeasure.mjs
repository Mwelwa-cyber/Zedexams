/**
 * The in-page contrast measurement, shared by scripts/audit-dark-surfaces.mjs
 * (synthetic surfaces × four themes) and scripts/test-route-contrast.mjs (the
 * key routes in the two dark themes).
 *
 * A string, not a function: it is evaluated inside Chromium via
 * page.evaluate, so it must carry no references to Node scope.
 *
 * What it does, per element that directly contains text:
 *  - composites the ancestor background chain down to the colour actually
 *    painted (translucent layers over translucent layers), refusing to
 *    fabricate a number when a gradient/image is in the chain — those are
 *    reported in `skipped` rather than passed silently
 *  - composites the text colour (and its alpha) over that background
 *  - grades the pair against WCAG AA with the large-text rule (3:1 at
 *    ≥24px, or ≥18.66px bold; 4.5:1 otherwise)
 *  - skips invisible text (display:none, visibility:hidden, zero opacity,
 *    sub-2px rects) and disabled controls (WCAG 1.4.3 exempts them)
 *  - separately reports how much of the [data-s]-marked surface area is
 *    light, so a page can be checked for "still a white slab in the dark"
 */
export const MEASURE = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (f, b) => ({ r: f.r*f.a + b.r*(1-f.a), g: f.g*f.a + b.g*(1-f.a), b: f.b*f.a + b.b*(1-f.a), a: 1 })
  const lum = (c) => { const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b) }
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05) }
  // Composite the ancestor chain. A gradient/image is unreadable from computed
  // style, so it returns null rather than a fabricated number.
  const effBg = (el) => {
    const stack=[]; let n=el
    while(n){ const cs=getComputedStyle(n)
      if(cs.backgroundImage && cs.backgroundImage!=='none') return null
      const c=parse(cs.backgroundColor); if(c&&c.a>0) stack.push(c); if(c&&c.a===1) break
      n=n.parentElement }
    let base={r:255,g:255,b:255,a:1}
    for(let i=stack.length-1;i>=0;i--) base=over(stack[i],base)
    return base
  }
  const label=(el)=>el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className.trim()
    ? '.'+el.className.trim().split(/\\s+/).slice(0,3).join('.') : '')
  const pairs=[], skipped=[]
  document.querySelectorAll('*').forEach((el)=>{
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) return
    const cs=getComputedStyle(el)
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0) return
    // Disabled controls are exempt from WCAG 1.4.3.
    if(el.closest('[disabled], [aria-disabled="true"]')) return
    const r=el.getBoundingClientRect(); if(r.width<2||r.height<2) return
    const fg=parse(cs.color); if(!fg) return
    const bg=effBg(el); if(!bg){ skipped.push(label(el)); return }
    const px=parseFloat(cs.fontSize), bold=Number(cs.fontWeight)>=700
    const large=px>=24||(px>=18.66&&bold)
    pairs.push({ sel:label(el), text:el.innerText.trim().slice(0,32),
      ratio:Math.round(ratio(over(fg,bg),bg)*100)/100, min:large?3:4.5,
      fg:cs.color, bg:'rgb('+[bg.r,bg.g,bg.b].map(Math.round).join(',')+')' })
  })
  // Painted area by tone, over the elements explicitly marked as surfaces.
  let light=0, total=0
  document.querySelectorAll('[data-s]').forEach((el)=>{
    const bg=effBg(el); if(!bg) return
    const r=el.getBoundingClientRect(); if(r.width<4||r.height<4) return
    const a=r.width*r.height; total+=a; if(lum(bg)>0.5) light+=a
  })
  return { pairs, skipped, lightArea:Math.round(light), totalArea:Math.round(total) }
})()`
