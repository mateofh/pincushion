# Pincushion — plan técnico, de ejecución paralela y de pruebas UX (v2)

## Contexto
`/home/user` está vacío (greenfield). Construir un vertical slice production-ready de "Pincushion": alternativa enfocada a Raindrop.io para **una persona** que guarda links en todos sus dispositivos y necesita **volver a encontrarlos**. El usuario pidió: paralelizar al máximo, repo privado `mateofh/pincushion`, **servidor Node + SQLite**, **interfaz y README en español**, importación/exportación/share target/API **para la siguiente versión**, y un **plan de pruebas de UX y navegación**.

Verificado: Node 22.23.4 (corre TypeScript nativo), `node:sqlite` con FTS5 + highlight/snippet (SQLite 3.53), Playwright 1.63.0 + Chromium preinstalados, glibc 2.39. Astro 7.4.12 (Vite 8, Zod 4 en `astro/zod`, compilador Rust estricto con HTML inválido), `@astrojs/node` 11 con `mode:'middleware'` que exporta `handler` (no sirve estáticos: hace falta handler propio para `dist/client`), `security.checkOrigin` activo por defecto, `security.csp` estable (pero como `<meta>` en páginas on-demand y no funciona en `astro dev`), `export const partial = true` vigente, `@astrojs/check` exige TypeScript 5.x/6.x. `gh` del contenedor sin token válido.

## Cambios respecto a v1 (crítica aplicada)
1. **Ola 0 = esqueleto que camina** (login → guardar → listar → buscar + 1 e2e verde) antes de repartir: valida Astro 7, `node:sqlite`, el servidor propio y Playwright de una vez.
2. **Worktrees por agente** (puerto y DB propios), merge por ola hecho por mí; nada de 7 agentes en el mismo árbol.
3. **UI contra servicios reales**: backend + design system en la Ola 1, pantallas en la Ola 2. Cada agente de pantallas escribe y corre el e2e de su journey.
4. **Recortes**: sin signup, sin borrado de cuenta en UI, sin fusión de tags, sin edit grant HMAC, sin import/export/API/share target (v2). El token del bookmarklet **solo guarda**; editar en el popup usa la sesión normal (si no hay sesión: "Guardado ✓ — inicia sesión para añadir etiquetas").
5. **Bookmarklet instantáneo**: guarda con título/descripción enviados por el propio bookmarklet y responde de inmediato; excerpt y favicon llegan por job; el popup muestra el estado y se actualiza (HTMX polling / botón "Actualizar").
6. **Búsqueda para español**: tokenizador `unicode61 remove_diacritics 2` sin `porter` (inglés), prefijo en cada término, excerpt hasta 8000 chars (configurable), test de rendimiento con 10 000 bookmarks (p95 < 100 ms).
7. **Un dueño del diseño**: stream de design system con galería de componentes (`/_dev/componentes`, solo en desarrollo); reviso screenshots 390/1280 px en cada merge.
8. **HTML válido**: selección masiva con atributo `form="bulk"` en checkboxes (sin forms anidados).
9. CSP decidida en la Ola 0: header propio desde middleware, sin estilos/scripts inline ni atributos `style=` (`build.inlineStylesheets:'never'`, scripts externos; se verifica en el build), HTMX con `includeIndicatorStyles:false`.

**Revisión independiente aplicada** (agente revisor adversarial):
10. **Token del bookmarklet de verdad solo-guardar**: una página hostil puede interceptar `window.open` y leer el token. Las respuestas autenticadas solo por token dicen "guardado" o "ya estaba guardado"; no revelan datos, no restauran de la papelera; editar exige sesión.
11. **Sin tabla `jobs` ni ObjectStore**: la fila del bookmark es la cola (`attempts`, `next_attempt_at`, `lease_until`) → un solo estado, sin deriva. El favicon se obtiene en la misma corrida y se guarda como BLOB en `favicons(user_id, domain)` con CASCADE → sin filtración entre usuarios, sin limpieza de huérfanos, backup = un archivo.
12. **Sin `tags_text` en FTS**: el brief pide texto completo sobre títulos, descripciones y excerpts; las etiquetas son filtros. El trigger de update solo reindexa si cambian title/description/excerpt (marcar favorito no reindexa).
13. **Consulta de búsqueda** `"frase completa" OR (t1 AND t2 AND t3*)` → la frase exacta sale en un solo `<mark>` (aserción exacta en CONTRATOS).
14. **Paginación por cursor** `(created_at, id)`, 50 por página con enlaces normales; el lote actúa sobre "N seleccionados en esta página".
15. **Token derivado**: `id.HMAC(HKDF(APP_SECRET,"bookmarklet"), user|id)`; se guarda solo id + `revoked_at` (sin hash ni ciphertext). Subclaves HKDF por propósito; se rechaza un `APP_SECRET` corto; la página de setup va con `Cache-Control: no-store`.
16. **Middleware deniega por defecto** (auth + CSRF) con allowlist explícita de rutas públicas, para que ningún agente de UI lo olvide. "Obtener datos" es POST (un GET dispararía fetches salientes desde navegaciones cruzadas).
17. **SQLite operable**: WAL, `busy_timeout`, migraciones solo hacia adelante con `VACUUM INTO` (backup) antes de migrar; comillas simples en SQL.
18. **Seguridad de cookies por esquema de `APP_ORIGIN`** (no por `NODE_ENV`), para que el e2e corra contra el build real. Modo de prueba explícito (`PINCUSHION_TEST_MODE=1` + host:puerto exactos) habilita fixtures locales en el fetcher.
19. **Más recortes**: sin carol/`users.status`, sin `/readyz` ni página de diagnóstico (el estado y "Reintentar" viven en cada enlace), audit solo de eventos de seguridad. Se mantiene la papelera (recuperar algo borrado es una tarea clave de UX).

## Decisiones de arquitectura
- **Node.js + Astro 7 SSR**, `@astrojs/node` modo middleware detrás de `server/entry.mjs` (sirve `dist/client`, arranca worker y mantenimiento, apagado ordenado). En `astro dev` el worker arranca de forma perezosa desde el contexto de la app.
- **SQLite (`node:sqlite`)**, aislado en un solo archivo, detrás de una interfaz `Db` pequeña (`get/all/run/transaction`); los repos son la costura. Migraciones SQL numeradas con tabla `schema_migrations`. D1 queda fuera.
- **Cola en la fila del bookmark** (lease + reintentos con backoff), worker in-process + `npm run jobs:once`.
- **Auth** email+password (scrypt), sesiones en DB, rol único **owner**; usuarios por CLI (`npm run user:create`). Seeds: alice (con datos), bob (aislamiento), dana (cuenta vacía, primer uso).
- **UI** en español: Astro + formularios HTML con PRG; HTMX self-hosted (`allowEval=false`, `historyCacheSize:0`, swap en 422, `HX-Redirect` si la sesión expiró, `hx-select` sobre las páginas completas en vez de rutas parciales aparte). JS vanilla: selección masiva, copiar, shell del bookmarklet.
- Deps: astro, @astrojs/node, htmx.org, htmlparser2, sirv; dev: vitest, @playwright/test@1.63.0, @axe-core/playwright, @astrojs/check, typescript@~5.9.

## Propiedad y autorización
- Todo registro de dominio tiene `user_id`; **todo repo recibe `userId` y filtra por él** (listado, búsqueda, favicons, cola de metadatos).
- Recurso ajeno o inexistente → **404**. 403 para CSRF inválido; token revocado → 401 con mensaje accionable. Sin sesión → `/login?next=` (solo rutas relativas); sesión expirada → "Tu sesión expiró. Inicia sesión de nuevo; no se perdió nada."
- FKs compuestas `(bookmark_id,user_id)`, `(tag_id,user_id)`, `(collection_id,user_id)` hacen imposible mezclar tenants a nivel DB.

## Modelo de datos (`migrations/0001_init.sql`)
Instantes `INTEGER` ms UTC; `users.timezone` (IANA) para mostrar fechas.

| Tabla | PK | Atributos y restricciones clave |
|---|---|---|
| users | id | email UNIQUE lowercase ≤254, password_hash, timezone, created/updated_at |
| sessions | id = sha256(token) | user_id CASCADE, csrf_secret, created/last_seen/expires_at (30 d abs, 14 d idle), revoked_at |
| bookmarklet_tokens | id | user_id CASCADE, created_at, last_used_at, last_test_at, revoked_at; UNIQUE parcial (user_id) WHERE revoked_at IS NULL (el secreto se deriva por HMAC, no se almacena) |
| collections | id | user_id, name 1–80, name_key; UNIQUE(user_id,name_key); UNIQUE(id,user_id) |
| tags | id | user_id, name 1–40, name_key; UNIQUE(user_id,name_key); UNIQUE(id,user_id) |
| bookmarks | id INTEGER (rowid estable) | url ≤2048 CHECK http(s), normalized_url, domain, title 1–300, title_source CHECK(page,user,fallback), description ≤1000, excerpt ≤8000, collection_id (FK compuesta), is_favorite CHECK(0,1), **fetch_status** CHECK(pending,retrying,succeeded,failed,skipped), fetch_error_code, fetch_attempts, next_attempt_at, lease_until, fetched_at, created/updated_at, trashed_at; **UNIQUE(user_id, normalized_url)** |
| bookmark_tags | (bookmark_id, tag_id) | user_id; FKs compuestas CASCADE |
| bookmarks_fts | FTS5 external content | title, description, excerpt; `unicode61 remove_diacritics 2`; triggers AI/AD + AU solo `OF title, description, excerpt`; bm25 10/4/1 |
| favicons | (user_id, domain) | user_id CASCADE, status, content_type, bytes BLOB ≤100 KB, fetched_at, last_error_code |
| rate_limits | key | window_start, count |
| audit_events | id | user_id, type (seguridad), request_id, meta_json; trigger BEFORE UPDATE → ABORT |

Índices: `(user_id, trashed_at, created_at DESC, id)`, `(user_id, collection_id, created_at DESC, id)`, `(user_id, is_favorite, created_at DESC, id)`, `(user_id, domain)`, `(user_id, title COLLATE NOCASE)`, `bookmark_tags(tag_id)`, `bookmarks(fetch_status, next_attempt_at)`.
Transacciones (`db.transaction(fn)`): guardar/fusionar (bookmark + etiquetas), lote, borrar colección (enlaces a "Sin colección" + delete), vaciar papelera, rotar token.

## Ciclos de vida, retención e idempotencia
- **Enlace**: activo ↔ papelera (reversible, "Deshacer"; solo con sesión) → eliminado (terminal; confirmación con alcance o purga a 30 días). Guardar con sesión una URL en papelera ofrece restaurarla y fusiona.
- **fetch_status** (también es la cola): pending → succeeded | skipped (no HTML) | retrying (30 s · 2 min · 10 min ±20 %) → failed (terminal hasta "Reintentar"); lease vencido → retrying. 4xx (salvo 408/429) y dirección bloqueada = fallo terminal inmediato. Nunca pisa título/descripción con `title_source='user'`.
- **Token**: activo → revocado (rotación transaccional, terminal). **Sesión**: activa → expirada | revocada (salir, cerrar todas, cambio de contraseña).
- Audit inmutable (solo seguridad): login ok/fallido, sesiones revocadas, token rotado, contraseña cambiada.
- Mantenimiento horario: papelera >30 d, sesiones expiradas, rate_limits viejos, audit >365 d; los favicons se borran en CASCADE con el usuario y se purgan si no queda ningún enlace de ese dominio.
- Idempotencia: upsert por `(user_id, normalized_url)`; favorito con valor explícito; lote con `INSERT OR IGNORE`; papelera/restaurar no-op si ya está; claim de la cola atómico con `UPDATE … RETURNING` + lease.

## Reglas de dominio
- **Normalización**: trim, `https://` si falta, solo http/https, host lowercase + punycode, sin `www.`, http/https equivalentes en la clave, sin puerto por defecto, sin fragmento (salvo `#!`/`#/`), sin barra final, sin tracking (utm_*, fbclid, gclid, mc_*, igshid, ref_src…), query ordenada. Se abre la URL original.
- **Fusión**: tags = unión; "Actualizar existente" en Guardar reemplaza campos; el bookmarklet no pisa ediciones del usuario.
- **Búsqueda**: `"frase" OR (t1 AND … tN*)` con términos escapados, comillas del usuario = solo frase exacta, filtros etiqueta/colección/favoritos, excluye papelera, `LIMIT` + paginación; `<mark>` vía centinelas + escape HTML (único `set:html`, test anti-XSS).

## Integraciones
- **PageFetcher**: http/https, puertos 80/443, DNS validado con `net.BlockList` (privadas, loopback, link-local, CGNAT, multicast, ULA, mapeadas, `0.0.0.0/8`, `198.18/15`, `64:ff9b::/96`) y **conexión fijada a la IP validada**, redirects manuales ≤5 revalidados, timeout 8 s, cap 1.5 MB / 3 MB descomprimido, solo HTML, htmlparser2 sin scripts, sin cookies. Errores normalizados `{code, retryable}`. Fixtures locales solo con `PINCUSHION_TEST_MODE=1` y host:puerto exactos. Fake + servidor de fixtures (ok, 403, lento, enorme, redirect a 127.0.0.1, PDF, gzip bomb).
- **Favicons**: misma guarda, en la misma corrida que los metadatos, ≤100 KB, verificación de magic bytes (PNG/ICO/GIF/JPEG/WebP; **sin SVG**), servidos con `nosniff` desde la DB solo a su dueño; fallback monograma; atributo `data-favicon="fetched|fallback"` para las pruebas.
- **Bookmarklet**: `window.open('{APP}/bookmarklet/guardar#t=TOKEN&u=…&ti=…&de=…')` (fallback: navegar la pestaña); token en el fragmento, borrado con `replaceState`, POST same-origin; verificación HMAC en tiempo constante, rate limit 60/min. Guarda al instante con título/descripción del propio bookmarklet e intenta metadatos + favicon inline (≤3 s) antes de mostrar la confirmación; si no alcanza, sigue en la cola.
- No aplican: firmas de webhooks entrantes ni tokens de proveedores (no hay proveedores externos); se documenta en el README.
- `.env.example`: `APP_ORIGIN, APP_SECRET, DATABASE_PATH, PORT, HOST, TRUST_PROXY, LOG_LEVEL, JOBS_INLINE_WORKER, METADATA_TIMEOUT_MS, METADATA_MAX_BYTES, EXCERPT_MAX_CHARS, RATE_LIMIT_LOGIN_PER_MIN, PINCUSHION_TEST_MODE`.

## Seguridad transversal
Cookie HttpOnly + SameSite=Lax + Secure y `__Host-` cuando `APP_ORIGIN` es https, id rotado al login; middleware deniega por defecto; CSRF synchronizer token + header en HTMX + chequeo de Origin contra `APP_ORIGIN`; CSP por header, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS con https; rate limits configurables (login 5/min por IP y 20/h por (email, IP) para que nadie bloquee al dueño; guardado 60/min/token; "Obtener datos" 30/min/usuario); logs JSON con `request_id`/`job_id`, redactando tokens, cookies, contraseñas, query strings y URLs (solo dominio).

## Rutas y pantallas (URLs en español)
Cada pantalla: acción primaria, secundarias, estado visible, validación, vacío, pendiente, éxito (flash `role=status` + `aria-live`), fallo recuperable con código de referencia.
- `/` **Biblioteca**: `?vista=tarjetas|lista` (persistida en cookie), barra lateral (Todos, Favoritos, Sin colección, colecciones con conteo, etiquetas, Papelera), filtro por etiqueta, orden (recientes/antiguos/título/dominio), selección masiva (añadir/quitar etiqueta, mover, favorito, papelera), edición rápida, papelera con Deshacer. Móvil: filtros en hoja, barra de acciones fija abajo, tarjetas a una columna, targets ≥44 px.
- `/guardar`: URL → "Obtener datos" (POST; con HTMX: autofill) → título/descripción/excerpt editables, etiquetas (datalist + chips), colección, **aviso de duplicado** ("Ya lo guardaste el … · Guardar actualizará ese enlace y sumará las etiquetas").
- `/buscar`: un campo, `<mark>` en título y excerpt, filtros, vacío con consejos.
- `/bookmarklet`: link arrastrable, copiar/pegar (con instrucciones móviles), rotar token (confirmación), **prueba de guardado** (`/bookmarklet/prueba`). Popup: guardado / ya estaba guardado / token revocado / página no guardable / demasiados intentos; con sesión muestra el formulario de edición.
- La Biblioteca vacía es una guía de 2 pasos: instalar el bookmarklet → hacer la prueba (o pegar una URL).
- Resto: `/enlaces/:id` (editar, estado del fetch con "Reintentar"), acciones `favorito|papelera|restaurar|eliminar|reintentar`, `/enlaces/lote`, `/colecciones`, `/etiquetas`, `/papelera`, `/bookmarklet/guardar`, `/bookmarklet/guardado/:id`, `/favicons/:dominio`, `/entrar`, `/salir`, `/ajustes` (zona horaria, contraseña, cerrar todas las sesiones), `/healthz` (DB + migraciones + cola), páginas 403/404/429/500.
- La matriz completa pantalla × 8 estados (incluido el popup) se escribe en `docs/CONTRATOS.md` en la Ola 0, antes de repartir.

## Plan de pruebas de UX y navegación (v2)
**Objetivo**: demostrar que alguien que nunca vio Pincushion completa los 3 journeys sin ayuda, en escritorio y teléfono, con teclado y sin JavaScript, sin perder datos ante fallos comunes.

**Crítica de la v1 aplicada**: (1) no cubría la matriz de 8 estados por pantalla que exige el brief; (2) faltaba la prueba de primer uso (cuenta vacía, sin tour), que es el criterio central del brief; (3) "≤ 3 clics" era arbitrario: ahora hay presupuesto de pasos por tarea; (4) no decía que arrastrar a la barra de favoritos **no se puede automatizar** (es chrome del navegador): ahora se separa lo automatizable de lo manual; (5) faltaba el caso "varios dispositivos" (la persona del brief); (6) 5 anchos × todos los estados de screenshots = suite lenta y frágil: ahora se compara en pocas pantallas y el resto son artefactos de revisión; (7) no había presupuesto de rendimiento percibido ("rápido, calmado"); (8) faltaban casos de contenido extremo y de textos en español (terminología, fechas); (9) faltaba aislamiento de datos y control de flakiness; (10) las sesiones con personas y la pasada con lector de pantalla no las puedo hacer yo: quedan como tareas del owner con guion listo; (11) no había trazabilidad requisito → prueba ni qué bloquea el merge; (12) de la revisión independiente: el journey 1 tenía cuatro trampas (fixture en loopback bloqueado por la guarda SSRF, app y fixture en el mismo sitio compartiendo cookies, favicon asíncrono sin señal observable, popup), la aceptación 1 con timeout esperaría 12 min de backoff, la aceptación 3 con AND de términos partía la frase en varios `<mark>`, y el rate limit de login rompería Playwright.

### 1. Contrato de navegación (lo que se prueba)
- Barra global idéntica en todas las pantallas: logo → Biblioteca, buscador, botón primario **"Guardar enlace"** siempre en el mismo lugar, menú (Bookmarklet, Ajustes, Salir). Móvil: barra compacta + botón primario fijo abajo a la derecha, sin tapar la barra de acciones de selección.
- Estado en la URL: filtros, vista, orden, página y búsqueda viven en la query → refrescar, atrás/adelante y abrir en otra pestaña conservan el estado.
- PRG en todo POST: se vuelve al contexto de origen (`volver=` validado, solo rutas relativas) con confirmación visible y foco en ella.
- Ningún callejón sin salida: toda pantalla vacía o de error ofrece el siguiente paso.
- Glosario fijo en la UI: "enlace" (lo guardado), "colección", "etiqueta", "favorito", "papelera". Nada de "bookmark"/"marcador" mezclado; fechas en español y en la zona horaria del usuario.

### 2. Presupuesto de pasos por tarea (medido en los e2e)
| Tarea | Presupuesto |
|---|---|
| Guardar con el bookmarklet | 1 clic, 0 campos obligatorios, confirmación visible < 1 s |
| Guardar pegando una URL | pegar + 1 clic ("Guardar"); autofill sin acción extra con JS |
| Etiquetar y mover 3 enlaces | seleccionar 3 + 2 acciones de lote, sin salir de la Biblioteca |
| Encontrar por una frase | escribir en el buscador global + 1 clic al resultado |
| Marcar favorito | 1 clic desde resultado, tarjeta o detalle |
| Recuperar algo borrado | "Deshacer" en 1 clic, o Papelera → Restaurar |

### 3. Matriz de estados por pantalla (requisito del brief)
Para **Biblioteca, Guardar, Buscar, Bookmarklet** (y Editar, Papelera, Entrar) se prueban los 8 estados: acción primaria, secundarias, estado visible, validación, vacío, pendiente, éxito, fallo recuperable. Cada celda tiene un test (`tests/e2e/estados/<pantalla>.spec.ts`) que provoca el estado y verifica texto visible, rol ARIA y siguiente paso. Ejemplos: Guardar → URL inválida muestra el error junto al campo **conservando lo escrito**; duplicado muestra "Ya lo guardaste el 3 nov · Guardar actualizará ese enlace"; fallo de red al obtener datos → "No se pudo leer la página. Puedes guardar igual o reintentar". Buscar → vacío con consejos; sin resultados con sugerencias y "Quitar filtros". Biblioteca → vacía (primer uso), colección vacía, filtros sin resultados.

### 4. Escenarios automatizados (Playwright)
Proyectos: `escritorio` (Chromium 1280×800), `movil` (Pixel 7), `sin-js` (Chromium, JS apagado). Solo Chromium está instalado: Firefox y Safari van a la pasada manual (§7).

| ID | Escenario | Verifica | Proyectos |
|---|---|---|---|
| J1 | Journey 1: abrir la página de fixtures (servida en `localhost`, la app en `127.0.0.1` → otro sitio, sin cookies compartidas, con CSP estricta), ejecutar el `href` decodificado del bookmarklet con `page.evaluate` y capturar el popup con `context.waitForEvent('page')` (el popup no se cierra solo) | título, descripción y favicon visibles (`data-favicon="fetched"`); el excerpt queda buscable; con popup bloqueado, el fallback navega la pestaña | escritorio, movil |
| J2 | Journey 2: seleccionar 3, añadir etiqueta, mover a colección nueva, abrir la colección en vista tarjetas | conteos de la barra lateral, persistencia tras recargar | escritorio, movil, sin-js |
| J3 | Journey 3: buscar frase a medias, abrir el enlace (nueva pestaña), marcar favorito | `<mark>` en título/excerpt, favorito persiste tras recargar | escritorio, movil, sin-js |
| A1 | Página que bloquea el fetch (fixture **403**, fallo terminal sin backoff) vía Guardar | se guarda con la URL y título de respaldo; editar el título, pulsar "Reintentar", y el título editado sobrevive | escritorio |
| A2 | Misma URL (variantes: `http`/`www`/`utm_*`/barra final) guardada dos veces con etiquetas distintas | 1 solo enlace con la unión de etiquetas; aviso de duplicado visible antes del segundo guardado | escritorio |
| A3 | Frase que solo aparece en el excerpt | el resultado aparece con la frase completa dentro de **un** `<mark>`; título sin coincidencias | escritorio, movil |
| P1 | **Primer uso** con cuenta vacía (`dana`, sin tour) | la Biblioteca vacía explica qué hacer; desde ahí se llega a guardar el primer enlace y a instalar el bookmarklet sin ayuda | escritorio, movil |
| D1 | **Varios dispositivos**: guardar en un contexto "teléfono" y ver en otro contexto "escritorio" | aparece tras recargar; editar en uno se ve en el otro | escritorio |
| N1 | Barra global en cada pantalla | mismos landmarks, `<title>` único, `aria-current="page"` | escritorio, movil |
| N2 | Filtros + vista + orden, luego recargar y atrás/adelante | estado intacto; el historial reproduce cada paso | escritorio |
| N3 | Enlaces directos (`/buscar?q=…`, `/?coleccion=…&vista=tarjetas`, `/enlaces/:id`) | cargan con el estado correcto | escritorio |
| N4 | Sin sesión → página protegida | `/entrar?next=…` y regreso al destino tras entrar | escritorio |
| N5 | Sesión expirada al enviar una edición | mensaje claro; tras re-login se ofrece reenviar y **no se pierde lo escrito** | escritorio |
| N6 | URL adivinada de otro usuario (bob → enlace de alice) en GET y POST | 404 con salida a la Biblioteca; nada cambia | escritorio |
| N7 | `next`/`volver` con `//evil.com`, `https://…`, `javascript:` | se ignora → `/` | escritorio |
| N8 | Páginas 403/404/429/500 | mensaje humano, código de referencia, botón para continuar | escritorio, movil |
| N9 | Guardar/editar/mover/papelera | vuelve al contexto de origen con flash; "Deshacer" funciona | escritorio, sin-js |
| N10 | Doble clic en Guardar y recargar tras POST | un solo enlace, sin aviso de reenvío | escritorio |
| R1 | HTMX falla (500 o red caída con `page.route`) | error recuperable y el formulario normal sigue funcionando | escritorio |
| R2 | Job de metadatos lento → falla → "Reintentar" | estados "obteniendo datos…" → "no se pudo leer la página · Reintentar" → "listo", anunciados | escritorio |
| C1 | Contenido extremo: título de 300 caracteres, sin título, emoji/RTL, 40 etiquetas, URL de 2000 caracteres, biblioteca de 0/1/1000 enlaces | sin desbordes ni scroll horizontal; truncado con texto completo accesible | escritorio, movil |

### 5. Teclado, lector de pantalla y accesibilidad (automatizado)
- J2 y J3 se ejecutan **solo con teclado** (sin `click`): saltar al contenido, selección con espacio, acciones de lote, buscador con atajo `/`.
- Foco visible en todo control (contraste ≥ 3:1); Escape cierra diálogos y devuelve el foco; tras PRG el foco va a la confirmación o al `h1`.
- Resultados en vivo y cambios de estado de los metadatos anunciados por `aria-live` (se verifica el texto del live region).
- axe-core en cada celda de la matriz §3 y en móvil: **cero violaciones serias o críticas**.
- Ningún estado comunicado solo por color: favorito, seleccionado y fallo tienen icono + texto accesible (aserción en el DOM).
- `prefers-reduced-motion`, zoom 200 % y texto al 200 %: sin animaciones, sin scroll horizontal.

### 6. Responsive y rendimiento percibido
- **Comparación visual** (`toHaveScreenshot`, tolerancia baja) solo para Biblioteca (tarjetas y lista), Guardar, Buscar con resultados y Bookmarklet, en 390 y 1280 px. Datos y fecha congelados; fuentes locales.
- **Artefactos de revisión** (no bloquean): todas las pantallas y estados en 360, 768, 1024 y 1440 px, publicados en el reporte HTML para revisión humana en cada merge.
- Checks automáticos: sin scroll horizontal, targets táctiles ≥ 44×44 px, la barra de acciones móvil no tapa contenido, el campo activo en Guardar queda visible con el teclado virtual (viewport reducido).
- Presupuestos con 1000 enlaces, CPU ×4 y red "Fast 3G" (CDP) en móvil: Biblioteca con contenido visible < 1.5 s; respuesta del servidor de búsqueda p95 < 150 ms; JS enviado < 30 KB gzip.

### 7. Lo que hace el owner (no automatizable desde aquí), con guion en `docs/pruebas-ux.md`
- **Bookmarklet real**: arrastrar a la barra en Chrome, Firefox y Safari de escritorio; instalar por copia/pega en Safari iOS y Chrome Android; guardar desde 3 sitios con CSP estricta (p. ej. GitHub, un periódico, una SPA) y completar la prueba de guardado de `/bookmarklet/prueba`.
- **Lector de pantalla**: VoiceOver (iOS Safari) y NVDA o VoiceOver (escritorio) sobre J1–J3.
- **Sesiones con 5 personas** (al menos 2 que usan sobre todo el teléfono), sin explicar la interfaz: instalar el bookmarklet y guardar; etiquetar y mover 3 enlaces; encontrar un artículo recordando solo una frase; recuperar algo borrado; guardar desde el teléfono. Métricas: éxito, tiempo, caminos equivocados, SEQ por tarea, SUS. Meta: ≥ 80 % de éxito sin ayuda y SUS ≥ 75. Hallazgos clasificados bloqueante/grave/menor con plantilla incluida.
- Antes de las sesiones: evaluación heurística (Nielsen) mía sobre las 4 pantallas y prueba de 5 segundos de la Biblioteca vacía ("¿qué harías primero?").

### 8. Datos, estabilidad y gates
- Cada test crea su propio usuario y datos mediante fixtures de servicio (no por la UI ni por el seed demo) → los workers de Playwright corren en paralelo sin interferir.
- Login una vez por usuario con `storageState`; N4/N5 y los tests de login sí pasan por el formulario. Los límites de rate se leen del entorno (más altos en e2e) y un test dedicado comprueba el 429 con el límite real.
- E2E siempre contra el **build** (`astro build` + `server/entry.mjs`) con `PINCUSHION_TEST_MODE=1`; reloj y fetcher deterministas (fixture server local, sin internet); sin `sleep`, solo esperas por estado; `retries: 0` en local y 1 en CI con trace solo en el reintento.
- **Bloquean el merge** (`npm test`): J1–J3, A1–A3, P1, D1, N1–N10, R1–R2, C1 (hasta 50 enlaces), matriz de estados, teclado, axe, comparación visual.
- **Nocturno / pre-release** (`npm run test:ux`): C1 con 1000 enlaces, presupuestos de rendimiento, artefactos de 4 anchos.
- **Trazabilidad**: `docs/trazabilidad.md` mapea cada requisito del brief (journeys, pantallas×estados, escenarios, permisos, móvil) a sus IDs de prueba; el reporte HTML de Playwright se adjunta como artefacto.

### 9. Ubicación
`tests/e2e/{journeys,aceptacion,primer-uso,navegacion,estados,resiliencia,contenido,a11y,visual,rendimiento}/*.spec.ts`, fixtures en `tests/e2e/fixtures/` (servidor de sitios de prueba, fábrica de usuarios y datos), guion manual en `docs/pruebas-ux.md`.

## Ejecución paralela
**Paso 0 – repo**: el `gh` del contenedor no tiene token válido. El usuario crea el repo vacío privado `mateofh/pincushion` en github.com/new (y conecta GitHub en https://claude.ai/connect-github si hace falta); lo adjunto con `add_repo(mateofh, pincushion, push)` y hago push. Mientras tanto, `git init` local.

**Ola 0 – esqueleto que camina (yo)**: scaffold, `npm install` único, config Astro/TS/Vitest/Playwright, `server/entry.mjs`, migración completa, `Db` + migrador, config, logger, errores, `AppContext`, middleware mínimo de sesión, layout + tokens CSS, helpers de test (DB en memoria, servidor de fixtures, arranque de app con DB temporal), contratos (`src/server/contracts.ts` + `docs/CONTRATOS.md`: rutas, campos, labels en español que usan los e2e) y un recorrido login → guardar → listar → buscar con un e2e verde. Commit + push.

**Ola 1 – 5 agentes en paralelo (worktrees)**:
| # | Stream | Propiedad |
|---|---|---|
| 1 | Dominio: normalización, validación, tags, query de búsqueda, highlight, máquinas de estado, predicados de authz + unit tests | `src/domain/**` |
| 2 | Datos y servicios: repos, guardar/fusionar, bulk, colecciones, etiquetas, papelera, búsqueda FTS + integración (constraints, scoping, rendimiento 10k) | `src/server/repos/**`, `src/server/services/**` |
| 3 | Integraciones y cola: fetcher, SSRF, extracción, favicons, cola en la fila del bookmark, worker, mantenimiento + tests éxito/timeout/retry/rechazo contra el fixture server | `src/server/adapters/**`, `src/server/jobs/**` |
| 4 | Auth y seguridad: sesiones, CSRF, rate limit, headers/CSP, token derivado del bookmarklet, entrar/salir, ajustes, páginas de error, CLI (único dueño de todo lo de tokens, ajustes y CLI) | `src/server/auth/**`, `src/server/security/**`, `src/middleware.ts` |
| 5 | Design system: tokens, componentes (botones, campos, chips, tarjeta/fila de bookmark, barra lateral, hoja móvil, flash, vacío, diálogo de confirmación), galería `/_dev/componentes`, screenshots base | `src/components/ui/**`, `src/styles/**` |

**Ola 2 – 4 agentes en paralelo (worktrees, contra servicios reales)**:
| # | Stream | Incluye sus pruebas |
|---|---|---|
| 6 | Biblioteca, colecciones, etiquetas, papelera, edición, lote, primer uso | J2, P1, N2, N3, N9, N10, C1, estados de Biblioteca/Editar/Papelera |
| 7 | Guardar, bookmarklet (setup, popup, prueba), favicons | J1, A1, A2, D1, R2, estados de Guardar/Bookmarklet/popup |
| 8 | Buscar, favorito, salud | J3, A3, estados de Buscar |
| 9 | Ops y QA transversal: seed, README en español, `.env.example`, Dockerfile (se construye en el test), backup/restore, N1/N4–N8, R1, a11y, visual, rendimiento, `docs/pruebas-ux.md`, `docs/trazabilidad.md` | — |

Reglas de las olas: `package.json`, `playwright.config.ts`, layout global y `docs/CONTRATOS.md` solo los toco yo; cada agente trabaja en su worktree/rama con `node_modules` enlazado, puerto, `DATABASE_PATH` y `outDir` propios; ningún agente hace `git stash`/`checkout .` ni formatea todo el repo.

**Ola 3 – integración y verificación (yo + 4 agentes)**: merge, `npm test` completo; luego en paralelo: revisión de seguridad, revisión UX/a11y/móvil con screenshots, "developer nuevo" desde clon limpio, simplificación. Arreglos → `npm test` verde → commit + push.

## Seed (`npm run db:seed`, bloqueado en producción)
alice: ~25 enlaces en Lectura/Recetas/Herramientas/Viajes con etiquetas, favoritos y excerpts; 1 fetch `failed`, 1 `retrying`; 1 en papelera (restaurable) y 1 vencido (31 días, lo purga el mantenimiento); colección vacía "Algún día"; un token revocado. bob con enlaces propios (404 cruzado). dana sin enlaces (primer uso). Credenciales demo en el README.

## Verificación
- `npm test` = `astro check` + Vitest (unit + integración, DB aislada por test) + `astro build` + Playwright (desktop, Pixel 7, sin-JS).
- Escenarios de aceptación y los 3 journeys automatizados (ver N11/N12); permisos bob→alice cubiertos.
- Manual: `npm run db:migrate && npm run db:seed && npm run dev`, entrar como alice, bob y dana, recorrer los journeys en escritorio y móvil, `/healthz` verde.
