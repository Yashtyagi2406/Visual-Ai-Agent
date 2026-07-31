import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// https://crxjs.dev/vite-plugin
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  // Vite 5 compat — crxjs needs this to handle service worker chunks
  build: {
    rollupOptions: {
      // Prevent crxjs from tree-shaking chrome.* globals
      output: {
        manualChunks: undefined,
      },
    },
  },
});
