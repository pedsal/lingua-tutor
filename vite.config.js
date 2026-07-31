import { defineConfig } from 'vite';

// base './' => l'app funziona anche servita da una sottocartella o dal file system.
export default defineConfig({
  base: './',
  server: { port: 5174, open: true },
  build: { target: 'es2020', outDir: 'dist' },
});
