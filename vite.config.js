// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      // external: ['@hashgraph/proto']   ← COMMENT or REMOVE this line
      // or keep if you want to externalize others, but remove proto
    }
  }
})