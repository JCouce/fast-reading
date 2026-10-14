# Progreso

- MH-07: `normalizeText` en `src/ingest/normalize.ts` (NFC + mapa propio de ligaduras U+FB00–FB06 + quita U+00AD). Aún no está enganchado a `extractBook` (eso va con MH-3/4/5).
- MH-10: `tokenize` en `src/core/tokenize.ts` (split por espacios + `sentenceEnd`). Reglas: terminal `. … ! ?` (ignorando cierres `» ) "`); nunca fin si la siguiente empieza en minúscula; el punto no cierra tras abreviatura de la lista, inicial (`J.`) o sigla doblada (`EE.`, `UU.`). Raro: `etc.` + mayúscula SÍ cuenta como fin (decisión mía, el oráculo solo prueba con minúscula); una frase que acabe en letra suelta (`vitamina A. Luego`) no se corta. Falta el pegado de `¿ ¡ « ( –` (MH-11) y `splitLong` (MH-12).

