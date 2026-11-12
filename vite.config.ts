/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TT Analyzer',
        short_name: 'TT Analyzer',
        description: 'Análise de jogos de tênis de mesa pela câmera do celular, direto no navegador.',
        lang: 'pt-BR',
        start_url: '.',
        scope: '.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        // MediaPipe (≈ 20 MB) só baixa quando a pose é ligada; depois fica guardado
        globIgnores: ['mediapipe/**', 'models/**'],
        runtimeCaching: [
          {
            urlPattern: /\/(mediapipe|models)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'tt-pose', expiration: { maxEntries: 12 } },
          },
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
