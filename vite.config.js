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

// The service worker and manifest must not sit in a long cache, or an
// old worker keeps controlling the page after a deploy.
function pwaHeaders() {
  const set = (req, res, next) => {
    const pathOnly = (req.url || '').split('?')[0]
    if (pathOnly === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Service-Worker-Allowed', '/')
    } else if (pathOnly === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
    }
    next()
  }
  return {
    name: 'pwa-headers',
    configureServer(server) {
      server.middlewares.use(set)
    },
    configurePreviewServer(server) {
      server.middlewares.use(set)
    },
  }
}

export default defineConfig({
  plugins: [
    pwaHeaders(),
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
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      // Same live install icons the production server draws.
      '/icons/icon-192.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/icon-512.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/icon-512-maskable.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/apple-touch-icon.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
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
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/icon-192.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/icon-512.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/icon-512-maskable.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/icons/apple-touch-icon.png': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    }
  }
})
