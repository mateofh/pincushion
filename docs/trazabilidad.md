# Trazabilidad: requisito → implementación → prueba

Mapa de cada requisito del brief (según `docs/PLAN.md`) a dónde se implementa, qué prueba lo cubre y en qué archivo. Los nombres de archivo son los reales de `tests/` (comprobados con el árbol de la rama). Estado **implementada** significa que el archivo de prueba existe; el resultado de la última ejecución de la suite no está aquí, se registra al integrar. Las filas sin prueba automática dicen explícitamente qué las cubre.

Convenciones: *Unit* = `tests/unit/<área>/`, *Int* = `tests/integration/<área>/`, *E2E* = `tests/e2e/<carpeta>/`. Proyectos: esc = escritorio, mov = Pixel 7, sjs = sin JavaScript. Bloquean el merge (`npm test`): J1–J3, A1–A3, P1, D1, N1–N10, R1–R2, C1 (hasta 50 enlaces), matriz de estados, teclado, axe y comparación visual. Nocturno (`npm run test:ux`): C1 con 1000, rendimiento y artefactos de 4 anchos.

## 1. Journeys

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| Journey 1: guardar desde una página con el bookmarklet (1 clic, 0 campos obligatorios, confirmación < 1 s, favicon, excerpt buscable, fallback sin popup) | `/bookmarklet/guardar` (shell + POST con token), `src/server/auth/bookmarklet.ts`, `/bookmarklet/guardado/:id`, `src/server/jobs/` (`runInline`), `src/server/adapters/` (fetcher, favicons) | J1 (esc, mov) | `tests/e2e/journeys/j1-bookmarklet.spec.ts` | implementada |
| Journey 2: seleccionar 3, etiquetar, mover a colección nueva, abrir en tarjetas | `/` Biblioteca, `/enlaces/lote`, `src/server/services/bookmarks.ts` y `collections.ts`, `tags.ts` | J2 (esc, mov, sjs); versión solo teclado | `tests/e2e/journeys/j2-etiquetar-mover.spec.ts` | implementada |
| Journey 3: buscar frase a medias, abrir, marcar favorito | `/buscar`, `src/server/services/search.ts`, `src/domain/search-query.ts`, `highlight.ts`, `/enlaces/:id/favorito` | J3 (esc, mov, sjs); versión solo teclado | `tests/e2e/journeys/j3-buscar-favorito.spec.ts` | implementada |
| Primer uso con cuenta vacía, sin tour | Biblioteca vacía (guía de 2 pasos), `/bookmarklet`, `/guardar` | P1 (esc, mov) | `tests/e2e/primer-uso/p1.spec.ts` | implementada |
| Varios dispositivos (la persona usa teléfono y escritorio) | Datos en el servidor, sesiones independientes | D1 (esc) | `tests/e2e/dispositivos/d1-varios-dispositivos.spec.ts` | implementada |

## 2. Escenarios de aceptación

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| Página que bloquea el fetch: se guarda igual, título editable y sobrevive a "Reintentar" | `src/server/jobs/`, `src/server/adapters/page-fetcher.ts`, `src/domain/fetch-state.ts`, `/enlaces/:id/reintentar` | A1 (esc); Int de la cola | `tests/e2e/aceptacion/a1-pagina-bloqueada.spec.ts` | implementada |
| Misma URL (http/www/utm/barra) guardada dos veces: 1 enlace, unión de etiquetas, aviso de duplicado | `src/domain/url.ts` (normalización), `bookmarkService.save` (upsert por `(user_id, normalized_url)`), `/guardar` | A2 (esc); Unit de normalización; Int de fusión | `tests/e2e/aceptacion/a2-duplicados.spec.ts` | implementada |
| Frase solo en el excerpt: un único `<mark>`, título sin coincidencias | `bookmarks_fts` (FTS5), `search-query.ts`, `highlight.ts` | A3 (esc, mov); Unit de consulta y anti-XSS | `tests/e2e/aceptacion/a3-excerpt.spec.ts` | implementada |

## 3. Pantallas × 8 estados (matriz de `docs/CONTRATOS.md` §4)

Los 8 estados: acción primaria, secundarias, estado visible, validación, vacío, pendiente, éxito, fallo recuperable. Un test por celda, con axe-core (cero violaciones serias o críticas).

| Pantalla | Implementación | Prueba | Archivo | Estado |
|---|---|---|---|---|
| Biblioteca | `src/pages/index.astro`, `/enlaces/lote`, `/colecciones`, `/etiquetas` | Matriz Biblioteca (vacía/primer uso, colección vacía, filtros sin resultados, lote sin selección, éxito con Deshacer, error de lote) | `tests/e2e/estados/biblioteca.spec.ts` | implementada |
| Guardar y Duplicado | `src/pages/guardar.astro`, `bookmarkService` | Matriz Guardar y Duplicado (URL inválida conservando lo escrito, "No se pudo leer la página", duplicado activo y en papelera) | `tests/e2e/estados/guardar.spec.ts` | implementada |
| Buscar | `src/pages/buscar.astro`, `searchService` | Matriz Buscar (vacío con consejos, sin resultados con "Quitar filtros", `q` > 200, error) | `tests/e2e/estados/buscar.spec.ts` | implementada |
| Bookmarklet | `/bookmarklet`, `/bookmarklet/prueba`, rotación de token | Matriz Bookmarklet (primer uso, prueba esperando, éxito, sin señal en 60 s, rotar con confirmación) | `tests/e2e/estados/bookmarklet.spec.ts` | implementada |
| Popup del bookmarklet | `/bookmarklet/guardar`, `/bookmarklet/guardado/:id` | Matriz popup (guardado, ya estaba, token revocado, página no guardable, 429, edición con sesión) | `tests/e2e/estados/popup.spec.ts` | implementada |
| Editar enlace | `/enlaces/:id` | Matriz Editar | `tests/e2e/estados/editar.spec.ts` | implementada |
| Papelera | `/papelera` | Matriz Papelera (vacía, restaurar, eliminar y vaciar con confirmación y alcance) | `tests/e2e/estados/papelera.spec.ts` | implementada |
| Entrar | `src/pages/entrar.astro` | Matriz Entrar (campos vacíos, credenciales, sesión expirada, 429) | `tests/integration/auth/auth-flows.test.ts` y `tests/e2e/seguridad/navegacion-auth.spec.ts` | implementada |

## 4. Capacidades núcleo

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| Guardar enlaces (bookmarklet y pegando URL) | `/guardar`, `/bookmarklet/guardar`, `bookmarkService.save` | J1, A1, A2, N10 | `tests/e2e/journeys/j1-bookmarklet.spec.ts`, `tests/e2e/aceptacion/a1-pagina-bloqueada.spec.ts`, `tests/e2e/aceptacion/a2-duplicados.spec.ts`, `tests/e2e/navegacion/n10-doble-envio.spec.ts`, `tests/e2e/guardar/guardar.spec.ts` | implementada |
| Etiquetas y colecciones | `tagService`, `collectionService`, `/etiquetas`, `/colecciones` | J2; Int de servicios | `tests/e2e/journeys/j2-etiquetar-mover.spec.ts` | implementada |
| Búsqueda de texto completo en título, descripción y excerpt | `bookmarks_fts`, `searchService` | J3, A3; Int de rendimiento con 10 000 enlaces (p95 < 100 ms) | `tests/integration/data/search.test.ts`, `tests/integration/data/performance.test.ts` | implementada |
| Favoritos | `/enlaces/:id/favorito` | J3 | `tests/e2e/journeys/j3-buscar-favorito.spec.ts` | implementada |
| Papelera con Deshacer y purga a los 30 días | `/papelera`, `/enlaces/:id/papelera`, mantenimiento | N9; Int de retención | `tests/e2e/navegacion/n9-volver-al-contexto.spec.ts`, `tests/integration/jobs/maintenance.test.ts` | implementada |
| Obtención de metadatos y favicon en segundo plano con reintentos | `src/server/jobs/`, `src/server/adapters/` | A1, R2; Int éxito/timeout/retry/rechazo contra fixtures | `tests/e2e/resiliencia/r2-metadatos-lentos.spec.ts`, `tests/integration/jobs/queue.test.ts`, `tests/integration/jobs/real-fetcher.test.ts` | implementada |
| Vista tarjetas/lista, orden y filtros en la URL | `/` con `vista`, `orden`, `coleccion`, `etiqueta`, `favoritos`, `cursor` | N2, N3, J2 | `tests/e2e/navegacion/n2-filtros-vista-orden.spec.ts`, `tests/e2e/navegacion/n3-enlaces-directos.spec.ts` | implementada |
| Paginación por cursor (50 por página) | `bookmarkService.list` | N2; Int de paginación | `tests/integration/data/list.test.ts` | implementada |

## 5. Navegación y resiliencia

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| Barra global idéntica, landmarks, `<title>` único, `aria-current` | `src/layouts/App.astro` | N1 (esc, mov) | `tests/e2e/navegacion/n1-barra-global.spec.ts` | implementada |
| Estado en la URL; refrescar y atrás/adelante | Query de `/` y `/buscar` | N2 | X |
| Enlaces directos | Rutas `/buscar?q=`, `/?coleccion=&vista=`, `/enlaces/:id` | N3 | `tests/e2e/navegacion/n3-enlaces-directos.spec.ts` | implementada |
| Sin sesión → `/entrar?next=` y regreso | `src/middleware.ts` | N4 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | implementada |
| Sesión expirada sin perder lo escrito | `lookupSession`, `/entrar` | N5 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | implementada |
| Recurso ajeno → 404 (GET y POST) | `userId` en todos los servicios | N6; Int de scoping | `tests/e2e/navegacion/n6-urls-ajenas.spec.ts`, `tests/integration/data/isolation.test.ts` | implementada |
| `next`/`volver` solo relativos | `src/server/http.ts` | N7 | `tests/e2e/seguridad/navegacion-auth.spec.ts` | implementada |
| Páginas 403/404/429/500 con código de referencia | `src/pages/{403,404,500}.astro`, `ErrorPage.astro` | N8 (esc, mov) | `tests/e2e/navegacion/n8-errores.spec.ts` | implementada |
| PRG, flash y Deshacer | Todos los POST | N9 (esc, sjs) | `tests/e2e/navegacion/n9-volver-al-contexto.spec.ts`, `tests/e2e/sin-js/sin-js.spec.ts` | implementada |
| Idempotencia ante doble clic y recarga | upsert por URL normalizada | N10 | `tests/e2e/navegacion/n10-doble-envio.spec.ts` | implementada |
| HTMX falla y el formulario normal sigue | Mejora progresiva | R1 | `tests/e2e/resiliencia/r1-htmx.spec.ts` | implementada |
| Job lento → fallo → "Reintentar" anunciado | `fetch_status`, live regions | R2 | `tests/e2e/resiliencia/r2-fetch.spec.ts` | implementada |
| Contenido extremo (título de 300, sin título, emoji/RTL, 40 etiquetas, URL de 2000, 0/1/1000 enlaces) | CSS y truncado accesible | C1 (hasta 50 bloquea; 1000 nocturno) | `tests/e2e/contenido/c1-contenido-extremo.spec.ts` | implementada |

## 6. Permisos

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| bob no ve ni modifica enlaces de alice (GET/POST → 404, nada cambia) | `user_id` en toda consulta; FKs compuestas | N6; Int de scoping por servicio; constraints de DB | `tests/e2e/navegacion/n6-urls-ajenas.spec.ts`, `tests/integration/data/isolation.test.ts`, `tests/integration/data/constraints.test.ts`, `tests/e2e/biblioteca/permisos.spec.ts`, `tests/e2e/buscar/permisos.spec.ts` | implementada |
| Favicons solo para su dueño | `/favicons/:dominio` | Int | `tests/integration/favicons/` | implementada |
| Token del bookmarklet solo guarda (no lee, no restaura, no edita) | `bookmarkletService` | Int; matriz popup | `tests/integration/auth/` | implementada |
| Denegar por defecto | `src/middleware.ts` | N4; Int de rutas públicas | `tests/integration/auth/` | implementada |

## 7. Móvil y responsive

| Requisito | Implementación | Pruebas | Archivo | Estado |
|---|---|---|---|---|
| J1, J2, J3, P1, N1, N8, A3, C1 en Pixel 7 | Estilos móviles, hoja de filtros, barra de acciones fija | Proyecto `movil` (etiqueta `@movil`) | según cada escenario | implementada |
| Sin scroll horizontal, targets ≥ 44 px, barra de acciones sin tapar contenido, campo visible con teclado virtual | `src/styles/` | Checks automáticos | `tests/e2e/a11y/movimiento-zoom.spec.ts`, `tests/e2e/helpers/ui.ts` (`noHorizontalScroll`, `tapTargetsAtLeast`) | implementada |
| Comparación visual en 390 y 1280 px (Biblioteca tarjetas/lista, Guardar, Buscar, Bookmarklet) | — | `toHaveScreenshot` | `tests/e2e/visual/comparacion.spec.ts` (líneas base al integrar) | implementada |
| Artefactos de revisión en 360/768/1024/1440 | — | `npm run test:ux` | `tests/e2e/visual/artefactos.spec.ts` (`@nocturno`) | implementada |
| Rendimiento percibido (1000 enlaces, CPU ×4, Fast 3G: contenido < 1,5 s; búsqueda p95 < 150 ms; JS < 30 KB gzip) | — | Nocturno | `tests/e2e/rendimiento/biblioteca-carga.spec.ts` (`@nocturno`) | implementada |

## 8. Accesibilidad

| Requisito | Pruebas | Archivo | Estado |
|---|---|---|---|
| J2 y J3 solo con teclado (saltar al contenido, espacio, lote, atajo `/`) | Teclado | `tests/e2e/a11y/teclado.spec.ts` | implementada |
| Foco visible, Escape en diálogos, foco tras PRG | a11y | `tests/e2e/a11y/foco.spec.ts` | implementada |
| Live regions anuncian resultados y estados del fetch | a11y | `tests/e2e/resiliencia/r1-htmx.spec.ts` (aviso en `#announcer`), `tests/e2e/resiliencia/r2-metadatos-lentos.spec.ts` | implementada |
| axe-core sin violaciones serias o críticas en cada celda y en móvil | a11y | `tests/e2e/a11y/axe.spec.ts`, `tests/e2e/biblioteca/a11y.spec.ts` | implementada |
| Estados no solo por color (favorito, seleccionado, fallo) | a11y | `tests/e2e/a11y/color.spec.ts` | implementada |
| `prefers-reduced-motion`, zoom y texto al 200 % | a11y | `tests/e2e/a11y/movimiento-zoom.spec.ts` | implementada |
| Lector de pantalla real (VoiceOver, NVDA) | Manual | `docs/pruebas-ux.md` §2 | manual (no automatizable) |

## 9. Reglas de negocio

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Normalización de URL (https por defecto, sin `www.`, sin tracking, query ordenada, sin fragmento, etc.) | `src/domain/url.ts` | `tests/unit/domain/url.test.ts`; A2 (`tests/e2e/aceptacion/a2-duplicados.spec.ts`) | implementada |
| Unicidad por `(user_id, normalized_url)` y fusión de etiquetas por unión | `bookmarkService.save`, migración 0001 | `tests/integration/data/save.test.ts`, `tests/integration/data/constraints.test.ts`; A2 | implementada |
| El fetch nunca pisa título/descripción con `title_source='user'`; el bookmarklet no pisa ediciones | `bookmark-rules.ts`, `fetch-state.ts` | `tests/unit/domain/bookmark-rules.test.ts`, `tests/unit/domain/fetch-state.test.ts`; A1 | implementada |
| Máquina de `fetch_status` y backoff (30 s · 2 min · 10 min ±20 %) | `src/domain/fetch-state.ts`, `src/server/jobs/` | `tests/unit/domain/fetch-state.test.ts`, `tests/integration/jobs/queue.test.ts`; R2 | implementada |
| Validación: título ≤ 300, etiqueta ≤ 40, URL ≤ 2048, colección ≤ 80, `q` ≤ 200 | `src/domain/`, constraints CHECK | `tests/unit/domain/tags.test.ts`, `tests/integration/data/constraints.test.ts`; matrices Guardar y Buscar | implementada |
| Búsqueda `"frase" OR (t1 AND … tN*)`, comillas = frase exacta, excluye papelera, `<mark>` seguro (anti-XSS) | `search-query.ts`, `highlight.ts` | `tests/unit/domain/search-query.test.ts`, `tests/unit/domain/highlight.test.ts`, `tests/integration/data/search.test.ts`; A3 | implementada |
| Papelera reversible y purga a 30 días; Guardar una URL en papelera ofrece restaurar | `trashed_at`, mantenimiento | `tests/integration/jobs/maintenance.test.ts`; matriz Duplicado (`tests/e2e/estados/guardar.spec.ts`) | implementada |
| Transacciones en operaciones multi-registro (guardar, lote, borrar colección, vaciar papelera, rotar token) | `db.transaction` | `tests/integration/data/save.test.ts`, `tests/integration/data/collections-tags.test.ts` | implementada |

## 10. Seguridad

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Autenticación por email y contraseña (scrypt), rol único | `src/server/auth/`, `src/server/crypto.ts` | `tests/integration/auth/auth-flows.test.ts`; N4 (`tests/e2e/seguridad/navegacion-auth.spec.ts`) | implementada |
| Sesiones: cookie HttpOnly, SameSite=Lax, Secure y `__Host-` con https; hash en la DB; expiración 30 d / 14 d; id rotado al login | `sessions.ts`, `http.ts` | `tests/integration/auth/auth-flows.test.ts`; N5; `tests/e2e/seguridad/ajustes.spec.ts` | implementada |
| CSRF (token + cabecera HTMX + Origin) → 403 | `src/middleware.ts`, `src/server/security/origin.ts` | `tests/unit/auth/origin.test.ts`, `tests/e2e/seguridad/protecciones.spec.ts`; N8 | implementada |
| CSP sin inline, `frame-ancestors 'none'`, Referrer-Policy, nosniff, HSTS con https | `src/middleware.ts`, `build.inlineStylesheets:'never'` | J1 con CSP estricta (`tests/e2e/journeys/j1-bookmarklet.spec.ts`); `Cache-Control: no-store` en `tests/e2e/seguridad/protecciones.spec.ts`. Sin prueba dedicada de las cabeceras CSP/HSTS (comprobadas a mano con `curl -i`) | parcial |
| Rate limits: login (por IP y por email+IP), guardado 60/min/token, "Obtener datos" 30/min/usuario | `rate_limits`, `src/server/security/` | `tests/unit/auth/rate-limit.test.ts`, `tests/unit/auth/client-ip.test.ts`; 429 de login en `tests/e2e/seguridad/protecciones.spec.ts` | implementada |
| Token del bookmarklet derivado por HMAC (sin guardarse), tiempo constante, rotable, solo guarda | `bookmarkletService`, HKDF por propósito | `tests/unit/auth/bookmarklet-verify.test.ts`, `tests/unit/auth/bookmarklet-href.test.ts`; matriz popup (`tests/e2e/estados/popup.spec.ts`) | implementada |
| Guarda SSRF con IP fijada, redirects revalidados, límites de tamaño y tiempo, solo HTML | `page-fetcher.ts` | `tests/unit/adapters/ssrf.test.ts`, `tests/integration/adapters/page-fetcher.test.ts`, `tests/integration/jobs/real-fetcher.test.ts` | implementada |
| Favicons: ≤ 100 KB, magic bytes, sin SVG, nosniff, solo al dueño | adapters, `/favicons/:dominio` | `tests/unit/adapters/html-extract.test.ts`, `tests/integration/adapters/page-fetcher.test.ts`, `tests/integration/data/isolation.test.ts` | implementada |
| Logs JSON redactados (sin tokens, cookies, contraseñas, query ni URLs) | `src/server/log.ts` | Sin prueba automática dedicada (limitación conocida) | sin prueba |
| Audit inmutable de eventos de seguridad (365 días) | `audit_events` + trigger | `tests/integration/auth/auth-flows.test.ts`, `tests/integration/jobs/maintenance.test.ts` | implementada |
| Webhooks y firmas de proveedores | No aplica (no hay proveedores externos) | — | no aplica |

## 11. Operaciones

| Requisito | Implementación | Pruebas | Estado |
|---|---|---|---|
| Migraciones solo hacia adelante con copia previa | `scripts/migrate.ts`, `src/server/db/sqlite.ts` | `tests/integration/ops/backup-restore.test.ts`; `npm run db:migrate` ejecutado a mano en un clon limpio | implementada |
| `/healthz` (DB, migraciones, cola) | `src/pages/healthz.ts` | Sin prueba automática dedicada; comprobado a mano con `curl` (200 y JSON con `queue`) | parcial |
| Worker en proceso, `jobs:once` y mantenimiento horario | `src/server/jobs/`, `server/entry.mjs`, `scripts/jobs-once.ts` | `tests/integration/jobs/queue.test.ts`, `tests/integration/jobs/maintenance.test.ts` | implementada |
| Apagado ordenado | `server/entry.mjs` | Sin verificar (ni prueba ni ejecución manual) | sin verificar |
| Backup y restauración | `scripts/backup.ts`, `scripts/restore.ts`, `docs/operacion.md` | `tests/integration/ops/backup-restore.test.ts`; ida y vuelta ejecutada a mano | implementada |
| Usuarios por CLI | `scripts/user-create.ts` | Ejecutado a mano en un clon limpio | manual |
| Seed demo (alice, bob, dana), bloqueado en producción | `scripts/seed.ts`, `scripts/lib/seed.ts` | `tests/integration/ops/seed.test.ts` | implementada |
| Dockerfile que se construye en el test | `Dockerfile` | No se pudo construir en el entorno de redacción (sin Docker) | sin verificar |

## 12. Entregables y definición de hecho

| Requisito | Dónde | Verificación | Estado |
|---|---|---|---|
| README en español completo | `README.md` | "Developer nuevo" ejecutado desde un clon limpio (`npm ci`, `.env`, migrar, seed, build, start, login con los tres usuarios, `user:create`, backup, restore, `jobs:once` y `test:unit`) | verificado |
| `.env.example` con todas las variables | `.env.example` | Comparado con `src/server/config.ts` (14 variables) | verificado |
| Guion de pruebas de UX | `docs/pruebas-ux.md` | El dueño lo ejecuta | pendiente (manual) |
| Trazabilidad requisito → prueba | este archivo | Revisión al integrar | implementada |
| Marca aplicada | `docs/MARCA.md`, `src/styles/` | Revisión visual y `tests/e2e/visual/comparacion.spec.ts` | implementada |
| `npm test` en verde (`astro check` + Vitest + build + Playwright escritorio, Pixel 7, sin-JS) | `package.json` | La sesión principal registra el resultado final | por registrar |
| Metas con personas: ≥ 80 % de éxito sin ayuda y SUS ≥ 75 | `docs/pruebas-ux.md` §4 | Sesiones con 5 personas | pendiente (manual) |
| Bookmarklet verificado en Chrome, Firefox, Safari, iOS y Android; 3 sitios con CSP estricta | `docs/pruebas-ux.md` §1 | Manual | pendiente (manual) |
| Fuera de alcance (siguiente versión): importar/exportar, API, share target | README, "Limitaciones conocidas" | — | no aplica |

## 13. Pruebas de QA transversal

| Archivo | Cubre |
|---|---|
| `tests/e2e/sin-js/sin-js.spec.ts` | Entrar, Guardar en dos pasos, lote, favorito, Buscar, editar y papelera sin JavaScript (N9, J2, J3 sin JS) |
| `tests/e2e/helpers/{ui,teclado,datos}.ts` | Utilidades compartidas |
| `tests/e2e/design/{componentes,galeria}.spec.ts` | Galería de componentes y diseño |
| `tests/e2e/biblioteca/{a11y,capturas,permisos}.spec.ts`, `tests/e2e/buscar/{buscar-sin-js,permisos}.spec.ts`, `tests/e2e/bookmarklet/bookmarklet.spec.ts`, `tests/e2e/guardar/guardar.spec.ts` | Pruebas propias de cada pantalla |
| `tests/e2e/esqueleto.spec.ts`, `tests/e2e/fixtures-smoke.spec.ts`, `tests/integration/skeleton.test.ts` | Humo del esqueleto y de los fixtures |
| `tests/e2e/rendimiento/{biblioteca-carga,busqueda}.spec.ts`, `tests/e2e/visual/artefactos.spec.ts` | Etiquetadas `@nocturno`: solo corren con `npm run test:ux` |

Algunas pruebas dependen de pantallas de otros streams y llevan `[requiere: biblioteca|guardar|buscar]` en el título. Las marcas solo indican de qué pantalla depende cada prueba.
