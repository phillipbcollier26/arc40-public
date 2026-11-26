import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev mode: `npm run dev:server` + `npm run dev:web`, then open http://127.0.0.1:5173
export default defineConfig({
  root: 'web',
  plugins: [react()],
  // assetsInlineLimit 0: never inline fonts/images as data: URLs (the CSP only allows files served by Arc40).
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4040' },
  },
});
