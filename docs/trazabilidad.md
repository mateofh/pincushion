# Trazabilidad: requisito → implementación → prueba

Mapa de cada requisito del brief (según `docs/PLAN.md`) a dónde se implementa, qué prueba lo cubre y en qué archivo. Los archivos de prueba son los **previstos** en `docs/PLAN.md` §9 (`tests/e2e/{journeys,aceptacion,primer-uso,navegacion,estados,resiliencia,contenido,a11y,visual,rendimiento}/*.spec.ts`); los nombres concretos pueden variar al implementarse. La columna "Estado" se actualiza al integrar: hoy todo está **pendiente**.

Convenciones: *Unit* = `tests/unit/<área>/`, *Int* = `tests/integration/<área>/`, *E2E* = `tests/e2e/<carpeta>/`. Proyectos: esc = escritorio, mov = Pixel 7, sjs = sin JavaScript. Bloquean el merge (`npm test`): J1–J3, A1–A3, P1, D1, N1–N10, R1–R2, C1 (hasta 50 enlaces), matriz de estados, teclado, axe y comparación visual. Nocturno (`npm run test:ux`): C1 con 1000, rendimiento y artefactos de 4 anchos.

## 1. Journeys

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| Journey 1: guardar desde una página con el bookmarklet (1 clic, 0 campos obligatorios, confirmación < 1 s, favicon, excerpt buscable, fallback sin popup) | `/bookmarklet/guardar` (shell + POST con token), `src/server/auth/bookmarklet.ts`, `/bookmarklet/guardado/:id`, `src/server/jobs/` (`runInline`), `src/server/adapters/` (fetcher, favicons) | J1 (esc, mov) | `tests/e2e/journeys/j1-bookmarklet.spec.ts` | pendiente |
| Journey 2: seleccionar 3, etiquetar, mover a colección nueva, abrir en tarjetas | `/` Biblioteca, `/enlaces/lote`, `src/server/services/bookmarks.ts` y `collections.ts`, `tags.ts` | J2 (esc, mov, sjs); versión solo teclado | `tests/e2e/journeys/j2-organizar.spec.ts` | pendiente |
| Journey 3: buscar frase a medias, abrir, marcar favorito | `/buscar`, `src/server/services/search.ts`, `src/domain/search-query.ts`, `highlight.ts`, `/enlaces/:id/favorito` | J3 (esc, mov, sjs); versión solo teclado | `tests/e2e/journeys/j3-buscar.spec.ts` | pendiente |
| Primer uso con cuenta vacía, sin tour | Biblioteca vacía (guía de 2 pasos), `/bookmarklet`, `/guardar` | P1 (esc, mov) | `tests/e2e/primer-uso/primer-uso.spec.ts` | pendiente |
| Varios dispositivos (la persona usa teléfono y escritorio) | Datos en el servidor, sesiones independientes | D1 (esc) | `tests/e2e/journeys/d1-dispositivos.spec.ts` | pendiente |

## 2. Escenarios de aceptación

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| Página que bloquea el fetch: se guarda igual, título editable y sobrevive a "Reintentar" | `src/server/jobs/`, `src/server/adapters/page-fetcher.ts`, `src/domain/fetch-state.ts`, `/enlaces/:id/reintentar` | A1 (esc); Int de la cola | `tests/e2e/aceptacion/a1-bloqueada.spec.ts` | pendiente |
| Misma URL (http/www/utm/barra) guardada dos veces: 1 enlace, unión de etiquetas, aviso de duplicado | `src/domain/url.ts` (normalización), `bookmarkService.save` (upsert por `(user_id, normalized_url)`), `/guardar` | A2 (esc); Unit de normalización; Int de fusión | `tests/e2e/aceptacion/a2-duplicado.spec.ts` | pendiente |
| Frase solo en el excerpt: un único `<mark>`, título sin coincidencias | `bookmarks_fts` (FTS5), `search-query.ts`, `highlight.ts` | A3 (esc, mov); Unit de consulta y anti-XSS | `tests/e2e/aceptacion/a3-excerpt.spec.ts` | pendiente |

## 3. Pantallas × 8 estados (matriz de `docs/CONTRATOS.md` §4)

Los 8 estados: acción primaria, secundarias, estado visible, validación, vacío, pendiente, éxito, fallo recuperable. Un test por celda, con axe-core (cero violaciones serias o críticas).

| Pantalla | Implementación | Prueba | Archivo previsto | Estado |
|---|---|---|---|---|
| Biblioteca | `src/pages/index.astro`, `/enlaces/lote`, `/colecciones`, `/etiquetas` | Matriz Biblioteca (vacía/primer uso, colección vacía, filtros sin resultados, lote sin selección, éxito con Deshacer, error de lote) | `tests/e2e/estados/biblioteca.spec.ts` | pendiente |
| Guardar y Duplicado | `src/pages/guardar.astro`, `bookmarkService` | Matriz Guardar y Duplicado (URL inválida conservando lo escrito, "No se pudo leer la página", duplicado activo y en papelera) | `tests/e2e/estados/guardar.spec.ts` | pendiente |
| Buscar | `src/pages/buscar.astro`, `searchService` | Matriz Buscar (vacío con consejos, sin resultados con "Quitar filtros", `q` > 200, error) | `tests/e2e/estados/buscar.spec.ts` | pendiente |
| Bookmarklet | `/bookmarklet`, `/bookmarklet/prueba`, rotación de token | Matriz Bookmarklet (primer uso, prueba esperando, éxito, sin señal en 60 s, rotar con confirmación) | `tests/e2e/estados/bookmarklet.spec.ts` | pendiente |
| Popup del bookmarklet | `/bookmarklet/guardar`, `/bookmarklet/guardado/:id` | Matriz popup (guardado, ya estaba, token revocado, página no guardable, 429, edición con sesión) | `tests/e2e/estados/popup.spec.ts` | pendiente |
| Editar enlace | `/enlaces/:id` | Matriz Editar | `tests/e2e/estados/editar.spec.ts` | pendiente |
| Papelera | `/papelera` | Matriz Papelera (vacía, restaurar, eliminar y vaciar con confirmación y alcance) | `tests/e2e/estados/papelera.spec.ts` | pendiente |
| Entrar | `src/pages/entrar.astro` | Matriz Entrar (campos vacíos, credenciales, sesión expirada, 429) | `tests/e2e/estados/entrar.spec.ts` | pendiente |

## 4. Capacidades núcleo

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| Guardar enlaces (bookmarklet y pegando URL) | `/guardar`, `/bookmarklet/guardar`, `bookmarkService.save` | J1, A1, A2, N10 | journeys, aceptacion, navegacion | pendiente |
| Etiquetas y colecciones | `tagService`, `collectionService`, `/etiquetas`, `/colecciones` | J2; Int de servicios | `tests/e2e/journeys/j2-organizar.spec.ts` | pendiente |
| Búsqueda de texto completo en título, descripción y excerpt | `bookmarks_fts`, `searchService` | J3, A3; Int de rendimiento con 10 000 enlaces (p95 < 100 ms) | `tests/integration/search/` | pendiente |
| Favoritos | `/enlaces/:id/favorito` | J3 | journeys | pendiente |
| Papelera con Deshacer y purga a los 30 días | `/papelera`, `/enlaces/:id/papelera`, mantenimiento | N9; Int de retención | `tests/e2e/navegacion/`, `tests/integration/jobs/` | pendiente |
| Obtención de metadatos y favicon en segundo plano con reintentos | `src/server/jobs/`, `src/server/adapters/` | A1, R2; Int éxito/timeout/retry/rechazo contra fixtures | `tests/e2e/resiliencia/`, `tests/integration/jobs/` | pendiente |
| Vista tarjetas/lista, orden y filtros en la URL | `/` con `vista`, `orden`, `coleccion`, `etiqueta`, `favoritos`, `cursor` | N2, N3, J2 | `tests/e2e/navegacion/` | pendiente |
| Paginación por cursor (50 por página) | `bookmarkService.list` | N2; Int de paginación | `tests/integration/bookmarks/` | pendiente |

## 5. Navegación y resiliencia

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| Barra global idéntica, landmarks, `<title>` único, `aria-current` | `src/layouts/App.astro` | N1 (esc, mov) | `tests/e2e/navegacion/n1-barra-global.spec.ts` | pendiente de integración |
| Estado en la URL; refrescar y atrás/adelante | Query de `/` y `/buscar` | N2 | `tests/e2e/navegacion/` | pendiente |
| Enlaces directos | Rutas `/buscar?q=`, `/?coleccion=&vista=`, `/enlaces/:id` | N3 | `tests/e2e/navegacion/` | pendiente |
| Sin sesión → `/entrar?next=` y regreso | `src/middleware.ts` | N4 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | pendiente de integración |
| Sesión expirada sin perder lo escrito | `lookupSession`, `/entrar` | N5 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | pendiente de integración |
| Recurso ajeno → 404 (GET y POST) | `userId` en todos los servicios | N6; Int de scoping | `tests/e2e/navegacion/n6-urls-ajenas.spec.ts`, `tests/integration/` | pendiente de integración |
| `next`/`volver` solo relativos | `src/server/http.ts` | N7 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | pendiente de integración |
| Páginas 403/404/429/500 con código de referencia | `src/pages/{403,404,500}.astro`, `ErrorPage.astro` | N8 (esc, mov) | `tests/e2e/navegacion/n8-errores.spec.ts` | pendiente de integración |
| PRG, flash y Deshacer | Todos los POST | N9 (esc, sjs) | `tests/e2e/navegacion/` | pendiente |
| Idempotencia ante doble clic y recarga | upsert por URL normalizada | N10 | `tests/e2e/navegacion/` | pendiente |
| HTMX falla y el formulario normal sigue | Mejora progresiva | R1 | `tests/e2e/resiliencia/r1-htmx.spec.ts` | pendiente de integración |
| Job lento → fallo → "Reintentar" anunciado | `fetch_status`, live regions | R2 | `tests/e2e/resiliencia/r2-fetch.spec.ts` | pendiente |
| Contenido extremo (título de 300, sin título, emoji/RTL, 40 etiquetas, URL de 2000, 0/1/1000 enlaces) | CSS y truncado accesible | C1 (hasta 50 bloquea; 1000 nocturno) | `tests/e2e/contenido/` | pendiente |

## 6. Permisos

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| bob no ve ni modifica enlaces de alice (GET/POST → 404, nada cambia) | `user_id` en toda consulta; FKs compuestas | N6; Int de scoping por servicio; constraints de DB | `tests/e2e/navegacion/`, `tests/integration/` | pendiente |
| Favicons solo para su dueño | `/favicons/:dominio` | Int | `tests/integration/favicons/` | pendiente |
| Token del bookmarklet solo guarda (no lee, no restaura, no edita) | `bookmarkletService` | Int; matriz popup | `tests/integration/auth/` | pendiente |
| Denegar por defecto | `src/middleware.ts` | N4; Int de rutas públicas | `tests/integration/auth/` | pendiente |

## 7. Móvil y responsive

| Requisito | Implementación | Pruebas | Archivo previsto | Estado |
|---|---|---|---|---|
| J1, J2, J3, P1, N1, N8, A3, C1 en Pixel 7 | Estilos móviles, hoja de filtros, barra de acciones fija | Proyecto `movil` (etiqueta `@movil`) | según cada escenario | pendiente |
| Sin scroll horizontal, targets ≥ 44 px, barra de acciones sin tapar contenido, campo visible con teclado virtual | `src/styles/` | Checks automáticos | `tests/e2e/a11y/movimiento-zoom.spec.ts`, `tests/e2e/helpers/ui.ts` (`noHorizontalScroll`, `tapTargetsAtLeast`) | pendiente de integración |
| Comparación visual en 390 y 1280 px (Biblioteca tarjetas/lista, Guardar, Buscar, Bookmarklet) | — | `toHaveScreenshot` | `tests/e2e/visual/comparacion.spec.ts` (líneas base al integrar) | pendiente de integración |
| Artefactos de revisión en 360/768/1024/1440 | — | `npm run test:ux` | `tests/e2e/visual/artefactos.spec.ts` (`@nocturno`) | pendiente de integración |
| Rendimiento percibido (1000 enlaces, CPU ×4, Fast 3G: contenido < 1,5 s; búsqueda p95 < 150 ms; JS < 30 KB gzip) | — | Nocturno | `tests/e2e/rendimiento/biblioteca-carga.spec.ts` (`@nocturno`) | pendiente |

## 8. Accesibilidad

| Requisito | Pruebas | Archivo previsto | Estado |
|---|---|---|---|
| J2 y J3 solo con teclado (saltar al contenido, espacio, lote, atajo `/`) | Teclado | `tests/e2e/a11y/teclado.spec.ts` | pendiente de integración |
| Foco visible, Escape en diálogos, foco tras PRG | a11y | `tests/e2e/a11y/foco.spec.ts` | pendiente de integración |
| Live regions anuncian resultados y estados del fetch | a11y | `tests/e2e/resiliencia/r1-htmx.spec.ts` (aviso en `#announcer`); R2 en el stream Guardar | pendiente de integración |
| axe-core sin violaciones serias o críticas en cada celda y en móvil | a11y | `tests/e2e/a11y/axe.spec.ts` | pendiente de integración |
| Estados no solo por color (favorito, seleccionado, fallo) | a11y | `tests/e2e/a11y/color.spec.ts` | pendiente de integración |
| `prefers-reduced-motion`, zoom y texto al 200 % | a11y | `tests/e2e/a11y/movimiento-zoom.spec.ts` | pendiente de integración |
| Lector de pantalla real (VoiceOver, NVDA) | Manual | `docs/pruebas-ux.md` §2 | pendiente |

## 9. Reglas de negocio

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Normalización de URL (https por defecto, sin `www.`, sin tracking, query ordenada, sin fragmento, etc.) | `src/domain/url.ts` | Unit `tests/unit/domain/url.test.ts`; A2 | pendiente |
| Unicidad por `(user_id, normalized_url)` y fusión de etiquetas por unión | `bookmarkService.save`, migración 0001 | Int; A2 | pendiente |
| El fetch nunca pisa título/descripción con `title_source='user'`; el bookmarklet no pisa ediciones | `bookmark-rules.ts`, `fetch-state.ts` | Unit; A1 | pendiente |
| Máquina de `fetch_status` y backoff (30 s · 2 min · 10 min ±20 %) | `src/domain/fetch-state.ts`, `src/server/jobs/` | Unit; Int de la cola; R2 | pendiente |
| Validación: título ≤ 300, etiqueta ≤ 40, URL ≤ 2048, colección ≤ 80, `q` ≤ 200 | `src/domain/`, constraints CHECK | Unit; matriz Guardar y Buscar | pendiente |
| Búsqueda `"frase" OR (t1 AND … tN*)`, comillas = frase exacta, excluye papelera, `<mark>` seguro (anti-XSS) | `search-query.ts`, `highlight.ts` | Unit; A3 | pendiente |
| Papelera reversible y purga a 30 días; Guardar una URL en papelera ofrece restaurar | `trashed_at`, mantenimiento | Int; matriz Duplicado | pendiente |
| Transacciones en operaciones multi-registro (guardar, lote, borrar colección, vaciar papelera, rotar token) | `db.transaction` | Int | pendiente |

## 10. Seguridad

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Autenticación por email y contraseña (scrypt), rol único | `src/server/auth/`, `src/server/crypto.ts` | Int; N4; matriz Entrar | pendiente |
| Sesiones: cookie HttpOnly, SameSite=Lax, Secure y `__Host-` con https; hash en la DB; expiración 30 d / 14 d; id rotado al login | `sessions.ts`, `http.ts` | Int; N5 | pendiente |
| CSRF (token + cabecera HTMX + Origin) → 403 | `src/middleware.ts` | Int; N8 | pendiente |
| CSP sin inline, `frame-ancestors 'none'`, Referrer-Policy, nosniff, HSTS con https | `src/middleware.ts`, `build.inlineStylesheets:'never'` | Int de cabeceras; J1 con CSP estricta | pendiente |
| Rate limits: login (por IP y por email+IP), guardado 60/min/token, "Obtener datos" 30/min/usuario | `rate_limits`, `src/server/security/` | Int; test dedicado del 429 con límite real | pendiente |
| Token del bookmarklet derivado por HMAC (sin guardarse), tiempo constante, rotable, solo guarda | `bookmarkletService`, HKDF por propósito | Int; matriz popup | pendiente |
| Guarda SSRF con IP fijada, redirects revalidados, límites de tamaño y tiempo, solo HTML | `page-fetcher.ts` | Int contra fixtures (`/redirige-a-privada`, `/enorme`, `/lento`, gzip bomb) | pendiente |
| Favicons: ≤ 100 KB, magic bytes, sin SVG, nosniff, solo al dueño | adapters, `/favicons/:dominio` | Int | pendiente |
| Logs JSON redactados (sin tokens, cookies, contraseñas, query ni URLs) | `src/server/log.ts` | Unit de redacción | pendiente |
| Audit inmutable de eventos de seguridad (365 días) | `audit_events` + trigger | Int | pendiente |
| Webhooks y firmas de proveedores | No aplica (no hay proveedores externos) | — | no aplica |

## 11. Operaciones

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Migraciones solo hacia adelante con copia previa | `scripts/migrate.ts`, `src/server/db/sqlite.ts` | Int de migrador; verificación manual de `db:migrate` | pendiente |
| `/healthz` (DB, migraciones, cola) | `src/pages/healthz.ts` | Int | pendiente |
| Worker en proceso, `jobs:once` y mantenimiento horario | `src/server/jobs/`, `server/entry.mjs` | Int | pendiente |
| Apagado ordenado | `server/entry.mjs` | Verificación manual | pendiente |
| Backup y restauración | `docs/operacion.md`, `npm run db:backup` (stream ops) | Prueba de ida y vuelta | pendiente |
| Usuarios por CLI | `scripts/user-create.ts` | Verificación manual / Int | pendiente |
| Seed demo (alice, bob, dana), bloqueado en producción | `scripts/seed.ts` (stream backend/ops) | Int | pendiente |
| Dockerfile que se construye en el test | stream ops | Build en CI | pendiente |

## 12. Entregables y definición de hecho

| Requisito | Dónde | Verificación | Estado |
|---|---|---|---|
| README en español completo | `README.md` | Revisión; "developer nuevo" desde clon limpio (Ola 3) | pendiente |
| `.env.example` con todas las variables | `.env.example` | Comparar con `src/server/config.ts` | pendiente |
| Guion de pruebas de UX | `docs/pruebas-ux.md` | El dueño lo ejecuta | pendiente |
| Trazabilidad requisito → prueba | este archivo | Revisión al integrar | pendiente |
| Marca aplicada | `docs/MARCA.md`, `src/styles/` | Revisión visual y comparación en 390/1280 px | pendiente |
| `npm test` en verde (`astro check` + Vitest + build + Playwright escritorio, Pixel 7, sin-JS) | `package.json` | CI / sesión principal | pendiente |
| Metas con personas: ≥ 80 % de éxito sin ayuda y SUS ≥ 75 | `docs/pruebas-ux.md` §4 | Sesiones con 5 personas | pendiente |
| Bookmarklet verificado en Chrome, Firefox, Safari, iOS y Android; 3 sitios con CSP estricta | `docs/pruebas-ux.md` §1 | Manual | pendiente |
| Fuera de alcance (siguiente versión): importar/exportar, API, share target | README, "Limitaciones conocidas" | — | no aplica |


## 13. Pruebas de QA transversal (Ola 2)

| Archivo | Cubre |
|---|---|
| `tests/e2e/sin-js/sin-js.spec.ts` | Entrar, Guardar en dos pasos, lote, favorito, Buscar, editar y papelera sin JavaScript (N9, J2, J3 sin JS) |
| `tests/e2e/helpers/{ui,teclado,datos}.ts` | Utilidades compartidas |

Las pruebas que dependen de pantallas de otros streams llevan `[requiere: biblioteca|guardar|buscar]` en el título. Estado de todas: pendiente de integración.
