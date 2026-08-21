import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import colorMixFallback from './scripts/lib/colorMixFallback.mjs'

export default {
  plugins: [
    tailwindcss(),
    autoprefixer(),
    // LAST, so it also covers the declarations Tailwind generates. It gives
    // every `color-mix()` a fallback for the Android WebViews below Chrome
    // 111 this product actually runs on — without one, a dropped declaration
    // takes the whole surface with it (the teacher dock and mobile drawer
    // both rendered as invisible white-on-white). See the module header.
    colorMixFallback(),
  ],
}
