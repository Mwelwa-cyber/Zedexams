import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The previous 500 kB warning was firing on the catch-all vendor chunk;
    // with the split below the largest shipped chunk is ~300 kB gzipped (pdf
    // worker is excluded — it's loaded on demand by past-paper viewing only).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          const normalizedId = id.replace(/\\/g, '/')

          // Loaded lazily, only when learners view a past paper.
          if (normalizedId.includes('pdfjs-dist')) return 'pdfjs'

          // Keep the React chunk limited to the core React runtime packages.
          // Packages like @tiptap/react also include "/react" in their path and
          // must stay out of this bucket or Rollup creates a circular vendor split.
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          if (normalizedId.includes('/node_modules/react-router')) return 'router-vendor'
          if (normalizedId.includes('/node_modules/firebase/')) return 'firebase-vendor'

          // Icons are used across almost every page but are relatively small;
          // keep them in their own chunk so the main vendor bundle doesn't
          // re-download them when other deps change.
          if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons-vendor'

          // DOMPurify + fflate are only used inside the authoring flows.
          if (normalizedId.includes('/node_modules/dompurify/')) return 'sanitize-vendor'
          if (normalizedId.includes('/node_modules/fflate/')) return 'fflate-vendor'

          // Let Vite auto-split @tiptap, katex, and prosemirror — they are
          // already reached via dynamic imports from the editor routes.
          if (
            normalizedId.includes('/node_modules/@tiptap/') ||
            normalizedId.includes('/node_modules/katex/') ||
            normalizedId.includes('/node_modules/prosemirror')
          ) {
            return undefined
          }

          return 'vendor'
        },
      },
    },
  },
})
