# AGENT.md — cómo trabajar en este repo

- Stack: Vite 6 + TypeScript vanilla (strict) + pdfjs-dist 4. Interfaz exigida: `docs/CONTRACT.md`. Requisitos: `MUST_HAVES.md` (MH-9 y MH-16 fuera).
- Instalar: `npm install`. Typecheck: `npx tsc --noEmit`. Build: `npx vite build`. Dev: `npx vite`.
- Tests de aceptación (oráculo): `~/.musthave/fast-reading/oracle/bin/check.sh MH-XX [MH-YY…]` desde la raíz del repo. Copia los tests a `.oracle/` (ignorado por git) y los ejecuta.
  - Unitarios: Vitest, entorno node, alias `@` → `src/`. El libro real está en `.oracle/fixtures/book.pdf`.
  - E2E: Playwright contra `vite build && vite preview` en el puerto 4173.
- pdf.js en Node (Vitest): `pdfjs-dist/legacy/build/pdf.mjs`. En el navegador: worker con import dinámico.
- Decisiones de producto pendientes: `decisions/<MH>.md`. Respondidas: `decisions/answered/`.

## Notas aprendidas
