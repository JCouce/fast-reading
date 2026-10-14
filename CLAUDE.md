# CLAUDE.md — lector RSVP (fast-reading)

App web 100 % en cliente: abres un PDF, se extrae el texto con pdf.js en un Web Worker, se cachea en IndexedDB y se lee palabra a palabra alineada por el ORP (letra pivote fija en pantalla).

Estado: v1 terminada. Todos los must-haves pasan salvo MH-9 y MH-16, que quedaron fuera de alcance.

## Uso

```sh
npm install
npm run dev         # http://localhost:5173
npm run build       # tsc --noEmit + vite build → dist/
npm run preview     # sirve dist/ en :4173 (strictPort)
npm run typecheck
```

En la app:
- **Abrir PDF**: se valida por cabecera (`%PDF-`), no por extensión. La primera vez se extrae en un Worker; las siguientes sale de la caché (clave = SHA-256 del contenido + `PARSER_VERSION`).
- **Espacio**: play/pausa. **↑/↓**: ±25 WPM (100–1000, 300 por defecto).
- También se puede arrastrar el PDF a la ventana; − / + en el dock cambian la velocidad.
- En pausa se despliega un panel con el párrafo (palabra resaltada), capítulo y tiempo restante.
- Botón de tema en la cabecera: sistema → claro → oscuro, guardado en `localStorage` (`theme`).
- Al recargar se abre el último libro en la palabra y WPM donde lo dejaste.
- Se pausa sola al ocultar la pestaña; tras una pausa de más de 3 s vuelve al inicio de la frase.

## Estructura

- `src/ingest/`: validación, worker, `extractBook` (pdf.js → `Book`: palabras, párrafos, títulos, listas), normalización y guiones de corte.
- `src/core/`: tokenizado (fin de frase en español, puntuación de apertura, palabras largas), ORP, tiempos (`timing.ts`) y reproductor sin drift (`player.ts`).
- `src/persist/`: clave de caché y store IndexedDB con caída a memoria.
- `src/main.ts`: toda la UI (vanilla, sin framework).
- Docs: `docs/CONTRACT.md` (interfaz pública que exigen los tests), `docs/MUST_HAVES.md` (requisitos), `docs/progress.md` (bitácora por MH con decisiones y rarezas), `docs/decisions/` (decisiones de producto respondidas).

## Tests

Los tests de aceptación no viven en el repo: son un oráculo externo en `~/.musthave/fast-reading/oracle/`.
- `~/.musthave/fast-reading/oracle/bin/check.sh MH-XX [MH-YY…]` desde la raíz. Copia los tests a `.oracle/` (ignorado) y los ejecuta.
- Unitarios: Vitest, entorno node, alias `@` → `src/`. E2E: Playwright contra `vite build && vite preview` en :4173.
- Los `[G]` (golden con el libro real) necesitan `RSVP_BOOK` apuntando al PDF (p. ej. `.oracle/fixtures/book.pdf`); si no, se saltan y `check.sh` lo cuenta como FALLA.
- El libro (`libros/`) tiene copyright: nunca al repo. `.gitignore` ya excluye `libros/` y `*.pdf`.
- Las devDependencies `@playwright/test`, `fake-indexeddb` y `pdf-lib` las usa el oráculo, no el código de `src/`.

## Gotchas

- `tsconfig` tiene `noUncheckedIndexedAccess`: `s[i]` es `string | undefined`; usa `s.charAt(i)`.
- El alias `@/` solo existe en Vitest; `tsc` no lo resuelve. En `src/` importa con rutas relativas.
- pdf.js en Node: `pdfjs-dist/legacy/build/pdf.mjs`. En el navegador: import dinámico dentro del Worker (por eso `vite.config.ts` pone `worker.format: 'es'`).
- `pdf.worker.mjs` importado dentro de un Web Worker se autoengancha a `self` y manda `"ready"` al hilo principal: los mensajes propios van etiquetados (`kind: 'ingest-result'`) y el resto se ignora.
- pdf.js con este libro: `getTextContent` devuelve un item por carácter (espacios como items `" "` de ancho 0) y `hasEOL` en un item vacío al cambiar de renglón. `PasswordException` no se exporta: compárala por `err.name`. `getDocument` transfiere el buffer: pásale `bytes.slice()`.
- `extract.ts` separa la lectura de pdf.js (`readLines` → `Line {page, x, y, size, font, text}`) de `linesToBook` (párrafos y títulos). `extractLines` está exportada para depurar renglones.
- Layout del libro: cuerpo 20 pt a x=35, interlineado 23, hueco entre párrafos 43, citas en bloque a x=75, títulos 40 pt centrados. Fuentes: `g_d0_f1` cuerpo, `f2` subtítulos/capítulos, `f3` cursiva, `f4` cajas de "Estrategia del cerebro pleno".
- Si cambias la extracción o el tokenizado, sube `PARSER_VERSION` en `src/persist/cacheKey.ts` o la caché servirá libros viejos.
- Nada de `main.ts` puede importar `extract.ts`/pdf.js: arrastraría pdf.js al chunk principal y rompería MH-14 en silencio.
- El input de archivo está oculto con `.sr-only` (nunca `display: none`): los e2e le meten archivos aunque haya un libro abierto y MH-33 exige que cada control visible tenga nombre y se pueda enfocar. El contexto se esconde con `grid-template-rows: 0fr` (alto 0 = oculto para Playwright), no con `hidden`, para poder animarlo.
- Tema: `data-theme` en `<html>` lo pone un script inline de `index.html` antes de pintar (si no, parpadea); los tokens oscuros están duplicados en `style.css` a propósito (media query y `[data-theme='dark']`).
- `window.__rsvp` en `main.ts` es un hook para los e2e; no lo quites.
- `check.sh` levanta su propio `vite preview` en 4173: no dejes uno en segundo plano o falla por puerto ocupado.
