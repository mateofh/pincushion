# Contratos entre streams

Fuente de verdad para que los streams trabajen en paralelo sin pisarse. Lo mantiene la sesión principal. Si necesitas cambiar algo de aquí, dilo en tu resumen final; no lo edites.

## 1. Servicios (firmas en `src/server/contracts.ts`)

- Cada servicio se crea con una fábrica que recibe la app: `bookmarkService(app): BookmarkService` en `src/server/services/bookmarks.ts`, `searchService(app)` en `services/search.ts`, `collectionService(app)` en `services/collections.ts`, `tagService(app)` en `services/tags.ts`, `bookmarkletService(app)` en `src/server/auth/bookmarklet.ts`.
- Todas las funciones reciben `userId` primero. Recurso ajeno o inexistente → `null` (la página responde 404).
- Errores de validación: `ValidationError` (`src/domain/errors.ts`) con `field` y `message` en español. URL inválida: `InvalidUrlError`.
- La cola de metadatos: `enqueueFetch(app, bookmarkId)` y `processDue(app)` en `src/server/jobs/`. `save()` deja el enlace en `pending` con `next_attempt_at = now`; el bookmarklet además llama a `runInline(app, bookmarkId, { budgetMs: 3000 })`.
- Los esqueletos de Ola 0 (`services/bookmarks.ts` con `saveBookmark/listBookmarks/searchBookmarks`) se reemplazan; las páginas de Ola 0 se adaptan en Ola 2.

## 2. Rutas

| Ruta | Métodos | Auth | Dueño (stream) |
|---|---|---|---|
| `/` | GET | sesión | Biblioteca |
| `/enlaces/:id` | GET, POST (editar) | sesión | Biblioteca |
| `/enlaces/:id/favorito` | POST `value=1\|0`, `volver` | sesión | Biblioteca (Buscar lo usa) |
| `/enlaces/:id/papelera`, `/restaurar`, `/eliminar`, `/reintentar` | POST (`/eliminar` también GET de confirmación) | sesión | Biblioteca |
| `/enlaces/lote` | POST `ids[]`, `accion`, `etiqueta`, `coleccion`, `volver` | sesión | Biblioteca |
| `/colecciones`, `/colecciones/:id` (renombrar/borrar con confirmación) | GET, POST | sesión | Biblioteca |
| `/etiquetas`, `/etiquetas/:id` | GET, POST | sesión | Biblioteca |
| `/papelera` (+ vaciar con confirmación) | GET, POST | sesión | Biblioteca |
| `/guardar` | GET (`?url=`), POST `accion=obtener\|guardar` | sesión | Guardar |
| `/bookmarklet` | GET, POST `accion=rotar` (confirmación) | sesión | Guardar |
| `/bookmarklet/prueba` | GET (+ estado con HTMX) | sesión | Guardar |
| `/bookmarklet/pagina-de-prueba` | GET | pública | Guardar |
| `/bookmarklet/guardar` | GET (shell), POST (token) | token | Guardar |
| `/bookmarklet/guardado/:id` | GET, POST (editar con sesión) | sesión opcional | Guardar |
| `/favicons/:dominio` | GET | sesión (solo dueño) | Guardar |
| `/buscar` | GET `q`, `etiqueta`, `coleccion`, `favoritos`, `cursor` | sesión | Buscar |
| `/entrar`, `/salir`, `/ajustes` (+ contraseña, cerrar sesiones, zona horaria) | GET/POST | — | Seguridad |
| `/healthz`, `/403`, `/404`, `/500` | GET | pública | principal |

Parámetros de la Biblioteca: `vista=tarjetas|lista`, `coleccion=<id>|sin-coleccion`, `etiqueta=<key>` (repetible), `favoritos=1`, `orden=recientes|antiguos|titulo|dominio`, `cursor=…`.

## 3. Nombres visibles (las pruebas los usan; no cambiar sin avisar)

- Barra global: enlace "Biblioteca", "Bookmarklet", "Ajustes", botón "Salir", botón primario **"Guardar enlace"**, buscador con label "Buscar en tus enlaces" (`#q-global`, atajo `/`).
- Entrar: labels "Email", "Contraseña", botón "Entrar".
- Guardar: labels "URL", "Título", "Descripción", "Texto para la búsqueda" (excerpt), "Etiquetas", "Colección"; botones "Obtener datos" y "Guardar" (o "Actualizar enlace" si es duplicado).
- Biblioteca: `h1` con el nombre del filtro ("Biblioteca", "Favoritos", nombre de colección…); grupo "Vista" con "Tarjetas" / "Lista"; select "Ordenar"; región `aria-label="Enlaces guardados"`; cada enlace es `article` con `data-bookmark-id`; checkbox "Seleccionar «título»"; acciones de lote "Añadir etiqueta", "Mover a…", "Favorito", "Mover a la papelera"; botón favorito con `aria-pressed` y texto "Marcar como favorito" / "Quitar de favoritos".
- Buscar: input label "Buscar", región `aria-label="Resultados"`, cada resultado `article` con `data-bookmark-id`.
- Estado del fetch en cada enlace: badge con `data-fetch-status` y texto "Obteniendo datos…", "Datos obtenidos", "Reintentando…", "No se pudo leer la página", "Sin vista previa"; botón "Reintentar".
- Favicon: `img` o monograma con `data-favicon="fetched|fallback"`.
- Flash: `role="status"` dentro de `#flash`; "Deshacer" como botón.

## 4. Matriz de estados por pantalla

| Pantalla | Primaria | Secundarias | Estado visible | Validación | Vacío | Pendiente | Éxito | Fallo recuperable |
|---|---|---|---|---|---|---|---|---|
| Biblioteca | Abrir enlace | Vista, orden, filtros, seleccionar, editar, favorito, papelera | Conteos por colección; badge de fetch por enlace; filtro activo en `h1` | Lote sin selección → "Selecciona al menos un enlace" | Sin enlaces: guía de 2 pasos (bookmarklet → prueba, o pegar URL). Colección vacía: cómo mover. Filtros sin resultados: "Quitar filtros" | `aria-busy` en lote/favorito con HTMX | Flash "3 enlaces movidos a Lectura" + Deshacer (papelera) | Error de lote → flash de error, selección conservada |
| Guardar | Guardar | Obtener datos, crear colección, cancelar | Estado del fetch previo ("Datos obtenidos de example.com" / "No se pudo leer la página") | URL inválida o vacía, título > 300, etiqueta > 40 → error junto al campo conservando lo escrito | Formulario vacío con ayuda "Pega una dirección…" | "Obteniendo datos…" (HTMX) | Redirige al contexto con flash "Enlace guardado" / "Enlace actualizado: se sumaron 2 etiquetas" | Página bloqueada → se puede guardar igual con título editable; error de servidor → reintentar |
| Duplicado (en Guardar) | Actualizar enlace | Ver el existente | "Ya lo guardaste el 3 nov en Lectura · Guardar actualizará ese enlace y sumará las etiquetas" (en papelera: "…está en la papelera; guardarlo lo restaurará") | — | — | — | Flash con etiquetas sumadas | — |
| Buscar | Abrir resultado | Filtros, favorito, editar | "N resultados para «q»" anunciado | q > 200 → mensaje | Sin q: consejos (comillas para frase exacta, busca en título, descripción y texto guardado, filtra por etiqueta) | `aria-busy` en búsqueda en vivo | — | Sin resultados: sugerencias + "Quitar filtros"; error → mensaje + reintentar |
| Bookmarklet | Arrastrar a la barra | Copiar código, instrucciones móvil, probar, rotar token | Último uso, última prueba | Rotar exige confirmación | Primer uso: pasos 1-2-3 | Prueba esperando ("Haz clic en el bookmarklet…", polling) | "✓ Funciona: guardado de prueba recibido a las 10:42" | Sin señal en 60 s → causas probables + botón "Probar sin la barra" |
| Popup del bookmarklet | Cerrar / Abrir biblioteca | Editar (con sesión): título, etiquetas, colección, favorito | Favicon, título, descripción, dominio, estado del fetch | Edición con errores junto al campo | — | "Guardando…" (shell) | "Guardado ✓" / "Ya estaba guardado" | Token revocado → "Este bookmarklet ya no es válido: instala el nuevo desde Pincushion"; página no guardable (`about:`, `file:`, `chrome:`) → mensaje; 429 → "Demasiados intentos, espera N s" |
| Editar enlace | Guardar cambios | Reintentar fetch, papelera, abrir | Estado del fetch + fecha | Igual que Guardar | — | — | Flash + vuelve a `volver` | Conserva lo escrito |
| Papelera | Restaurar | Eliminar definitivamente, vaciar | "Se eliminan solos 30 días después" + fecha por enlace | Vaciar/eliminar con confirmación y alcance ("Se eliminarán 12 enlaces para siempre") | "La papelera está vacía" | — | Flash | — |
| Entrar | Entrar | — | Sesión expirada → aviso | Campos vacíos / credenciales → mensaje genérico | — | — | Redirige a `next` | 429 → "Demasiados intentos, espera N s" |

## 5. Pruebas

- Unit: `tests/unit/<area>/*.test.ts`. Integración: `tests/integration/<area>/*.test.ts` con `createTestApp()` de `tests/helpers/app.ts`.
- E2E: `tests/e2e/<carpeta>/*.spec.ts` importando `test`/`expect` de `tests/e2e/fixtures/test.ts` (`owner`, `signedIn`, `createOwner`, `e2eDb`). Cada test crea sus datos.
- Etiquetas en el título: `@movil` corre también en Pixel 7; `@sin-js` también sin JavaScript. Sin etiqueta = solo escritorio.
- Sitio externo de prueba: `SITE_URL` (`localhost`) con `/articulo`, `/bloqueado`, `/lento`, `/enorme`, `/redirige-a-privada`, `/documento.pdf`, `/csp-estricta`, `/icono.png`.
- Correr e2e de un stream sin chocar: `ASTRO_OUT_DIR=dist-<stream> E2E_APP_PORT=<p> E2E_SITE_PORT=<p+1> npx astro build && ASTRO_OUT_DIR=dist-<stream> E2E_APP_PORT=<p> E2E_SITE_PORT=<p+1> npx playwright test tests/e2e/<carpeta> --trace off`.

## 6. Puertos y DB por stream

| Stream | Puertos e2e | `ASTRO_OUT_DIR` |
|---|---|---|
| dominio | — | — |
| datos | — | — |
| integraciones | 4420-4421 (solo fixture) | — |
| seguridad | 4430-4431 | dist-seguridad |
| design | 4440-4441 | dist-design |
| biblioteca | 4450-4451 | dist-biblioteca |
| guardar | 4460-4461 | dist-guardar |
| buscar | 4470-4471 | dist-buscar |
| qa | 4480-4481 | dist-qa |
