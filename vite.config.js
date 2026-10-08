// vite.config.js
import fs from 'node:fs'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'  // ← Import here

// Optional local HTTPS. WalletConnect accepts https or localhost.
// The cert files stay on this machine and are gitignored, so a fresh
// clone runs plain http on localhost instead of failing at startup.
const certFile = './certs/server.crt'
const keyFile = './certs/server.key'
const https = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: certFile, key: keyFile }
  : undefined

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
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https,
    // Backend rides the app's own origin — no CORS, no mixed content,
    // and the app code never hardcodes the VPS IP.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  },
  // preview mirrors server so `npm run preview` behaves like dev
  // (HTTPS when certs exist + /api proxy to the topic backend)
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  }
})