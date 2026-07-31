import { defineConfig } from 'vite';

// base './' => l'app funziona anche servita da una sottocartella o dal file system.
// Le porte rispettano la variabile PORT (assegnata dall'harness con autoPort);
// i valori fissi restano solo come fallback per l'uso manuale.
const PORT = Number(process.env.PORT) || undefined;

export default defineConfig({
  base: './',
  server: { port: PORT || 5174 },
  preview: { port: PORT || 4173 },
  build: { target: 'es2020', outDir: 'dist' },
});
