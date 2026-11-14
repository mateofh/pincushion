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
npm install

# Variables de entorno (al menos APP_SECRET, de 32 caracteres o más)
export APP_SECRET="$(openssl rand -hex 32)"
export DATABASE_PATH=./data/pincushion.db

npm run db:migrate
npm run user:create -- --email tu@correo.com --password 'una-contraseña-larga'
npm run dev
```

Abre <http://localhost:4321> y entra con el usuario que acabas de crear. No hay registro público: los usuarios se crean por línea de comandos. `user:create` pide una contraseña de 10 a 200 caracteres y acepta `--timezone Europe/Madrid` (por defecto `UTC`).

Node no lee `.env` por sí solo. Puedes copiar `.env.example` a `.env` y cargarlo con `node --env-file=.env`, o exportar las variables en tu shell como arriba. Los scripts `npm run` no cargan `.env` automáticamente.

## Variables de entorno

Se leen y validan una sola vez al arrancar (`src/server/config.ts`); un valor inválido detiene el arranque con el mensaje "Configuración inválida: …". Los booleanos aceptan `0`, `1`, `true` o `false`. Hay un ejemplo comentado en [`.env.example`](.env.example).

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:4321` | Origen público de la app. Si es `https`, las cookies pasan a `Secure` con prefijo `__Host-` y se envía HSTS. También se usa para validar `Origin` en las mutaciones (CSRF). |
| `APP_SECRET` | **obligatoria**, mínimo 32 caracteres | Secreto maestro. De él se derivan (HKDF) las claves del token del bookmarklet. Cambiarlo invalida esos tokens (ver [operación](docs/operacion.md)). |
| `DATABASE_PATH` | `./data/pincushion.db` | Archivo SQLite. Su carpeta debe estar en un volumen persistente. |
| `PORT` | `4321` | Puerto del servidor Node. |
| `HOST` | `127.0.0.1` | Interfaz de escucha. Usa `0.0.0.0` dentro de un contenedor. |
| `TRUST_PROXY` | `0` | Declara que hay un proxy inverso de confianza. (pendiente de verificar: en esta rama ningún código lo consume todavía; lo implementa el stream de seguridad) |
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
- `user:create` y `/healthz` avisan si hay migraciones pendientes; la app no migra sola al arrancar.

## Seed y credenciales demo

```bash
npm run db:seed
```

El script `scripts/seed.ts` lo entrega otro stream y **no existe todavía en esta rama** (pendiente de verificar: comando, contenido y bloqueo en producción). Según el plan crea tres usuarios con la contraseña `pincushion-demo`:

| Usuario | Para qué sirve |
|---|---|
| `alice` | Unos 25 enlaces en Lectura, Recetas, Herramientas y Viajes con etiquetas y favoritos; un fetch fallido, uno reintentando, uno en papelera y uno vencido; la colección vacía "Algún día"; un token de bookmarklet revocado. |
| `bob` | Enlaces propios, para comprobar que un usuario recibe 404 ante enlaces ajenos. |
| `dana` | Cuenta vacía: primer uso. |

El seed está bloqueado en producción. Nunca uses estas credenciales fuera de desarrollo. El login de la app es por email (`/entrar` pide "Email" y "Contraseña"), así que el seed debe crear emails; (pendiente de verificar: qué emails exactos usa el seed para alice, bob y dana).

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm test` | `astro check` + Vitest + build + Playwright. Es la puerta de merge. |
| `npm run test:unit` | Solo Vitest (`vitest run`): unitarias e integración con DB aislada. |
| `npm run test:e2e` | `astro build` y Playwright contra el build real (proyectos `escritorio`, `movil` = Pixel 7 y `sin-js`). |
| `npm run test:ux` | Build + los tests etiquetados `@nocturno` (contenido extremo con 1000 enlaces, presupuestos de rendimiento, capturas en varios anchos). |
| `npm run check` | Solo `astro check`. |

Playwright se ejecuta con `--trace off`. El e2e levanta su propia app (puerto 4410) y un sitio de fixtures en `localhost:4411`, sin internet. Solo se prueba automáticamente en Chromium; Firefox y Safari van en la [guía manual](docs/pruebas-ux.md). La trazabilidad requisito → prueba está en [docs/trazabilidad.md](docs/trazabilidad.md).

## Despliegue

Pincushion es **un proceso Node**:

```bash
npm ci
npm run build
npm run db:migrate
npm start        # node server/entry.mjs
```

Pautas:

1. **Proxy HTTPS delante** (Caddy, nginx…): la app habla http; el proxy termina TLS y reenvía a `HOST:PORT`.
2. `APP_ORIGIN=https://tu-dominio` activa cookies `Secure` con prefijo `__Host-` y HSTS. Debe coincidir con la URL pública exacta.
3. `TRUST_PROXY=1` cuando haya proxy (ver la nota de verificación pendiente en la tabla de variables).
4. **Volumen persistente** para la carpeta de `DATABASE_PATH` (la DB, su `-wal`/`-shm` y `backups/`).
5. **Un solo proceso**: SQLite con WAL y worker en proceso no están pensados para varias réplicas.
6. `APP_SECRET` largo y aleatorio, guardado fuera del repositorio.
7. Comprobación de salud: `GET /healthz` (200 si todo está bien, 503 si hay migraciones pendientes o la DB no responde). Ver [docs/operacion.md](docs/operacion.md).
8. El servidor se apaga ordenadamente con `SIGTERM`/`SIGINT` (espera conexiones abiertas hasta 10 s).

El plan prevé un `Dockerfile`; lo entrega el stream de ops (pendiente de verificar).

## Bookmarklet

En **Bookmarklet** (`/bookmarklet`, requiere sesión) encuentras el enlace para arrastrar a la barra de favoritos, un código para copiar y pegar (móviles) y una **prueba de guardado** (`/bookmarklet/prueba`). El guion para instalarlo en cada navegador está en [docs/pruebas-ux.md](docs/pruebas-ux.md). (pendiente de verificar: las pantallas de `/bookmarklet` las entrega el stream Guardar)

Cómo funciona, según el diseño:

- El token viaja en el fragmento de la URL (`#t=…`) y se borra con `replaceState`; el popup hace un POST same-origin.
- El token **solo puede guardar**: responde "guardado" o "ya estaba guardado". Editar en el popup exige la sesión normal.
- Hay un solo token activo por usuario. No se almacena el secreto: se deriva por HMAC de `APP_SECRET`; en la DB solo hay su id y la fecha de revocación.
- **Rotar el token** (en `/bookmarklet`, con confirmación) revoca el anterior: el bookmarklet viejo mostrará "Este bookmarklet ya no es válido" y hay que instalar el nuevo. Rota si crees que el token se filtró.
- Límite: 60 guardados por minuto por token.

## Copias de seguridad y restauración

Todo el estado vive en un archivo SQLite (favicons incluidos). Procedimiento de backup en caliente, restauración, retención y rotación de secretos: **[docs/operacion.md](docs/operacion.md)**.

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

(La implementación de varias de estas piezas la entregan otros streams; su verificación final es de la sesión principal al integrar.)

## Marca

El diseño sigue el sistema de Mateo Folador. Cómo se aplica y dónde se ajusta por accesibilidad: [docs/MARCA.md](docs/MARCA.md).

## Limitaciones conocidas

- Sin importar/exportar, API ni *share target* móvil: previstos para la siguiente versión.
- Solo Chromium se prueba automáticamente; Firefox y Safari dependen de la guía manual.
- `node:sqlite` es **experimental** en Node 22 (de ahí `--disable-warning=ExperimentalWarning` en los scripts); su API puede cambiar.
- Un solo proceso y un solo archivo SQLite; no hay alta disponibilidad.
- Sin registro público ni borrado de cuenta desde la interfaz; los usuarios se crean con `npm run user:create`.
- Sin recuperación de contraseña por email: se cambia en Ajustes con la sesión iniciada.
- En esta rama el worker de metadatos (`processDue`), el mantenimiento horario, `db:seed`, `jobs:once` y varias pantallas todavía son esqueleto o no existen; ver las marcas "pendiente de verificar".
- Las pruebas con personas, lector de pantalla y navegadores reales son manuales.

## Documentación

- [docs/operacion.md](docs/operacion.md): backup, logs, salud, recuperación de fallos.
- [docs/pruebas-ux.md](docs/pruebas-ux.md): guion de pruebas con personas.
- [docs/trazabilidad.md](docs/trazabilidad.md): requisitos → implementación → pruebas.
- [docs/PLAN.md](docs/PLAN.md), [docs/CONTRATOS.md](docs/CONTRATOS.md), [docs/MARCA.md](docs/MARCA.md), [CLAUDE.md](CLAUDE.md).
