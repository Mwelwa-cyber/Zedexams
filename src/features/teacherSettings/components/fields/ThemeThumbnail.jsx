/**
 * A miniature of the teacher workspace, drawn in one theme's real colours.
 *
 * WHERE THE COLOURS COME FROM
 * ---------------------------
 * Nowhere in this file. The element carries `data-theme="<id>"`, which is the
 * same attribute the app sets on <html>, so every `var(--zt-…)` below resolves
 * through the real cascade to the real palette. That is deliberate and it is
 * the whole point: a thumbnail with its own copy of the hex values would look
 * correct on the day it was written and then silently disagree with the app
 * the first time a colour was corrected — and a swatch showing the wrong
 * colour still looks like a working control, so nothing would report it.
 *
 * WHAT IT DRAWS
 * -------------
 * A sidebar strip with an accent-filled active pill and a few faint nav
 * placeholders, next to the page surface holding a card and an accent button
 * bar. Those are the four things that actually differ between the themes at a
 * glance, which is what makes Terracotta and Copperbelt — two warm themes with
 * different sidebars — distinguishable here without reading the label.
 *
 * Purely decorative: the theme's name, description and selected state are all
 * rendered as real text next to it, so this is aria-hidden.
 */
export default function ThemeThumbnail({ themeId }) {
  return (
    <span className="tset-thumb" data-theme={themeId} aria-hidden="true">
      <span className="tset-thumb__sidebar">
        <span className="tset-thumb__pill" />
        <span className="tset-thumb__nav" />
        <span className="tset-thumb__nav" />
        <span className="tset-thumb__nav" />
      </span>
      <span className="tset-thumb__main">
        <span className="tset-thumb__card">
          <span className="tset-thumb__row" />
          <span className="tset-thumb__row tset-thumb__row--short" />
        </span>
        <span className="tset-thumb__bar" />
      </span>
    </span>
  )
}
