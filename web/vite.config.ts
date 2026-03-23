import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        agent: path.resolve(__dirname, 'agent-window.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['swisseph-wasm'],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/ib': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ib/, ''),
        // Disable buffering for SSE streams
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['X-Accel-Buffering'] = 'no';
              proxyRes.headers['Cache-Control'] = 'no-cache';
            }
          });
        },
      },
      '/chart': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/agent/': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
        // Disable buffering for SSE streams (agent chat)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['X-Accel-Buffering'] = 'no';
              proxyRes.headers['Cache-Control'] = 'no-cache';
            }
          });
        },
      },
      '/astro': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
    },
  },
});
