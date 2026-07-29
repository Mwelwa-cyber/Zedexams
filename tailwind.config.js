/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Dark mode is driven by the app's own theme-* CSS variable system (not
  // OS preference). Setting this to 'class' means Tailwind's dark: variant
  // only activates when an ancestor has the `dark` class — preventing
  // unintended dark styling on marketing pages for visitors whose OS
  // prefers dark mode.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Plus Jakarta Sans', 'Nunito', 'sans-serif'],
        // Phase 0 — display font for headlines, body for reading copy
        display: ['Outfit', 'Plus Jakarta Sans', 'sans-serif'],
        body:    ['Plus Jakarta Sans', 'Nunito', 'sans-serif'],
      },
      colors: {
        // ── Teacher workspace theme tokens ──────────────────────────────
        // Backed by the --zt-* custom properties defined in src/index.css
        // and switched by `data-theme` on <html>. Writing `bg-sidebar` or
        // `text-ink-muted` is how a teacher component opts into theming;
        // nothing here has a fixed value, so all four themes work through
        // the same class with no per-theme variants.
        //
        // Scope: these are TEACHER tokens. The 6 learner palettes are a
        // separate system (body.theme-* + the `theme-*` utility classes in
        // index.css) and are untouched by these — see teacherThemeCore.js
        // for why the two token sets cannot share names.
        sidebar: 'var(--zt-sidebar-bg)',
        'sidebar-text': 'var(--zt-sidebar-text)',
        'sidebar-muted': 'var(--zt-sidebar-muted)',
        surface: 'var(--zt-surface)',
        card: 'var(--zt-card)',
        // Strong outline. For hairlines/dividers/input edges use `line` —
        // see the note in teacherThemeCore.js.
        'card-border': 'var(--zt-card-border)',
        line: 'var(--zt-line)',
        accent: 'var(--zt-accent)',
        'accent-deep': 'var(--zt-accent-deep)',
        // The accent used AS text on a page/card background. `accent` is a
        // fill and is not guaranteed readable as small text — see the note
        // in teacherThemeCore.js.
        'accent-text': 'var(--zt-accent-text)',
        'on-accent': 'var(--zt-on-accent)',
        // Pale accent wash behind selected/highlighted panels. Mixed into
        // the CARD colour rather than white, so it stays a light tint on the
        // light themes and becomes a dark tint on Night instead of a white
        // box. Opacity modifiers (`bg-accent/12`) cannot do this: these
        // colours are bare var() references, which Tailwind cannot inject an
        // alpha channel into.
        'accent-tint': 'color-mix(in srgb, var(--zt-accent) 12%, var(--zt-card))',
        ink: 'var(--zt-text)',
        'ink-muted': 'var(--zt-text-muted)',
        banner: 'var(--zt-banner-bg)',
        'banner-border': 'var(--zt-banner-border)',
        'banner-text': 'var(--zt-banner-text)',

        zambia: {
          green:  '#2E7D32',
          gold:   '#F9A825',
          red:    '#B71C1C',
          black:  '#212121',
        },
        // ZedExams brand orange. This REPLACES Tailwind's stock `orange`
        // scale, so the ~350 existing `bg-orange-500` / `text-orange-700`
        // utilities pick up the brand ramp without being rewritten one by
        // one — and a new one written by habit lands on brand too.
        //
        // The ramp is Tailwind's own orange rotated -7° in hue with
        // saturation at 0.63×, which is exactly the transform that takes
        // stock orange-500 (#f97316) to the brand terracotta (#d97757).
        // Lightness is held, so every step keeps its position in the ramp
        // and no step loses contrast against the sheet — each one gains
        // some (500: 2.80:1 → 3.12:1, 700: 5.18:1 → 6.22:1 on white).
        //
        // Amber and gold are a SEPARATE palette (warnings, the learner-home
        // accents, the Zambia flag gold above) and are deliberately not
        // rotated with this one.
        orange: {
          50:  '#fcf7f3',
          100: '#f8eadf',
          200: '#efd1bc',
          300: '#e4b190',
          400: '#d88962',
          500: '#d97757',  // the brand orange
          600: '#c5613f',  // hover / pressed
          700: '#a3422e',
          800: '#83372c',
          900: '#6b3026',
          950: '#3a1713',
        },
      },
      keyframes: {
        'scale-in':      { '0%': { opacity: 0, transform: 'scale(0.92)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
        'slide-up':      { '0%': { opacity: 0, transform: 'translateY(16px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'fade-in':       { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        // Phase 0 — shimmer sweep + press feedback
        'shimmer':       { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
        'press':         { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(0.96)' } },
        'slide-in-soft': { '0%': { opacity: 0, transform: 'translateY(10px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: {
        'scale-in':      'scale-in 0.22s ease-out',
        'slide-up':      'slide-up 0.25s ease-out',
        'fade-in':       'fade-in 0.3s ease-out',
        'shimmer':       'shimmer 1.4s linear infinite',
        'press':         'press 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-soft': 'slide-in-soft 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
}
