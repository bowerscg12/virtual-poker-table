import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiPort = process.env.GAME_SERVER_PORT ?? '3003';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Home Game',
        short_name: 'Home Game',
        description: 'Poker night with friends — chips, deals, and settling up, handled.',
        theme_color: '#0d5c2e',
        background_color: '#0a3d1f',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: {
    port: parseInt(process.env.PORT ?? '5173', 10),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
});
