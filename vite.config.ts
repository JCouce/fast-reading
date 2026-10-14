import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: sirve igual en la subruta de GitHub Pages (/fast-reading/) que en la raíz (preview, e2e).
  base: './',
  // El worker carga pdf.js con import dinámico: necesita salida ES (IIFE no admite code-splitting).
  worker: { format: 'es' },
});
