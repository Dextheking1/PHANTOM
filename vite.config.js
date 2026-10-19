import { defineConfig } from 'vite';
import process from 'node:process';

// A UI preview still needs the real backend; never serve /api as static files.
const backend = process.env.PHANTOM_API_ORIGIN || 'http://127.0.0.1:1337';
const proxy = {
  '/api': { target: backend, changeOrigin: true },
  '/ws': { target: backend, ws: true },
};

export default defineConfig({
  root: 'frontend',
  cacheDir: process.env.PHANTOM_VITE_CACHE_DIR,
  server: {
    port: 5173,
    proxy,
  },
  preview: { proxy },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html'
      },
    },
  }
});
