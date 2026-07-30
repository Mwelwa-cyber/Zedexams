/**
 * Math rendering helpers for the teacher-tools output.
 *
 * Exports a `renderMath(text)` helper that walks a string, finds fraction
 * patterns (and Unicode fraction characters the AI might emit), and returns
 * an array of strings + React nodes with them rendered as properly stacked
 * fractions. Non-fraction text is passed through untouched.
 *
 * Use this everywhere we render teacher-facing content that may contain
 * fractions: lesson plans, worksheets, answer keys, flashcards.
 */

import React from 'react'
import { hasToolMarkup, parseMarkupBlocks } from './toolNotationRender.js'

/** Contract-markup blocks → React, using the same <Fraction> as the legacy path. */
function renderMarkupBlocks(str) {
  const out = []
  let keyIdx = 0
  parseMarkupBlocks(str).forEach((block, blockIdx) => {
    if (blockIdx > 0) out.push(<br key={`br-${keyIdx++}`} />)
    if (block.kind === 'vmath') {
      const { operator, lines, answer } = block.attrs
      out.push(
        <span key={`va-${keyIdx++}`} className="my-1 inline-flex flex-col items-end tabular-nums leading-snug">
          {lines.map((value, i) => (
            <span key={i} className="block min-w-[4rem] text-right">
              {i === lines.length - 1 && <span className="float-left mr-2">{operator}</span>}
              {value}
            </span>
          ))}
          <span className="mt-0.5 block min-w-[4rem] border-t border-current pt-0.5 text-right">
            {answer || ' '}
          </span>
        </span>,
      )
      return
    }
    for (const part of block.parts) {
      if (part.type === 'text') out.push(part.value)
      else if (part.type === 'script') {
        out.push(part.script === 'sub'
          ? <sub key={`s-${keyIdx++}`}>{part.value}</sub>
          : <sup key={`s-${keyIdx++}`}>{part.value}</sup>)
      } else if (part.type === 'fraction') {
        out.push(
          <React.Fragment key={`fr-${keyIdx++}`}>
            {part.whole || null}
            <Fraction numerator={part.num} denominator={part.den} />
          </React.Fragment>,
        )
      }
    }
  })
  return out
}

/* ── Inline stacked-fraction component ──────────────────────── */

export function Fraction({ numerator, denominator }) {
  return (
    <span
      className="inline-flex flex-col items-center text-center mx-0.5 leading-[1.05]"
      style={{
        fontSize: '0.82em',
        // `middle` aligns the centre of the fraction with the middle of the
        // surrounding x-height, so adjacent operators like `+` and `=` sit
        // at the visual centre of the stacked fraction instead of at the
        // normal text baseline (which would be level with the denominator).
        verticalAlign: 'middle',
        // Nudge up by a fraction of an em so the fraction's centre matches
        // the optical centre of "1 + 2" style text — `middle` aligns to
        // x-height midpoint which is slightly below the visual centre of
        // digits.
        position: 'relative',
        top: '-0.05em',
      }}
      aria-label={`${numerator} over ${denominator}`}
    >
      <span className="px-1 border-b border-current leading-[1.05]">{numerator}</span>
      <span className="px-1 leading-[1.05]">{denominator}</span>
    </span>
  )
}

/* ── Patterns ───────────────────────────────────────────────── */

// Simple fractions: N/M where both sides are 1-3 digits. Bounded by
// characters that aren't digits or slashes to avoid grabbing parts of
// URLs, dates, page ranges like "54-57", etc.
const SIMPLE_FRACTION = /(?<![\d/])(\d{1,3})\/(\d{1,3})(?!\d)/g

// Mixed numbers: whole + space + fraction. Rendered as "whole N⁄M" with the
// fraction stacked. We look for standalone patterns like "1 1/2".
const MIXED_NUMBER = /(?<![\d/])(\d{1,3})\s+(\d{1,3})\/(\d{1,3})(?!\d)/g

/**
 * Looks through a string for fraction patterns and returns an array of
 * (string | React element). Use this return value directly as children of
 * a React element. Keys are indexed — we never render a ragged list so
 * React's reconciler handles stable updates fine.
 */
export function renderMath(text) {
  if (text == null) return text
  const str = String(text)
  if (!str) return str

  // The generation notation contract (Phase 5): a worksheet or homework field
  // may now carry \frac{a}{b}, $…$ or a [[vmath]] token. That markup has ONE
  // parser (toolNotationRender) shared with both exporters, so the screen and
  // the print cannot disagree; here its parts map to the same <Fraction> the
  // legacy path uses. Checked FIRST because "\frac{3}{5}" also contains "3",
  // which would send it down the bare-digits path and print the markup raw.
  if (hasToolMarkup(str)) {
    return renderMarkupBlocks(str)
  }

  // Short-circuit if nothing relevant is present.
  if (!/[\d⁄¼½¾⅐-⅞]/.test(str)) return str

  const out = []
  let cursor = 0
  let keyIdx = 0

  // Work through the string with a combined regex. We prefer mixed-number
  // matches over plain fractions when both could apply.
  // Strategy: find ALL matches from both patterns, sort by index, emit in order.
  const matches = []
  let m
  // Collect mixed-number matches first so they take precedence.
  const mixedRe = new RegExp(MIXED_NUMBER.source, 'g')
  while ((m = mixedRe.exec(str)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'mixed',
      whole: m[1],
      num: m[2],
      den: m[3],
    })
  }
  const fracRe = new RegExp(SIMPLE_FRACTION.source, 'g')
  while ((m = fracRe.exec(str)) !== null) {
    // Skip if overlapping with a mixed-number match.
    const overlaps = matches.some(
      (x) => x.kind === 'mixed' &&
             m.index >= x.start && m.index < x.end,
    )
    if (overlaps) continue
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'frac',
      num: m[1],
      den: m[2],
    })
  }
  matches.sort((a, b) => a.start - b.start)

  for (const hit of matches) {
    if (hit.start > cursor) {
      out.push(str.slice(cursor, hit.start))
    }
    if (hit.kind === 'mixed') {
      out.push(
        <React.Fragment key={`m-${keyIdx++}`}>
          {hit.whole}
          <Fraction numerator={hit.num} denominator={hit.den} />
        </React.Fragment>,
      )
    } else {
      out.push(
        <Fraction
          key={`f-${keyIdx++}`}
          numerator={hit.num}
          denominator={hit.den}
        />,
      )
    }
    cursor = hit.end
  }
  if (cursor < str.length) {
    out.push(str.slice(cursor))
  }

  // If no transformation occurred, return the original string so React can
  // cheaply render a text node rather than an array of one.
  return out.length === 0 ? str : out
}

/**
 * Helper: render math inline within a component. Takes a string and
 * returns a React node suitable for use anywhere text would go.
 *
 *   <p>{renderText(q.prompt)}</p>
 */
export function renderText(text) {
  const parts = renderMath(text)
  if (Array.isArray(parts)) {
    return <>{parts}</>
  }
  return parts
}
