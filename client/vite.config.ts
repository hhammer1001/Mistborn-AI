import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' = service worker installs silently, but we drive the
      // "new version available, click to reload" UI ourselves so the user
      // never gets surprised by a forced reload mid-game.
      registerType: 'prompt',
      // Auto-cache static assets (HTML, JS, CSS, icons, card art under
      // /cards, /ministry, /icons.svg) so the app loads cold offline.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,woff2,json}'],
        // Card art folder can be sizeable; bump from the 2 MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Mistborn: Card Game',
        short_name: 'Mistborn',
        description: 'Mistborn deckbuilding game.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5200,
    allowedHosts: true,
  },
})
