/**
 * latexToUnicode — what a formula becomes when JavaScript is not there to draw it.
 *
 * The studio preview renders maths and chemistry with KaTeX. The PDF print
 * window and the Word export do not run KaTeX, so `safeRender.flattenMathNodes`
 * replaces every math node with a text rendering of its LaTeX before those two
 * renderers ever see it. That text rendering is therefore the ONLY thing a
 * teacher's printed paper and their Word download contain — and it was a pile of
 * ordered regexes that got two important things wrong:
 *
 *   1. `\frac{-b \pm \sqrt{b^2-4ac}}{2a}` came out as `-b ± √(b²-4ac)2a`. The
 *      brace matcher could not see past a nested `{`, so the outer \frac fell
 *      through to a rule that drops the command and keeps one argument — and the
 *      fraction bar vanished. The quadratic formula printed as a product. That is
 *      not a formatting problem; it is a wrong formula on a maths paper.
 *   2. `\ce{}` had no handling at all. `\ce{H2SO4}` printed as "H2SO4" with no
 *      subscripts, `\ce{2H2 + O2 -> 2H2O}` kept an ASCII arrow, and `\ce{AgCl v}`
 *      — mhchem's notation for a precipitate — printed the marker as the letter
 *      "v". Chemistry looked right on screen and was wrong on paper.
 *
 * So this parses rather than pattern-matches: a real brace reader, and mhchem's
 * actual rules for what a digit means (a coefficient before a formula, a
 * subscript after an element). Two outputs from the same parse:
 *
 *   - `latexToUnicode()` — a string, for the print window and anywhere text is
 *     all that fits.
 *   - `latexToSegments()` — `[{text, script}]`, so the Word export can emit REAL
 *     subscript and superscript runs. Unicode ₂ depends on the reader having a
 *     glyph for it; a Word subscript run does not, and that matters on a machine
 *     in a school computer lab.
 *
 * Pure and dependency-free — no DOM, no KaTeX — so it tests under plain `node`
 * and runs identically in the browser, the print window and a Cloud Function.
 */

/* ── Unicode script maps ─────────────────────────────────────────────────── */

const SUPERSCRIPTS = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', x: 'ˣ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ',
  m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', y: 'ʸ',
}

const SUBSCRIPTS = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ',
  o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}

/** Single-token LaTeX commands that are just a character. */
const SYMBOLS = {
  times: '×', div: '÷', cdot: '·', ast: '∗', pm: '±', mp: '∓',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', propto: '∝', therefore: '∴', because: '∵',
  pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  Delta: 'Δ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', omega: 'ω',
  Omega: 'Ω', phi: 'φ', rho: 'ρ', tau: 'τ', infty: '∞',
  rightarrow: '→', to: '→', longrightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', rightleftharpoons: '⇌',
  circ: '°', degree: '°', percent: '%', angle: '∠', triangle: '△',
  perp: '⊥', parallel: '∥', cong: '≅', sim: '∼', prime: '′',
  ldots: '…', dots: '…', cdots: '⋯', quad: ' ', qquad: '  ',
  bullet: '•', star: '★', square: '□', int: '∫', sum: '∑', partial: '∂',
  subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', in: '∈', notin: '∉',
  emptyset: '∅', forall: '∀', exists: '∃',
}

/**
 * Glyphs that separate two operands. LaTeX spaces these itself in maths mode, so
 * the text form has to as well — otherwise "4 \div 2" comes out "4 ÷2" once the
 * command-terminating space is eaten.
 */
const OPERATOR_GLYPHS = new Set([
  '×', '÷', '·', '∗', '±', '∓', '≤', '≥', '≠', '≈', '≡', '∝',
  '→', '←', '⇒', '⇐', '↔', '⇌', '∈', '∉', '⊂', '⊃', '∪', '∩', '∥', '≅', '∼',
]);

/** Commands that render as a space. */
const SPACERS = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'thinspace']);

/** Commands whose braces are pure grouping — the argument passes straight through. */
const TRANSPARENT = new Set([
  'text', 'mathrm', 'textrm', 'mathbf', 'textbf', 'mathit', 'textit',
  'operatorname', 'mbox', 'hbox', 'displaystyle', 'textstyle', 'mathord',
]);

/* ── Segment helpers ─────────────────────────────────────────────────────── */

/**
 * Push text onto the segment list, merging with the previous segment when they
 * share a script. Merging keeps the Word export from emitting a run per
 * character, which bloats the file and breaks Word's own line breaking.
 */
function push(segments, text, script = null) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.script === script) {
    last.text += text;
    return;
  }
  segments.push({ text, script });
}

/** Render one segment list as a plain Unicode string. */
export function segmentsToUnicode(segments) {
  let out = '';
  for (const { text, script } of segments) {
    if (!script) {
      out += text;
      continue;
    }
    const map = script === 'sub' ? SUBSCRIPTS : SUPERSCRIPTS;
    const chars = [...text];
    // All-or-nothing: a half-converted script ("H₂SOx") reads worse than the
    // caret form, because the reader cannot tell which characters were meant to
    // be small.
    if (chars.every((c) => map[c])) {
      out += chars.map((c) => map[c]).join('');
    } else {
      out += (script === 'sub' ? '_' : '^') + text;
    }
  }
  return out;
}

/* ── A brace-aware reader ────────────────────────────────────────────────── */

/**
 * Read the argument starting at `i`: either `{...}` with balanced nesting, or a
 * single token (`x`, `2`, or a `\command`).
 *
 * This is the whole reason the old converter got the quadratic formula wrong —
 * `\{([^{}]*)\}` cannot match `{-b \pm \sqrt{b^2-4ac}}`, so the outer \frac was
 * never recognised as a fraction at all.
 *
 * @returns {{value: string, next: number}}
 */
function readArg(src, i) {
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (i >= src.length) return { value: '', next: i };
  if (src[i] === '{') {
    let depth = 1;
    let j = i + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    return { value: src.slice(i + 1, j - 1), next: j };
  }
  if (src[i] === '\\') {
    const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
    if (m) return { value: m[0], next: i + m[0].length };
  }
  return { value: src[i], next: i + 1 };
}

/**
 * Does a fraction's numerator need brackets to stay unambiguous on one line?
 *
 * Anything carrying an operator does — `-b ± √(b²-4ac)` over `2a` written flat
 * without them says something different from what it means. A leading sign is
 * not an operator for this purpose, hence the slice.
 */
function numeratorNeedsBrackets(text) {
  if (!text) return false;
  if (/^\(.*\)$/.test(text)) return false;
  return /[\s+\-−×÷/^_]/.test(text.trim().slice(1));
}

/**
 * A denominator needs brackets unless it is a single number or a single letter.
 *
 * Stricter than the numerator rule on purpose: everything after the slash binds
 * to it, so `1/2a` is genuinely ambiguous where `(-b)/2` is not. `3/4` stays
 * `3/4`; `.../2a` becomes `.../(2a)`.
 */
function denominatorNeedsBrackets(text) {
  if (!text) return false;
  if (/^\(.*\)$/.test(text)) return false;
  return !/^(\d+|[A-Za-z])$/.test(text.trim());
}

/* ── LaTeX → segments ────────────────────────────────────────────────────── */

/**
 * Convert a LaTeX fragment to display segments.
 *
 * @param {string} tex
 * @returns {{text: string, script: ?('sub'|'super')}[]}
 */
export function latexToSegments(tex) {
  const src = String(tex ?? '').trim();
  const segments = [];
  if (!src) return segments;

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i += 1; continue; }
      const name = m[1];
      i += m[0].length;

      if (name === 'ce' || name === 'pu') {
        const { value, next } = readArg(src, i);
        i = next;
        if (name === 'ce') chemToSegments(value, segments);
        else push(segments, value.replace(/\s+/g, ' ').trim());
        continue;
      }
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = readArg(src, i);
        const b = readArg(src, a.next);
        i = b.next;
        const num = segmentsToUnicode(latexToSegments(a.value));
        const den = segmentsToUnicode(latexToSegments(b.value));
        // Bracket only what would otherwise be ambiguous, so "3/4" stays "3/4"
        // while "(-b ± √(b²-4ac))/(2a)" keeps its meaning.
        push(segments, numeratorNeedsBrackets(num) ? `(${num})` : num);
        push(segments, '/');
        push(segments, denominatorNeedsBrackets(den) ? `(${den})` : den);
        continue;
      }
      if (name === 'sqrt') {
        // An optional index: \sqrt[3]{x} → ∛ where a glyph exists.
        let index = '';
        if (src[i] === '[') {
          const close = src.indexOf(']', i);
          if (close !== -1) { index = src.slice(i + 1, close); i = close + 1; }
        }
        const a = readArg(src, i);
        i = a.next;
        const inner = segmentsToUnicode(latexToSegments(a.value));
        const root = index === '3' ? '∛' : index === '4' ? '∜' : '√';
        if (index && root === '√') push(segments, index, 'super');
        push(segments, `${root}(${inner})`);
        continue;
      }
      if (TRANSPARENT.has(name)) {
        const a = readArg(src, i);
        i = a.next;
        for (const seg of latexToSegments(a.value)) push(segments, seg.text, seg.script);
        continue;
      }
      if (SPACERS.has(name)) { push(segments, ' '); continue; }
      if (name === 'left' || name === 'right') continue;
      if (SYMBOLS[name] !== undefined) {
        const glyph = SYMBOLS[name];
        // An operator carries its own spacing; anything else (a Greek letter, a
        // degree sign) does not, and the space that ENDED the command name is
        // LaTeX syntax rather than a printed space — "\pi r^2" is "πr²", not
        // "π r²". Trailing whitespace is eaten for those.
        if (OPERATOR_GLYPHS.has(glyph)) {
          push(segments, ` ${glyph} `);
        } else {
          push(segments, glyph);
          if (name.length > 1) while (i < src.length && /\s/.test(src[i])) i += 1;
        }
        continue;
      }
      if (name.length === 1 && !/[a-zA-Z]/.test(name)) {
        // An escaped literal: \%, \$, \{, \&.
        push(segments, name);
        continue;
      }
      // An unknown command contributes nothing rather than its own backslash
      // name — "\foo" on a printed paper is noise a learner cannot act on.
      continue;
    }

    if (ch === '^' || ch === '_') {
      const a = readArg(src, i + 1);
      i = a.next;
      const inner = segmentsToUnicode(latexToSegments(a.value));
      push(segments, inner, ch === '^' ? 'super' : 'sub');
      continue;
    }

    if (ch === '{' || ch === '}') { i += 1; continue; }
    if (ch === '$') { i += 1; continue; }

    push(segments, ch);
    i += 1;
  }

  // Collapse the runs of spaces the command stripping can leave behind, without
  // touching scripted segments (a space inside a subscript is meaningful).
  return segments
    .map((seg) => (seg.script ? seg : { ...seg, text: seg.text.replace(/\s+/g, ' ') }))
    .filter((seg) => seg.text !== '');
}

/* ── mhchem → segments ───────────────────────────────────────────────────── */

/** mhchem's arrow and marker notation, longest first so "<=>" beats "<-". */
const CHEM_ARROWS = [
  ['<=>>', '⇌'], ['<<=>', '⇌'], ['<=>', '⇌'], ['<-->', '↔'], ['<->', '↔'],
  ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['<=', '⇐'],
];

/**
 * Convert an mhchem `\ce{…}` body to segments, applying the rules that make
 * mhchem worth using in the first place.
 *
 *   - A digit AFTER an element symbol is a subscript: H2SO4 → H₂SO₄.
 *   - A digit BEFORE a formula is a stoichiometric coefficient and stays full
 *     size: 2H2O → 2H₂O. Getting this backwards would change what the equation
 *     says.
 *   - A trailing charge is a superscript: CO3^2- → CO₃²⁻, Na+ → Na⁺.
 *   - State symbols stay literal: (g), (l), (s), (aq).
 *   - `v` and `^` after a species are precipitate/gas markers → ↓ and ↑. The old
 *     converter printed the letter "v" next to a formula, which reads as an
 *     element.
 */
export function chemToSegments(body, segments = []) {
  const src = String(body ?? '').trim();
  let i = 0;

  // True when the previous meaningful token could be part of a formula, which is
  // what distinguishes a subscript digit from a coefficient.
  let afterSpecies = false;

  while (i < src.length) {
    const rest = src.slice(i);

    const arrow = CHEM_ARROWS.find(([a]) => rest.startsWith(a));
    if (arrow) {
      push(segments, ` ${arrow[1]} `);
      i += arrow[0].length;
      afterSpecies = false;
      continue;
    }

    const ch = src[i];

    if (/\s/.test(ch)) {
      // A lone "v" or "^" between spaces is a precipitate / gas marker.
      const marker = /^\s+([v^])(?=\s|$)/.exec(rest);
      if (marker && afterSpecies) {
        push(segments, marker[1] === 'v' ? '↓' : '↑');
        i += marker[0].length;
        continue;
      }
      push(segments, ' ');
      i += 1;
      // A space ends a formula unit, so the next digit is a coefficient.
      afterSpecies = false;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '−') {
      // A charge hugs its species ("Na+"); a reaction plus is spaced (" + ").
      const isCharge = afterSpecies && !/^[+\-−]\s/.test(rest) &&
        (i + 1 >= src.length || /[\s)]|$/.test(src[i + 1] || ' '));
      if (isCharge) {
        push(segments, ch === '-' || ch === '−' ? '−' : '+', 'super');
        i += 1;
        continue;
      }
      push(segments, ` ${ch === '−' ? '−' : ch} `);
      i += 1;
      afterSpecies = false;
      continue;
    }

    if (ch === '^' || ch === '_') {
      const a = readArg(src, i + 1);
      i = a.next;
      const inner = String(a.value)
        .replace(/-/g, '−')
        .replace(/[{}]/g, '');
      push(segments, inner, ch === '^' ? 'super' : 'sub');
      continue;
    }

    if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(rest)[0];
      push(segments, word);
      i += word.length;
      afterSpecies = true;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const digits = /^[0-9]+/.exec(rest)[0];
      // The rule that makes mhchem mhchem.
      push(segments, digits, afterSpecies ? 'sub' : null);
      i += digits.length;
      continue;
    }

    if (ch === '(') {
      push(segments, '(');
      i += 1;
      afterSpecies = false;
      continue;
    }
    if (ch === ')') {
      push(segments, ')');
      i += 1;
      // "(g)" is a state symbol and "(OH)2" is a group whose 2 IS a subscript;
      // both follow a closing bracket, and both want the digit small.
      afterSpecies = true;
      continue;
    }

    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(rest);
      if (m) {
        if (SYMBOLS[m[1]] !== undefined) push(segments, SYMBOLS[m[1]]);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '{' || ch === '}') { i += 1; continue; }

    push(segments, ch);
    i += 1;
    afterSpecies = false;
  }

  return segments;
}

/* ── The structural form, for Word equations ─────────────────────────────── */

/**
 * Parse LaTeX into a small structural tree — the two-dimensional shape that the
 * linear text form necessarily throws away.
 *
 * `latexToSegments` flattens `\frac{a}{b}` to "a/b" because a print window has
 * one line to work with. Word does not: it has real equation objects, and §4.2
 * asks for them ("emit real OMML equations — Word mangles anything else"). A
 * stacked fraction, a radical with its vinculum and a properly-set exponent are
 * the difference between a maths paper that looks typeset and one that looks
 * like a text message.
 *
 * The node vocabulary is what OMML gives us and what school maths needs:
 *
 *   {type:'run', text}
 *   {type:'frac', numerator:[…], denominator:[…]}
 *   {type:'radical', degree:[…]|null, radicand:[…]}
 *   {type:'sup', base:[…], script:[…]}
 *   {type:'sub', base:[…], script:[…]}
 *
 * Anything not in that list degrades to a `run` carrying its readable text, so a
 * construct this does not model still prints correctly — just linearly. That is
 * the brief's fallback rule applied honestly: never silently drop a formula.
 */
export function latexToMathTree(tex) {
  const src = String(tex ?? '').trim();
  const out = [];
  if (!src) return out;

  let i = 0;
  /** Attach a script to whatever preceded it, as OMML requires a base. */
  const takeBase = () => {
    const last = out[out.length - 1];
    if (!last) return [];
    out.pop();
    // A run base is usually a single symbol ("x^2" bases on "x", not on
    // "3x + x"), so split the trailing token off rather than raising the whole
    // run into the exponent's base.
    if (last.type === 'run' && last.text.length > 1) {
      const head = last.text.slice(0, -1);
      const tail = last.text.slice(-1);
      if (head) out.push({type: 'run', text: head});
      return [{type: 'run', text: tail}];
    }
    return [last];
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i += 1; continue; }
      const name = m[1];
      i += m[0].length;

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = readArg(src, i);
        const b = readArg(src, a.next);
        i = b.next;
        out.push({
          type: 'frac',
          numerator: latexToMathTree(a.value),
          denominator: latexToMathTree(b.value),
        });
        continue;
      }
      if (name === 'sqrt') {
        let degree = null;
        if (src[i] === '[') {
          const close = src.indexOf(']', i);
          if (close !== -1) {
            degree = latexToMathTree(src.slice(i + 1, close));
            i = close + 1;
          }
        }
        const a = readArg(src, i);
        i = a.next;
        out.push({type: 'radical', degree, radicand: latexToMathTree(a.value)});
        continue;
      }
      if (name === 'ce' || name === 'pu') {
        // Chemistry is not two-dimensional — it is runs with scripts, which read
        // better in Word as ordinary text runs than wrapped in an equation
        // object a teacher then cannot edit as text. Emit its linear form.
        const {value, next} = readArg(src, i);
        i = next;
        out.push({type: 'run', text: latexToUnicode(`\\${name}{${value}}`)});
        continue;
      }
      if (TRANSPARENT.has(name)) {
        const a = readArg(src, i);
        i = a.next;
        out.push(...latexToMathTree(a.value));
        continue;
      }
      if (SPACERS.has(name)) { out.push({type: 'run', text: ' '}); continue; }
      if (name === 'left' || name === 'right') continue;
      if (SYMBOLS[name] !== undefined) {
        const glyph = SYMBOLS[name];
        out.push({type: 'run', text: OPERATOR_GLYPHS.has(glyph) ? ` ${glyph} ` : glyph});
        if (!OPERATOR_GLYPHS.has(glyph) && name.length > 1) {
          while (i < src.length && /\s/.test(src[i])) i += 1;
        }
        continue;
      }
      if (name.length === 1 && !/[a-zA-Z]/.test(name)) {
        out.push({type: 'run', text: name});
        continue;
      }
      continue;
    }

    if (ch === '^' || ch === '_') {
      const a = readArg(src, i + 1);
      i = a.next;
      out.push({
        type: ch === '^' ? 'sup' : 'sub',
        base: takeBase(),
        script: latexToMathTree(a.value),
      });
      continue;
    }

    if (ch === '{' || ch === '}' || ch === '$') { i += 1; continue; }

    // Plain characters accumulate into the current run.
    const last = out[out.length - 1];
    if (last && last.type === 'run') last.text += ch;
    else out.push({type: 'run', text: ch});
    i += 1;
  }

  // Merge neighbouring runs and collapse the doubled spaces that operator
  // padding leaves behind — Word shows every one of them.
  const merged = [];
  for (const node of out) {
    const last = merged[merged.length - 1];
    if (node.type === 'run' && last && last.type === 'run') {
      last.text += node.text;
      continue;
    }
    merged.push(node);
  }
  return merged
      .map((n) => (n.type === 'run' ? {...n, text: n.text.replace(/ {2,}/g, ' ')} : n))
      .filter((n) => n.type !== 'run' || n.text !== '');
}

/**
 * Is this formula two-dimensional — does it actually need a Word equation?
 *
 * An inline power or a chemical formula is better left as ordinary text runs
 * with real superscript/subscript: Word renders those perfectly, a teacher can
 * still edit them as text, and an equation object around "H₂SO₄" is a worse
 * artefact than the text is. Only a stacked construct earns the OMML.
 */
export function needsEquation(nodes) {
  return (nodes || []).some((node) => {
    if (node.type === 'frac' || node.type === 'radical') return true;
    if (node.type === 'sup' || node.type === 'sub') {
      return needsEquation(node.base) || needsEquation(node.script);
    }
    return false;
  });
}

/* ── The public string form ──────────────────────────────────────────────── */

/**
 * A LaTeX fragment as readable Unicode text.
 *
 * This is what the print window and any text-only consumer get.
 */
export function latexToUnicode(tex) {
  return segmentsToUnicode(latexToSegments(tex)).replace(/\s+/g, ' ').trim();
}

/** True when a fragment carries mhchem chemistry notation. */
export function isChemistry(tex) {
  return /\\(ce|pu)\s*\{/.test(String(tex ?? ''));
}
