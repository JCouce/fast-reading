import { defineConfig } from 'vite';

// El worker carga pdf.js con import dinámico: necesita salida ES (IIFE no admite code-splitting).
export default defineConfig({
  worker: { format: 'es' },
});
