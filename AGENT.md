# AGENT.md — cómo trabajar en este repo

- Stack: Vite 6 + TypeScript vanilla (strict) + pdfjs-dist 4. Interfaz exigida: `docs/CONTRACT.md`. Requisitos: `MUST_HAVES.md` (MH-9 y MH-16 fuera).
- Instalar: `npm install`. Typecheck: `npx tsc --noEmit`. Build: `npx vite build`. Dev: `npx vite`.
- Tests de aceptación (oráculo): `~/.musthave/fast-reading/oracle/bin/check.sh MH-XX [MH-YY…]` desde la raíz del repo. Copia los tests a `.oracle/` (ignorado por git) y los ejecuta.
  - Unitarios: Vitest, entorno node, alias `@` → `src/`. El libro real está en `.oracle/fixtures/book.pdf`.
  - E2E: Playwright contra `vite build && vite preview` en el puerto 4173.
- pdf.js en Node (Vitest): `pdfjs-dist/legacy/build/pdf.mjs`. En el navegador: worker con import dinámico.
- Decisiones de producto pendientes: `decisions/<MH>.md`. Respondidas: `decisions/answered/`.

## Notas aprendidas
- `tsconfig` tiene `noUncheckedIndexedAccess`: `s[i]` es `string | undefined`; usa `s.charAt(i)`.
- `check.sh` cuenta los tests saltados como FALLA. Los `[G]` se saltan si no existe `RSVP_BOOK` (ruta al libro, p. ej. `.oracle/fixtures/book.pdf`).
- pdf.js con este libro: `getTextContent` devuelve un item por carácter (los espacios son items `" "` de ancho 0) y `hasEOL` en un item vacío al cambiar de renglón. `PasswordException` no se exporta: compárala por `err.name`. `getDocument` transfiere el buffer: pásale `bytes.slice()`.
- `extract.ts` separa la lectura de pdf.js (`readLines` → `Line {page, x, y, size, font, text}`) de `linesToBook`: ahí van párrafos (MH-5) y títulos (MH-6).
- Para inspeccionar renglones: un test temporal en `.oracle/tests/unit/` que llame a `extractLines` y vuelque `page x y size font text`, ejecutado con `npx vitest run --config .oracle/vitest.config.mjs <fichero>`. Layout del libro: cuerpo 20 pt a x=35, interlineado 23, hueco entre párrafos 43, citas en bloque a x=75, títulos 40 pt centrados en varios renglones.
- Fuentes del libro: `g_d0_f1` cuerpo (y títulos del apéndice), `f2` subtítulos y capítulos, `f3` cursiva (también dentro del cuerpo: por eso la vía de fuente exige bloque aislado), `f4` cajas de "Estrategia del cerebro pleno". Para volcar, el test temporal escribe a `.oracle/*.txt`: escribir a `/tmp` o con heredoc lo bloquea el modo de permisos (crea el test con Write).
- El alias `@/` solo existe en Vitest; `tsc` no lo resuelve. En `src/` importa con rutas relativas.
