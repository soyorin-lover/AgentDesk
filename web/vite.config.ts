import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// v1.html 保留旧版原型，便于与新样稿对比
export default defineConfig({
  plugins: [react()],
  server: { port: 5273, strictPort: false, open: false },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: { input: { main: 'index.html', v1: 'v1.html' } },
  },
});
