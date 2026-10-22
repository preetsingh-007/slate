import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The snapshot frame's bootstrap script hash (public/snapshot.html, kept current by
 * scripts/snapshot-csp.mjs). The frame is a srcdoc document, so the app's CSP applies to it as
 * well as its own: the app allows this one script and the frame's blob: resources, while the
 * frame's own CSP still allows no network.
 */
const snapshotScript = /script-src ('sha256-[^']+')/.exec(readFileSync(new URL('./public/snapshot.html', import.meta.url), 'utf8'))?.[1];
if (!snapshotScript) throw new Error('public/snapshot.html has no script hash: run node scripts/snapshot-csp.mjs');

/**
 * Strict Content Security Policy for the built app. The app contacts only GitHub and the
 * fetch helper; snapshots render in sandboxed frames. Not applied in dev, where Vite injects
 * inline scripts.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${snapshotScript} blob:`,
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' https://api.github.com https://*.workers.dev blob: data:${process.env.SLATE_E2E ? ' http://localhost:*' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = () => ({
  name: 'slate-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<!-- csp: injected at build time, see vite.config.ts -->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  define: process.env.SLATE_E2E ? { 'import.meta.env.VITE_SLATE_E2E': '"1"' } : {},
  plugins: [
    react(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Slate',
        short_name: 'Slate',
        description: 'An infinite canvas for study work, with a library, synced to your gym repository.',
        theme_color: '#1f2328',
        background_color: '#fbfaf7',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Offline NFR: everything the app can need without the network is precached on the first
        // visit, including all of pdf.js's CMaps, standard fonts, wasm decoders and ICC profiles
        // (about 4 MB): a book first opened offline may need any of them.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}', 'pdfjs/**/*.{bcmap,pfb,ttf,wasm,icc}'],
        navigateFallbackDenylist: [/\/pdfjs\//],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, host: true },
});
