# fast-reading

Lector RSVP (*Rapid Serial Visual Presentation*) para PDFs que funciona entero en el navegador. Abres un libro en PDF y lo lees palabra a palabra, con la letra pivote (ORP) siempre en el mismo punto de la pantalla para que el ojo no tenga que moverse.

Sin servidor ni cuentas: el PDF no sale de tu navegador.

## Qué hace

- **Extracción en un Web Worker** con pdf.js: texto normalizado (NFC, ligaduras, soft hyphens), guiones de fin de renglón resueltos y detección de párrafos, títulos y elementos de lista.
- **Tokenizado pensado para español**: no corta frase en `Sr.`, `EE. UU.`, `n.º`, iniciales, números o URLs; pega `¿ ¡ « ( –` a la palabra siguiente; parte las palabras de 14 letras o más.
- **Ritmo natural**: cada palabra dura más según su longitud, la puntuación, el fin de frase o de párrafo, los títulos y los números. Hay una pantalla en blanco tras cada frase y alrededor de los títulos, y una rampa de arranque al 60 % de la velocidad.
- **Sin drift**: el instante de cada palabra se calcula desde el arranque, así que el retraso de un frame no se va acumulando.
- **Caché en IndexedDB** por hash SHA-256 del contenido: un libro ya abierto se carga al instante (aunque lo hayas renombrado) y al recargar la página vuelves al último libro, en la misma palabra y a la misma velocidad. Si IndexedDB falla, la app sigue funcionando en memoria.

## Controles

| Tecla | Acción |
| --- | --- |
| Espacio | Play / pausa |
| ↑ / ↓ | ±25 WPM (de 100 a 1000; por defecto 300) |

- También puedes arrastrar el PDF a la ventana, y la velocidad se cambia con los botones − / + (útil en móvil).
- En pausa se despliega un panel con el párrafo actual, la palabra resaltada, el capítulo y el tiempo que queda.
- El botón de la cabecera cambia el tema: el del sistema, claro u oscuro. Se recuerda entre visitas.
- La lectura se pausa sola al cambiar de pestaña.
- Si retomas tras más de 3 s de pausa, vuelves al principio de la frase.

## Desarrollo

Requisitos: Node 20+.

```sh
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
npm run build      # typecheck + build de producción en dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

Stack: Vite 6, TypeScript estricto sin framework y pdfjs-dist 4.

```
src/
  ingest/    validación, worker y extracción del PDF a un Book
  core/      tokenizado, ORP, tiempos y reproductor
  persist/   clave de caché y store IndexedDB
  main.ts    interfaz
docs/
  CONTRACT.md     interfaz pública de los módulos
  MUST_HAVES.md   requisitos de la v1
```

## Limitaciones

- La extracción está afinada con un libro concreto. Con otros PDFs puede fallar más la detección de párrafos y títulos, sobre todo si son escaneados (sin capa de texto no hay nada que leer).
- Saltar a la frase anterior o siguiente (`back`/`forward`) está en el reproductor, pero aún no tiene teclas ni botones.

## Licencia

[MIT](LICENSE). El código es libre; los libros que leas con él tienen sus propios derechos.
