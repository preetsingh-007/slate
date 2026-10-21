import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Strict Content Security Policy for the built app. The app contacts only GitHub and the
 * fetch helper; snapshots render in sandboxed frames. Not applied in dev, where Vite injects
 * inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        globIgnores: ['pdfjs/**'],
        navigateFallbackDenylist: [/\/pdfjs\//],
        runtimeCaching: [
          {
            // pdf.js CMaps, standard fonts and wasm: fetched on demand, then available offline
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 500 } },
          },
        ],
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
