import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          const normalizedId = id.replace(/\\/g, '/')

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
          if (normalizedId.includes('/node_modules/firebase/')) return 'firebase-vendor'
          // Let Vite auto-split @tiptap and katex — they are dynamically imported
          if (
            normalizedId.includes('/node_modules/@tiptap/') ||
            normalizedId.includes('/node_modules/katex/') ||
            normalizedId.includes('/node_modules/prosemirror/')
          ) {
            return undefined
          }
          return 'vendor'
        },
      },
    },
  },
})
