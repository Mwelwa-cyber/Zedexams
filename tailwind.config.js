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
        zambia: {
          green:  '#2E7D32',
          gold:   '#F9A825',
          red:    '#B71C1C',
          black:  '#212121',
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
