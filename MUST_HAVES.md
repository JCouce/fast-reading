# Must-haves v1 — lector RSVP

App web (Vite + TypeScript vanilla, todo en cliente) que ingesta un PDF con pdf.js en un Web Worker, lo cachea en IndexedDB y lo muestra palabra a palabra alineado por el ORP.

Leyenda: **[U]** test unitario (Vitest) · **[E]** test end-to-end en navegador · **[G]** golden test con el libro real (`libros/1-EL-CEREBRO-DEL-NINO.pdf`); se salta si el PDF no está, porque tiene copyright y no va al repo.

## Ingesta

1. **Solo PDFs.** Se valida por la cabecera del archivo (`%PDF-`), no por la extensión. Lo demás da error sin romper la app. [U]
2. **Errores claros.** Un PDF sin texto, cifrado o corrupto, o un worker que peta, muestra un mensaje. Nunca se queda un spinner infinito. [U]
3. **Extracción completa.** Salen 58.594 palabras ±1 %, sin tokens vacíos ni saltos de línea dentro. [G]
4. **Guiones de corte.** Los 6 reales del libro se resuelven así: `des-⏎integrada` pasa a `desintegrada` y `lucha-⏎huida-inmovilidad` se queda `lucha-huida-inmovilidad`. Regla: se mantiene el guion si el trozo de la derecha ya lleva guion; si no, se une. (La regla "se une si la palabra aparece en el libro" fallaba: `desintegrada` y `sacrificios` no aparecen en otro sitio.) Limitación conocida: un compuesto de dos partes cortado en su guion (`teórico-⏎práctico`) se une; en este libro no ocurre. Las rayas `–` se conservan. [G] + fixture sintético [U]
5. **Párrafos.** Se detectan por el hueco vertical o la sangría. Una frase que cruza de página, o que tiene en medio una página que solo es imagen, no abre párrafo. Se mide con un PDF sintético de solución conocida (sangrías, huecos, frase que cruza de página, página solo imagen): precisión ≥95 % y recall ≥90 % [U]. En el libro real, ningún párrafo empieza en minúscula salvo tres casos legítimos conocidos (portada "y Tina…", `www.WholeBrainChild.com` y `www.albaeditorial.es`) [G].
6. **Títulos.** Se detectan por cambio de fuente, renglón corto y que no acabe en puntuación; el tamaño no sirve, porque es el mismo que el del cuerpo. "APLICACIÓN DE LA ESTRATEGIA" sale 48 veces y "Adentrarse en la corriente… rigidez" es un único título. [G]
7. **Normalización.** Se aplica NFC (las tildes descompuestas pasan a una sola letra) y se arreglan ligaduras y soft hyphens con un mapa propio. No se usa NFKC en todo el texto, porque rompe `n.º`, que debe salir intacto. [U]
8. **Páginas sin texto** (la 1 y la 135): ni rompen ni meten basura. Las viñetas de lista (`·` 37, `•` 12) no salen como palabra: se eliminan y marcan el inicio de un elemento de lista, que lleva pausa (ver 22). Las 6 rayas de inciso que quedan al final de renglón se pegan a la palabra siguiente (ver 11): 0 rayas sueltas. El resto de signos sueltos legítimos (`=`, `+`, `©`, `@`) ≤ 0,5 %. [G]
9. ~~**Sin bloqueos.**~~ *(fuera de esta versión)* Durante la ingesta no hay ninguna tarea de más de 50 ms en el hilo principal (PerformanceObserver `longtask`), y hay barra de progreso. [E]

## Tokenización

10. **Fin de frase en español.** No cuentan como fin de frase `Sr.`, `Dra.`, `etc.`, `p. ej.`, `EE. UU.`, `n.º`, las iniciales `J. R.`, los números `13.804` y `3,5`, las URLs, ni un punto seguido de minúscula. Sí cuentan `…`, `...`, `!».` y `?».`. Todo con una tabla de casos. [U]
11. **Puntuación de apertura.** `¿ ¡ « ( –` se pegan a la palabra **siguiente**, nunca a la anterior. Si se usa `Intl.Segmenter`, este es su fallo típico. [U]
12. **Palabras de 14 letras o más.** Se parten por el guion si lo tienen; si no, en ⌈len/8⌉ trozos con `-` al final de cada uno. La pausa de puntuación va en el último trozo. [U]

## Persistencia

13. **Clave de caché = hash del contenido (SHA-256) + versión del parser.** El mismo archivo con otro nombre se reconoce como el mismo libro; un byte distinto es otro libro, y subir la versión del parser obliga a reprocesar. [U]
14. **Caché.** Al reabrir un libro no se crea el worker ni se carga pdf.js. Es una aserción binaria, sin umbral de tiempo. [E]
15. **El último libro se abre solo al recargar**, sin volver a elegir el archivo. [E]
16. ~~**Posición y WPM.**~~ *(fuera de esta versión)* Se guardan cada 5 s, al pausar y en `pagehide`. Si se cierra el navegador a lo bruto, la posición se pierde como mucho en los últimos 5 s de lectura. [E]
17. **IndexedDB caído o sin espacio** (`QuotaExceededError`): la app sigue leyendo en memoria y avisa. [U]

## Lector (ORP)

18. **Pivote.** Según la longitud contada solo con letras y dígitos, sin la puntuación de ningún lado: 1 letra → posición 0; 2–5 → 1; 6–9 → 2; 10–13 → 3; 14 o más → 4. [U]
19. **Pivote fijo en pantalla.** Después de `document.fonts.ready`, la letra pivote de "a", "cerebro", "–Hasta" y "«¿Hoy" cae en la misma x ±1 px. [E]
20. **Nada se desborda.** El trozo más largo cabe a 375 px de ancho. [E]

## Ritmo

21. **Duración de cada palabra.** Base `60000/wpm` por un único multiplicador, el **máximo** de los que apliquen:
    - longitud: 6–9 letras ×1,2; 10–13 ×1,5;
    - coma ×1,8; `;` o `:` ×2;
    - fin de frase ×2,2 (×3 si la frase tiene más de 22 palabras);
    - fin de párrafo ×3; título ×3;
    - número: ×1,5 + 0,1 por dígito.

    Tope total ×4. Se prueba con una tabla de casos; los valores son ajustables. [U]
22. **Pantalla en blanco** tras cada fin de frase, antes y después de cada título, y antes de cada elemento de lista. [U]
23. **Sin drift.** El instante de cada palabra se calcula sumando duraciones desde el arranque, nunca desde cuándo se pintó el último frame. Con un retraso aleatorio de hasta 8 ms inyectado en cada tick, el tiempo total de 1.000 palabras no se desvía más de un tick. [U]
24. **Rampa de arranque.** En cada play se empieza al 60 % de los WPM y se llega al 100 % en 20 palabras; la primera dura como mínimo 200 ms. [U]
25. **Cambio de WPM en marcha.** Se aplica desde la siguiente palabra, sin saltarse ni repetir ninguna. [U]
26. **Pausa automática** al ocultar la pestaña. La visibilidad se inyecta en el test. [U]
27. **Fin del libro.** Se para, sin petar ni volver al principio. [U]

## Controles

28. **Teclado.** Espacio hace play/pausa. ↑/↓ suben o bajan 25 WPM, entre 100 y 1000, y por defecto son 300. Con el foco en cualquier botón, el espacio no se dispara dos veces. [E]
29. **Retroceder.** Si llevas menos de 5 palabras en la frase, ← va a la frase anterior; si no, al inicio de la actual. → va a la frase siguiente. [U]
30. **Reanudar tras una pausa de más de 3 s** te devuelve al inicio de la frase. [U]
31. **Contexto en pausa.** Al pausar se ve el párrafo con la palabra actual resaltada. [E]
32. **Progreso.** Se muestra el % leído y el tiempo restante, que es la suma de las duraciones que quedan y no palabras entre WPM. [U]
33. **Accesibilidad mínima.** Todos los controles tienen etiqueta y se usan con teclado; la palabra lleva `aria-hidden`. Hay botón táctil de play/pausa. [E]

## Fuera de la v1

- Índice de capítulos: necesita jerarquía, y el PDF no trae un índice (`getOutline`) con el que fiarse.
- Clic en la barra para saltar, y clic en el contexto de pausa para saltar a una palabra.
- Agrupar palabras cortas: la evidencia es floja.
- Normalizar el WPM para que el real coincida con el elegido, y la tecla de "repetir frase".
- Otros formatos (EPUB, texto pegado) y quitar cabeceras y pies repetidos, que este libro no tiene.

## Notas sobre el PDF de prueba

- Generado por calibre desde un EPUB; texto real con mapa Unicode, sin OCR. 220 páginas, 28 imágenes.
- `pdftotext` sin flags esconde los guiones de corte; con `-raw` salen los 6.
- Los títulos tienen la misma altura de línea que el cuerpo (22,14 pt) y las fuentes tienen nombres ofuscados.
- Las palabras más largas son URLs (`www.WholeBrainChild.com`) y `lucha-huida-inmovilidad`, de 23 caracteres.

## Referencias

- Patente Spritz (ORP y timing): https://patents.google.com/patent/US8903174B2/en
- jetzt (pivote, multiplicadores, troceo): https://github.com/ds300/jetzt
- Reedy (rampa, complejidad, pantalla en blanco): https://github.com/olegcherr/Reedy-for-Chrome
- speedread de pasky (deadline acumulado): https://github.com/pasky/speedread
- speeedy (TS + pdf.js + idb, mismo stack): https://github.com/sami-29/speeedy
- Schotter, Tran y Rayner 2014 (las regresiones importan): https://journals.sagepub.com/doi/abs/10.1177/0956797614531148
- Benedetto et al. 2015 (Spritz, parpadeo y fatiga): https://www.sciencedirect.com/science/article/abs/pii/S0747563214007663
