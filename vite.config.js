// vite.config.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'  // ← Import here
import { r2PublicBase } from './r2public.js'

// Same server/.env the upload route reads. Only the public origin is
// written into the page. Keys and the bucket name stay out of the bundle.
const rootDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(rootDir, 'server', '.env') })

// Optional local HTTPS. WalletConnect accepts https or localhost.
// The cert files stay on this machine and are gitignored, so a fresh
// clone runs plain http on localhost instead of failing at startup.
const certFile = './certs/server.crt'
const keyFile = './certs/server.key'
const https = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: certFile, key: keyFile }
  : undefined

// Dev serves index.html from Vite, so the page gets the same origin the
// upload route will return. Production overwrites this from the live const.
function r2PublicBasePage() {
  return {
    name: 'r2-public-base',
    transformIndexHtml(html) {
      const tag = `<script>globalThis.__R2_PUBLIC_BASE=${JSON.stringify(r2PublicBase())};</script>`
      return html.replace('</head>', `${tag}</head>`)
    },
  }
}

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

// A VITE_ name is inlined into the browser bundle. Fail the build when one
// looks like a server secret so an R2 key, token, or password cannot ship.
function assertPublicViteEnv(names) {
  const blocked = ['R2_', 'SECRET', 'ACCESS_KEY', 'PRIVATE', 'API_KEY', 'TOKEN', 'PASSWORD', 'ENCRYPTION_KEY']
  for (const name of names) {
    if (!name.startsWith('VITE_')) continue
    const upper = name.toUpperCase()
    if (blocked.some((part) => upper.includes(part))) {
      throw new Error(`Refusing to build: ${name} looks like a secret and must not be exposed to the browser`)
    }
  }
}

// Polyfill only Buffer (and process if needed for SDK). The page and the
// ES decrypt worker share this. protocolImports covers 'buffer:' imports.
const polyfillOptions = {
  globals: {
    Buffer: true,
    global: true,
    process: true,
  },
  protocolImports: true,
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const fromFiles = loadEnv(mode, process.cwd(), 'VITE_')
    assertPublicViteEnv(new Set([...Object.keys(fromFiles), ...Object.keys(process.env)]))
  }
  return {
  plugins: [
    r2PublicBasePage(),
    pwaHeaders(),
    nodePolyfills(polyfillOptions),
    // Add any other plugins you have (e.g. react())
  ],
  // The decrypt worker imports e2eemedia.js, which awaits libsodium at
  // the top level. IIFE cannot emit that. ES keeps the module worker,
  // and the same polyfills run inside it.
  worker: {
    format: 'es',
    plugins: () => [nodePolyfills(polyfillOptions)],
  },
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
  }
})
