/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Nunito', 'sans-serif'],
        // Phase 0 — display font for headlines, body for reading copy
        display: ['Outfit', 'Nunito', 'sans-serif'],
        body:    ['Nunito', 'sans-serif'],
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
