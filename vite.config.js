// vite.config.js
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'  // ← Import here

export default defineConfig({
  plugins: [
    nodePolyfills({
      // Polyfill only Buffer (and process if needed for SDK)
      globals: {
        Buffer: true,
        global: true,  // Optional but good for SDK compat
        process: true  // For process.env.NODE_ENV etc.
      },
      protocolImports: true  // For any 'buffer:' imports
    }),
    // Add any other plugins you have (e.g. react())
  ],
  // ...rest of your config (build.rollupOptions etc.)
})