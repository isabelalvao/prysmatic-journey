import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: 'localhost', port: 5180 },
  preview: { host: 'localhost', port: 5181 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
