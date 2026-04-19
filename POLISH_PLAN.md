# ZedExams — Premium Polish Plan

**Goal:** bring the visual language and interaction quality up to feel like a paid consumer product, while keeping the warm, K–7-friendly personality that's already there.

**Audience reality check:** learners aged 8–13 on low-bandwidth Zambian networks. Premium here means *refined and trustworthy*, not *cold and corporate*. We keep the color, the Pako mascot, the encouragement — and we raise the craft ceiling around them.

---

## Current state — what's already good

- Five-theme system with CSS custom properties (sky, lavender, midnight, oatmeal, solar) — rare to have this from day one.
- Data Saver mode — genuinely audience-aware, not a checkbox feature.
- Solid animation primitives (`float`, `wiggle`, `star-spin`, `pop`, `scale-in`, `slide-up`).
- Two-layer component system (utilities + component classes).
- `theme-hero` gradient, `theme-card`, `theme-accent-fill` — consistent surface language.
- Learner surfaces (GradeHub, QuizList, LessonLibrary, PapersLibrary) already feel polished for their audience.
- Login/Register have the right hero + animate-scale-in entrance.
- Custom scrollbar, safe-area insets, KaTeX + rich-text rendering.

**This plan doesn't replace any of that.** It deepens it.

---

## The gap — what keeps the app from feeling premium

The code audit + surface audit surface 11 consistent themes:

1. **Typography is mono-family.** `index.html` loads four font families (Nunito, Outfit, Lora, Plus Jakarta Sans) but Tailwind only knows about Nunito. Everything in the UI is Nunito. Premium products pair a display face with a body face. We're shipping the display faces and not using them.
2. **No modular type scale.** Font sizes are picked ad-hoc from Tailwind's default scale. No headline tracking (`letter-spacing`) rules. No leading rhythm.
3. **Shadows are shallow.** One `theme-shadow` token (`0 1px 6px`). Premium products stack elevation — a subtle inner highlight plus a layered outer drop — so cards feel lifted, not painted on.
4. **Motion library is decorative, not functional.** Great at making a star twinkle, missing the quiet motion that sells premium: hover lift, press feedback, list stagger, skeleton shimmer.
5. **Color palette is theme-wide swaps with no semantic ladder.** `brand-blue`, `brand-green`, `brand-orange` are flat constants. No `success/warning/danger/info` tokens. Gray scale is Tailwind default, not tuned to the theme.
6. **Radius tokens are picked ad-hoc.** `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl` mixed randomly across similar components.
7. **Emoji is doing the job of iconography.** `lucide-react` is already a dependency (454 icons) and used in a few places — but the nav, admin sidebar, and dashboard headers use emoji where SVG icons would feel more intentional.
8. **Button system is split.** `btn-primary` / `btn-outline` exist in CSS but most pages inline the same classes. No `Button` React primitive with variants + sizes.
9. **No visible focus ring.** Keyboard users see nothing when tabbing. Accessibility + premium feel both require `focus-visible:ring`.
10. **Loading states are `animate-pulse`.** Premium uses a gradient shimmer sweeping across the placeholder.
11. **Midnight theme is a user choice, not a system-preference detection.** Users who prefer dark mode at the OS level don't get it by default.

---

## The plan — 4 phases

Each phase is independently shippable. Stop at any phase if the result is good enough.

| Phase | Scope | Effort | User-visible change |
|-------|-------|--------|---------------------|
| **0 — Design tokens** | Add type scale, shadow ladder, radius tokens, semantic colors, motion tokens to `index.css` + `tailwind.config.js` | 1–2 hrs | Invisible on its own — sets up everything that follows |
| **1 — Global primitives** | `Button`, `Card`, `Skeleton`, `Icon` components + global focus ring + shimmer animation + dark-mode default | 2–3 hrs | Hover/press/tab feel noticeably tighter everywhere |
| **2 — Learner + auth passes** | Login, Register, GradeHub, QuizList, LessonLibrary, QuizResults — apply new primitives, refine hierarchy, tune motion | 3–4 hrs | Main learner journey feels polished |
| **3 — Admin/teacher + internal** | AdminLayout, TeacherLayout, AdminDashboard, TeacherDashboard, ManageContent — icon swap, stagger animations, tightened spacing | 2–3 hrs | Internal tools stop feeling like a different app |

**Total: ~8–12 hours of focused work, split into 4 independent PRs.**

---

## Phase 0 — Design tokens

**Where:** `src/index.css`, `tailwind.config.js`

### Typography
- Add `font-display` (Outfit) and `font-body` (Nunito) to Tailwind `fontFamily`. Keep `font-sans` → Nunito for safe default.
- Add headline utility classes to `@layer components`:
  - `.text-display-2xl` → `font-display font-black text-5xl leading-[1.05] tracking-tight`
  - `.text-display-xl` → `font-display font-black text-4xl leading-[1.1] tracking-tight`
  - `.text-display-lg` → `font-display font-black text-3xl leading-[1.15] tracking-tight`
  - `.text-display-md` → `font-display font-extrabold text-2xl leading-[1.2] tracking-tight`
  - `.text-body-lg` / `.text-body` / `.text-body-sm` — Nunito, `leading-[1.6]`, no tracking.
  - `.text-eyebrow` → `font-display font-black text-[11px] uppercase tracking-[0.12em]`

### Shadow ladder
Replace the single `theme-shadow` with four levels:

```css
:root, body.theme-* {
  --shadow-sm:  0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
  --shadow-md:  0 2px 4px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-lg:  0 4px 6px rgba(15, 23, 42, 0.05), 0 10px 28px rgba(15, 23, 42, 0.1);
  --shadow-xl:  0 12px 24px rgba(15, 23, 42, 0.08), 0 24px 48px rgba(15, 23, 42, 0.12);
  --shadow-inner-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
body.theme-midnight {
  /* deeper, cooler shadows for dark mode */
  --shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md:  0 2px 6px rgba(0, 0, 0, 0.4), 0 8px 16px rgba(0, 0, 0, 0.3);
  --shadow-lg:  0 6px 16px rgba(0, 0, 0, 0.5), 0 16px 32px rgba(0, 0, 0, 0.35);
  --shadow-xl:  0 16px 40px rgba(0, 0, 0, 0.6);
  --shadow-inner-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.shadow-elev-sm { box-shadow: var(--shadow-sm); }
.shadow-elev-md { box-shadow: var(--shadow-md); }
.shadow-elev-lg { box-shadow: var(--shadow-lg); }
.shadow-elev-xl { box-shadow: var(--shadow-xl); }
.shadow-elev-inner-hl { box-shadow: var(--shadow-inner-highlight); }
```

### Radius tokens
```css
--radius-xs: 6px;   /* inputs, small chips */
--radius-sm: 10px;  /* buttons, compact cards */
--radius-md: 16px;  /* standard card */
--radius-lg: 24px;  /* hero card, modal */
--radius-xl: 32px;  /* feature card, upgrade modal */
--radius-pill: 999px;
```

Then `.rounded-card { border-radius: var(--radius-md); }` etc. — so a future radius change is one line, not 40.

### Semantic color tokens
Add to each theme block:
```css
--success:       #15803D;
--success-bg:    #DCFCE7;
--success-fg:    #166534;
--warning:       #D97706;
--warning-bg:    #FEF3C7;
--warning-fg:    #92400E;
--danger:        #DC2626;
--danger-bg:     #FEE2E2;
--danger-fg:     #991B1B;
--info:          #2563EB;
--info-bg:       #DBEAFE;
--info-fg:       #1E40AF;
```

### Motion tokens
```css
--ease-out:      cubic-bezier(0.16, 1, 0.3, 1);     /* smooth deceleration */
--ease-in-out:   cubic-bezier(0.65, 0, 0.35, 1);    /* symmetric */
--ease-spring:   cubic-bezier(0.175, 0.885, 0.32, 1.275);
--duration-fast: 150ms;
--duration-base: 220ms;
--duration-slow: 400ms;
```

### New animations
Add shimmer + stagger primitives:
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.animate-shimmer {
  background: linear-gradient(90deg, var(--bg-subtle) 0%, var(--card-hover) 50%, var(--bg-subtle) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}

@keyframes press {
  0% { transform: scale(1); }
  50% { transform: scale(0.96); }
  100% { transform: scale(1); }
}
.animate-press { animation: press 180ms var(--ease-out); }
```

**Acceptance:** `npm run build` still passes; nothing visibly changes yet because we haven't used the new tokens.

---

## Phase 1 — Global primitives

**Where:** new components in `src/components/ui/` + one-line imports across the app.

### 1A — `Button` component (30 min)
`src/components/ui/Button.jsx` — single source of truth.
- Variants: `primary` (filled accent), `secondary` (bordered), `ghost` (transparent), `danger`.
- Sizes: `sm`, `md`, `lg`.
- Props: `leadingIcon`, `trailingIcon`, `loading`, `disabled`, `fullWidth`.
- Behavior: uses `focus-visible:ring` + `hover:-translate-y-0.5` + `active:animate-press`.
- **Migration strategy:** introduce alongside existing buttons, no forced migration. Individual surfaces adopt it as they get polished.

### 1B — `Card` component (15 min)
- Variants: `flat` (just bordered), `elevated` (shadow-elev-md), `hero` (gradient bg).
- Sizes: `sm`, `md`, `lg` (different padding/radius).
- Optional `interactive` prop adds hover lift.

### 1C — `Skeleton` / `Shimmer` components (20 min)
Replace the 6 places that use `animate-pulse` with `<Skeleton />`. Shimmer sweep > pulse flash.

### 1D — Global focus ring (10 min)
In `index.css`:
```css
*:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  border-radius: 6px;
}
```
Immediate a11y + premium win — every keyboard tab stop now glows the brand color.

### 1E — Lucide icon wrapper (20 min)
`src/components/ui/Icon.jsx` — wraps `lucide-react` with consistent sizing (`xs/sm/md/lg`) and stroke width. Keeps emoji viable as *accent* (reactions, celebrations, Pako) while freeing nav/toolbar/admin chrome to use SVG.

### 1F — System dark-mode detection (10 min)
In `ThemeContext.jsx`, if `localStorage` has no theme yet, check `window.matchMedia('(prefers-color-scheme: dark)')` and default to `midnight` if the OS is dark. Subsequent manual choices still win.

**Acceptance:** `npm run build` passes. Storybook-style test: open any page, tab through — every focusable element shows a visible ring. Open a loading state — shimmer, not pulse.

---

## Phase 2 — Learner + auth surfaces

### 2A — Login (20 min)
Already solid. Only touches:
- Replace inline button with `<Button variant="primary" size="lg" fullWidth>`.
- Use `.text-display-lg` for "Welcome back!"
- Subtle: swap the 📬 success emoji for a `<Icon name="Mail" />` circled badge.

### 2B — Register (30 min)
- Same button swap.
- Teacher-verification fields: wrap inputs in a card with `shadow-elev-sm` + internal `py-4` breathing room.
- Progressive disclosure feel: fade-in the teacher fields with `animate-slide-up` when `wantsTeacherAccess` flips.

### 2C — Navbar (40 min) — **biggest visible win**
- Swap emoji nav icons for `<Icon name="Home/BookOpen/Pencil/FileText/BarChart" />`.
- Keep emoji badge on the user avatar as celebration accent (e.g., 🎓 when teacher-verified).
- Staggered mobile-drawer entrance: each nav item gets `animationDelay: ${i * 40}ms`.
- Darken sticky shadow to `shadow-elev-md` with `backdrop-blur-md` for a "glass" feel when scrolling under content.

### 2D — GradeHub (30 min)
Already close. Changes:
- "🎓 Primary Hub" heading becomes `<h1 className="text-display-xl">` with an inline Icon badge next to it (not replacing emoji — pairing them).
- Recent Activity empty state: larger Pako illustration + warmer copy.
- Badge cards: add `interactive` on hover — `translate-y-[-2px]` + `shadow-elev-lg`.

### 2E — QuizList (30 min)
- Quiz cards: tighten the left accent border (`border-l-4`) to use the subject-specific accent token, not a hardcoded Tailwind gray.
- Filter chips: use the new `--radius-pill` token; active chip gets `shadow-elev-sm` + `shadow-inner-highlight`.
- Skeleton → shimmer variant.

### 2F — QuizResultsV2 (30 min)
- Score circle animation: extend the 1s stroke-dashoffset to include a gentle scale-in from `0.9 → 1.0` for the circle group, timed with the stroke.
- Result row: swap `animate-pulse` progress indicator for shimmer.
- Celebration state (passed): overlay confetti burst using the existing `animate-star-burst` + ~6 positioned stars.

### 2G — MyResults (15 min)
Quick-win-only pass from the audit:
- `border theme-border shadow-elev-sm` on summary stat cards.
- `transition-all` on result-row buttons.
- `gap-2` instead of `gap-1.5` on badge row.

### 2H — LessonLibrary / LessonPlayer (30 min)
- Library card: `transition-all duration-base` + hover lift.
- Player: slide transitions use `animate-fade-in` on the incoming slide, `opacity: 0` on the outgoing.

**Acceptance:** walk through the full learner flow (login → GradeHub → QuizList → run quiz → results → lessons) and the interaction feels consistent. Focus ring visible at every tab stop.

---

## Phase 3 — Admin / teacher surfaces

### 3A — AdminLayout + TeacherLayout (45 min)
- Sidebar icons: full emoji → Lucide swap. Map:
  - 📊 Dashboard → `BarChart3`
  - ▦ Lessons → `Presentation`
  - 📖 Create Lesson → `BookOpen`
  - ✏️ Create Quiz → `PencilLine`
  - 📤 Upload Paper → `Upload`
  - 📁 Manage Content → `FolderOpen`
  - 🔔 Approvals → `BellRing`
  - 🧑‍🏫 Teacher Apps → `GraduationCap`
  - 📈 Results → `TrendingUp`
  - 💳 Payments → `CreditCard`
  - 🚪 Sign Out → `LogOut`
- Active item: left border → accent + soft `shadow-elev-inner-hl`.
- Mobile drawer: staggered entry (+ 30 ms each item).

### 3B — AdminDashboard + TeacherDashboard (30 min)
- Stat cards: consistent `shadow-elev-md`, `rounded-card-lg`.
- Trending indicators (↑ ↓) become small Lucide `TrendingUp`/`TrendingDown` badges.
- Add a "Last updated • 3 min ago" eyebrow to the dashboard — signals the data is live.

### 3C — ManageContent + CreateQuiz + LessonEditor (45 min)
- Tab bar uses `radius-pill` chips with `shadow-elev-inner-hl` active state.
- Action buttons (Publish, Save Draft, Delete) adopt `<Button variant="primary/secondary/danger">`.
- Confirm-delete modals: dedicated `ConfirmDialog` primitive with Escape-to-cancel and focus trap.

**Acceptance:** admin + teacher internal tools feel like the same product as the learner side. Nav and toolbar are SVG-first with emoji as accent.

---

## What I recommend we do first

**Ship Phase 0 + 1D + 1F alone first** (tokens + focus ring + dark-mode default). That's ~2 hours, zero visible breakage, and every subsequent phase builds cleanly on top. The focus ring alone will make the app feel tighter immediately.

Then **Phase 1 (rest) + Phase 2A + 2C + 2D** — `Button` primitive, `Card` primitive, Login polish, Navbar icon swap, GradeHub headline refinement. ~3 hours, largest per-hour user-visible impact.

Then pause, screenshot the before/after, decide whether to push through Phase 2 completion and Phase 3 or stop.

---

## What I'm deliberately *not* suggesting

- **Removing emoji entirely.** The audience is K–7 in Zambia. Emoji is part of the product's warmth — we're replacing *chrome* emoji (nav), keeping *personality* emoji (Pako, celebrations, subject badges).
- **A full design system package like Radix/shadcn.** Adds bundle weight and migration cost for a solo-maintained app. The primitives above live in `src/components/ui/` and that's enough.
- **Replacing the theme system.** It works, the user already has 5 themes. Phase 0 adds to it, doesn't replace.
- **A new animation library.** Framer Motion would add ~40 kB gz. The CSS keyframes already cover 90% of what we need.
