# Pincushion

Pincushion es una biblioteca de enlaces para **una sola persona**: guardas páginas desde cualquier dispositivo (con un bookmarklet o pegando la dirección), las organizas con etiquetas y colecciones y, sobre todo, **las vuelves a encontrar** con una búsqueda de texto completo sobre título, descripción y texto guardado de la página.

La interfaz, las URLs y la documentación están en español.

**No es** (no-objetivos): una herramienta para compartir en equipo, un lugar para colecciones públicas, un generador de resúmenes con IA ni un modo lectura.

Stack: Node.js 22, Astro 7 en modo SSR (`@astrojs/node` en modo middleware detrás de `server/entry.mjs`), SQLite vía `node:sqlite` con FTS5 y HTMX como mejora progresiva. Todo funciona sin JavaScript salvo el propio bookmarklet.

## Requisitos

- Node.js **22.23.4 o superior** (campo `engines` de `package.json`).
- npm.
- No hay dependencias nativas: SQLite viene dentro de Node (`node:sqlite`), así que no hace falta compilar nada.
- Solo para las pruebas e2e: Chromium de Playwright (`npx playwright install chromium`).

## Instalación local

```bash
git clone <url-del-repositorio> pincushion
cd pincushion
npm ci

cp .env.example .env
# Edita .env y cambia APP_SECRET por uno propio:  openssl rand -hex 32

# Prepara la base de datos (todos los comandos leen ./.env solos)
npm run db:migrate
npm run db:seed            # opcional: datos y usuarios demo (alice, bob, dana)
npm run build
npm start                  # http://localhost:4321
```

Para desarrollo con recarga en caliente usa `npm run dev` en lugar de `build` + `start`. Sin seed, crea tu usuario: `npm run user:create -- --email tu@correo.com --password 'una-contraseña-larga'`. No hay registro público: los usuarios se crean por línea de comandos. `user:create` pide una contraseña de 10 a 200 caracteres y acepta `--timezone Europe/Madrid` (por defecto `UTC`).

**Sobre `.env`.** Todos los comandos (`npm start`, `npm run dev`, `db:*`, `user:create`, `jobs:once`) leen `./.env` del directorio donde los ejecutas. Las variables que ya estén definidas en el entorno (por ejemplo, las de tu gestor de procesos) tienen prioridad sobre `.env`.

`APP_ORIGIN` debe coincidir con la dirección que escribes en el navegador (incluido el puerto): si cambias `PORT`, cambia también `APP_ORIGIN`, o los formularios responderán 403 por la comprobación de `Origin`.

## Variables de entorno

Se leen y validan una sola vez al arrancar (`src/server/config.ts`); un valor inválido detiene el arranque con el mensaje "Configuración inválida: …". Los booleanos aceptan `0`, `1`, `true` o `false`. Hay un ejemplo comentado en [`.env.example`](.env.example) con las 14 variables.

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:4321` | Origen público de la app. Si es `https`, las cookies pasan a `Secure` con prefijo `__Host-` y se envía HSTS. También se usa para validar `Origin` en las mutaciones (CSRF). |
| `APP_SECRET` | **obligatoria**, mínimo 32 caracteres | Secreto maestro. De él se derivan (HKDF) las claves del token del bookmarklet. Cambiarlo invalida esos tokens (ver [operación](docs/operacion.md)). |
| `DATABASE_PATH` | `./data/pincushion.db` | Archivo SQLite. Su carpeta debe estar en un volumen persistente. |
| `PORT` | `4321` | Puerto del servidor Node. |
| `HOST` | `127.0.0.1` | Interfaz de escucha. Usa `0.0.0.0` dentro de un contenedor. |
| `TRUST_PROXY` | `0` | Con `1`, la IP del cliente para los límites de intentos se toma de la última entrada de `X-Forwarded-For` (la que añade tu proxy); con `0` se usa la IP del socket. No cambia cómo se detecta https: eso lo decide `APP_ORIGIN`. Actívalo solo con un proxy de confianza delante. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` o `silent`. |
| `JOBS_INLINE_WORKER` | `1` | Ejecuta el worker de metadatos dentro del proceso web. Con `0` no se procesa la cola salvo que lo hagas con `npm run jobs:once`. |
| `METADATA_TIMEOUT_MS` | `8000` | Tiempo máximo (500–30000 ms) para obtener los datos de una página. |
| `METADATA_MAX_BYTES` | `1500000` | Bytes máximos descargados por página (10 000–10 000 000). |
| `EXCERPT_MAX_CHARS` | `8000` | Largo máximo (200–8000) del texto guardado para la búsqueda. |
| `RATE_LIMIT_LOGIN_PER_MIN` | `5` | Intentos de login por minuto (1–10000) antes de responder 429. |
| `PINCUSHION_TEST_MODE` | `0` | Solo pruebas automáticas. Habilita `METADATA_TEST_HOSTS`. No activar en producción. |
| `METADATA_TEST_HOSTS` | vacío | Con `PINCUSHION_TEST_MODE=1`, lista `host:puerto` (separada por comas) que el fetcher puede visitar aunque sean locales. Sin test mode se ignora. |

Además, `server/entry.mjs` lee `ASTRO_OUT_DIR` (carpeta de build alternativa, solo para correr varios e2e en paralelo) y `PINCUSHION_MIGRATIONS_DIR` cambia la carpeta de migraciones; ninguna hace falta normalmente.

## Migraciones

```bash
npm run db:migrate
```

- Aplica en orden los archivos numerados de `migrations/` que falten (registro en la tabla `schema_migrations`), cada uno en su transacción.
- Si la base de datos ya existía y hay migraciones pendientes, **antes de migrar hace una copia con `VACUUM INTO`** en `backups/pre-migrate-<fecha>.db`, dentro de la carpeta de `DATABASE_PATH`. Si no hay nada pendiente imprime "La base de datos ya está al día."
- Las migraciones son **solo hacia adelante**: no hay "down". Para revertir, detén la app y restaura la copia previa (ver [docs/operacion.md](docs/operacion.md)).
- `user:create` y `/healthz` avisan si hay migraciones pendientes.
- Con `NODE_ENV=production` la app **no** migra al arrancar y falla si hay migraciones pendientes (la imagen Docker ya ejecuta `db:migrate` antes de arrancar). Sin `NODE_ENV=production` (por ejemplo `npm start` a secas o `npm run dev`) sí aplica las migraciones pendientes al crear la app, sin la copia previa; en un despliegue real ejecuta siempre `npm run db:migrate` tú.

## Seed y credenciales demo

```bash
npm run db:seed                 # crea los usuarios y datos demo que falten
npm run db:seed -- --reset      # borra antes los datos de los usuarios demo y los recrea
```

Exige que la base ya esté migrada. Es idempotente: los usuarios que ya existen conservan su contraseña y no se duplican enlaces. Se niega a ejecutarse con `NODE_ENV=production`, y también si `APP_ORIGIN` es `https` salvo que añadas `--force`. Al terminar imprime las credenciales.

El login es **por email** y la contraseña de los tres usuarios es `pincushion-demo`:

| Email | Para qué sirve |
|---|---|
| `alice@example.com` | 26 enlaces (24 visibles en la Biblioteca) en Lectura, Recetas, Herramientas y Viajes, con etiquetas y favoritos; uno con la obtención de datos fallida, uno reintentando, dos en la papelera; la colección vacía "Algún día"; un token de bookmarklet revocado. |
| `bob@example.com` | 6 enlaces propios y una colección ("Trabajo"), para comprobar que no ve nada de alice. |
| `dana@example.com` | Cuenta vacía: primer uso. |

Nunca uses estas credenciales fuera de desarrollo.

## Probar la interfaz

Con el seed cargado y la app en marcha, entra en <http://localhost:4321/entrar> y recorre:

1. **Biblioteca** (`alice@example.com`): tarjetas o lista, orden, filtros por colección, etiqueta y favoritos (todo en la URL), selección de varios enlaces y acciones por lote (etiquetar, mover a colección, papelera con "Deshacer").
2. **Guardar** (`/guardar`): pega una URL; con datos de red se rellenan título y descripción, y si la página no se puede leer el enlace se guarda igual y puedes editar el título. Guardar dos veces la misma URL avisa del duplicado en vez de crear otro.
3. **Bookmarklet** (`/bookmarklet`): arrastra "+ Pincushion" a la barra de marcadores, pulsa "Hacer la prueba" (`/bookmarklet/prueba`) y comprueba que aparece la señal de recibido. Instrucciones para móvil más abajo.
4. **Buscar** (`/buscar`, o la tecla `/`): prueba una palabra que solo esté en el texto guardado, por ejemplo `masa` (encuentra la receta de pan de masa madre de alice), y una frase entre comillas.
5. **Primer uso** (`dana@example.com`): Biblioteca vacía con dos caminos ("Instala el bookmarklet" y "Pega una URL").
6. **Aislamiento** (`bob@example.com`): abre un enlace de alice, por ejemplo `/enlaces/8` con la sesión de bob; responde 404, igual que si no existiera. Bob solo ve sus 6 enlaces.
7. **Ajustes** (`/ajustes`): zona horaria, cambio de contraseña y cerrar sesión en todos los dispositivos.

El guion completo de pruebas con personas está en [docs/pruebas-ux.md](docs/pruebas-ux.md).

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm test` | `npm run check` (`astro check`) + `npm run test:unit` + `npm run test:e2e` (build + Playwright). Es la puerta de merge. No ejecuta las pruebas `@nocturno`. |
| `npm run test:unit` | Solo Vitest (`vitest run`): unitarias e integración con DB aislada. |
| `npm run test:e2e` | `astro build` y Playwright contra el build real (proyectos `escritorio`, `movil` = Pixel 7 y `sin-js`). |
| `npm run test:ux` | Build + **solo** los tests etiquetados `@nocturno` (`NOCTURNO=1 playwright test --grep @nocturno`): presupuestos de rendimiento de la Biblioteca y la búsqueda, y capturas de todas las pantallas a 360, 768, 1024 y 1440 px en `test-results/visual/`. Las `@nocturno` quedan excluidas de `npm test`/`test:e2e`. |
| `npm run check` | Solo `astro check`. |

`npm run test:unit` incluye también las pruebas de integración (`tests/integration/`, con base de datos aislada). Playwright se ejecuta con `--trace off`; el reporte HTML queda en `playwright-report/`. El e2e levanta su propia app (puerto 4410, configurable con `E2E_APP_PORT`) y un sitio de fixtures en `localhost:4411` (`E2E_SITE_PORT`), sin internet, con una base de datos propia en `test-results/`. Necesita Chromium: `npx playwright install chromium`. Solo se prueba automáticamente en Chromium; Firefox y Safari van en la [guía manual](docs/pruebas-ux.md). La trazabilidad requisito → prueba está en [docs/trazabilidad.md](docs/trazabilidad.md).

## Despliegue

Pincushion es **un proceso Node**:

```bash
npm ci
npm run build
NODE_ENV=production npm run db:migrate
NODE_ENV=production npm start        # node server/entry.mjs
```

Pautas:

1. **Proxy HTTPS delante** (Caddy, nginx…): la app habla http; el proxy termina TLS y reenvía a `HOST:PORT`.
2. `APP_ORIGIN=https://tu-dominio` activa cookies `Secure` con prefijo `__Host-` y HSTS. Debe coincidir con la URL pública exacta.
3. `TRUST_PROXY=1` cuando haya proxy de confianza delante: sin él, todos los clientes parecen tener la IP del proxy y comparten los límites de intentos de login.
4. **Volumen persistente** para la carpeta de `DATABASE_PATH` (la DB, su `-wal`/`-shm` y `backups/`).
5. **Un solo proceso**: SQLite con WAL y worker en proceso no están pensados para varias réplicas.
6. `APP_SECRET` largo y aleatorio, guardado fuera del repositorio.
7. Comprobación de salud: `GET /healthz` (200 si todo está bien, 503 si hay migraciones pendientes o la DB no responde). Ver [docs/operacion.md](docs/operacion.md).
8. El servidor se apaga ordenadamente con `SIGTERM`/`SIGINT` (espera conexiones abiertas hasta 10 s).

### Docker

El repositorio incluye un `Dockerfile` multietapa (Node 22.23.4 sobre Debian slim, usuario no root, volumen `/data`, `HEALTHCHECK` contra `/healthz`). Al arrancar ejecuta `db:migrate` (con copia previa si la base ya existe) y después el servidor.

```bash
docker build -t pincushion .
docker run -d -p 4321:4321 -v pincushion-data:/data \
  -e APP_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN=https://enlaces.tu-dominio.es -e TRUST_PROXY=1 pincushion
docker exec -it <contenedor> node --disable-warning=ExperimentalWarning scripts/user-create.ts --email tu@correo --password '…'
docker exec <contenedor> node --disable-warning=ExperimentalWarning scripts/backup.ts --keep 7
```

`APP_SECRET` es obligatorio al ejecutar y no se hornea en la imagen. **No se ha podido construir ni ejecutar la imagen en el entorno donde se escribió esta documentación** (no había demonio de Docker): los comandos son los del comentario del `Dockerfile` y no están verificados.

## Bookmarklet

En **Bookmarklet** (`/bookmarklet`, requiere sesión) encuentras el enlace para arrastrar a la barra de favoritos, un código para copiar y pegar (móviles) y una **prueba de guardado** (`/bookmarklet/prueba`). El guion para instalarlo en cada navegador está en [docs/pruebas-ux.md](docs/pruebas-ux.md).

Instalación (según el texto de la pantalla `/bookmarklet`):

- **Escritorio**: arrastra el botón "+ Pincushion" a la barra de marcadores (Ctrl+Shift+B, o Cmd+Shift+B en Mac, la muestra). No lo pulses en la propia página de Pincushion.
- **iPhone o iPad (Safari)**: copia el código; en Safari añade cualquier página a marcadores (Compartir, «Añadir marcador»); abre Marcadores, pulsa «Editar» y entra en el que creaste; cambia el nombre a «+ Pincushion» y pega el código en el campo de dirección. Para usarlo, abre Marcadores en la página que quieras guardar y toca «+ Pincushion».
- **Android (Chrome)**: copia el código; guarda cualquier página como marcador (menú ⋮, estrella); edítalo desde Marcadores con el nombre «+ Pincushion» y el código como URL. Para usarlo, escribe «Pincushion» en la barra de direcciones y toca el marcador sugerido (Chrome no ejecuta marcadores desde el menú).

Cómo funciona, según el diseño:

- El token viaja en el fragmento de la URL (`#t=…`) y se borra con `replaceState`; el popup hace un POST same-origin.
- El token **solo puede guardar**: responde "guardado" o "ya estaba guardado". Editar en el popup exige la sesión normal.
- Hay un solo token activo por usuario. No se almacena el secreto: se deriva por HMAC de `APP_SECRET`; en la DB solo hay su id y la fecha de revocación.
- **Rotar el token** (en `/bookmarklet`, con confirmación) revoca el anterior: el bookmarklet viejo mostrará "Este bookmarklet ya no es válido" y hay que instalar el nuevo. Rota si crees que el token se filtró.
- Límite: 60 guardados por minuto por token.

## Copias de seguridad y restauración

Todo el estado vive en un archivo SQLite (favicons incluidos).

```bash
npm run db:backup                              # copia en caliente en <carpeta de la DB>/backups/pincushion-<fecha>.db
npm run db:backup -- --out /ruta/copia.db      # destino propio
npm run db:backup -- --keep 14                 # conserva las últimas 14 copias pincushion-*.db (por defecto 7; 0 = no borrar)

# Con la app parada:
npm run db:restore -- --from /ruta/copia.db
```

`db:backup` usa `VACUUM INTO` (seguro con la app en marcha), verifica la copia (`integrity_check` y tablas) y rota solo las copias `pincushion-*.db`. `db:restore` valida el origen, guarda la base actual en `backups/pre-restore-<fecha>.db`, elimina el `-wal`/`-shm` viejos y reemplaza el archivo de forma atómica; se niega a restaurar si el `-wal` se modificó hace menos de 10 s (servidor activo) salvo `--force`. Detalles, retención y rotación de secretos: **[docs/operacion.md](docs/operacion.md)**.

## Decisiones de seguridad

- **Denegar por defecto**: el middleware exige sesión en toda ruta salvo una lista explícita de públicas (`/entrar`, `/healthz`, `/bookmarklet/guardar`, `/bookmarklet/pagina-de-prueba`, `/404`, `/500` y estáticos).
- **Aislamiento por usuario**: toda consulta filtra por `user_id`, con claves foráneas compuestas en la DB. Un recurso ajeno o inexistente responde **404**, nunca 403.
- **CSRF**: token sincronizado por sesión, cabecera en HTMX y comprobación de `Origin` contra `APP_ORIGIN`. Respuesta 403 si falla.
- **CSP sin inline**: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`. Sin estilos ni scripts inline. Además `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y HSTS con https.
- **Sesiones**: cookie `HttpOnly`, `SameSite=Lax`, `Secure` y `__Host-` con https. En la DB solo se guarda el **hash (SHA-256)** del token de sesión. Caducan a los 30 días absolutos o 14 de inactividad.
- **Contraseñas** con scrypt. Rate limit de login configurable.
- **Token del bookmarklet** derivado por HMAC sin guardarse, verificado en tiempo constante, y limitado a **solo guardar**.
- **Guarda SSRF** en el fetcher de metadatos: solo http/https en puertos 80/443, DNS validado contra rangos privados/loopback/link-local/etc. y **conexión fijada a la IP validada**, redirecciones manuales revalidadas (máx. 5), sin cookies.
- **Límites** de tamaño y tiempo: `METADATA_MAX_BYTES`, `METADATA_TIMEOUT_MS`, 100 KB para favicons (sin SVG), solo HTML.
- **Logs JSON redactados**: nunca tokens, cookies, contraseñas ni URLs completas (solo dominio).
- **Webhooks y firmas de proveedores: no aplica.** Pincushion no recibe webhooks ni usa proveedores externos con credenciales.

## Marca

El diseño sigue el sistema de Mateo Folador. Cómo se aplica y dónde se ajusta por accesibilidad: [docs/MARCA.md](docs/MARCA.md).

## Limitaciones conocidas

- Sin importar/exportar, API ni *share target* móvil: previstos para la siguiente versión.
- Solo Chromium se prueba automáticamente; Firefox y Safari dependen de la guía manual.
- `node:sqlite` es **experimental** en Node 22 (de ahí `--disable-warning=ExperimentalWarning` en los scripts); su API puede cambiar.
- Un solo proceso y un solo archivo SQLite; no hay alta disponibilidad.
- Sin registro público ni borrado de cuenta desde la interfaz; los usuarios se crean con `npm run user:create`.
- Sin recuperación de contraseña por email: se cambia en Ajustes con la sesión iniciada. No hay comando para restablecerla: si la pierdes y no tienes otra sesión, crea otro usuario con `npm run user:create`.
- El Dockerfile no se ha podido construir en el entorno de redacción de esta documentación.
- Sin pruebas automáticas dedicadas para las cabeceras de seguridad (CSP/HSTS), `/healthz` ni la redacción de logs; las cabeceras y `/healthz` se comprobaron a mano.
- Las pruebas con personas, lector de pantalla y navegadores reales son manuales.

## Documentación

- [docs/operacion.md](docs/operacion.md): backup, logs, salud, recuperación de fallos.
- [docs/pruebas-ux.md](docs/pruebas-ux.md): guion de pruebas con personas.
- [docs/trazabilidad.md](docs/trazabilidad.md): requisitos → implementación → pruebas.
- [docs/PLAN.md](docs/PLAN.md), [docs/CONTRATOS.md](docs/CONTRATOS.md), [docs/MARCA.md](docs/MARCA.md), [CLAUDE.md](CLAUDE.md).
