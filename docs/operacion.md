# Operación de Pincushion

Guía para quien administra una instancia. Todo el estado vive en **un archivo SQLite** (`DATABASE_PATH`, con modo WAL: junto a él aparecen `-wal` y `-shm`). Los favicons también están dentro de la DB, así que una copia de ese archivo es una copia completa.

Marcas "(pendiente de verificar)": dependen de trabajo de otros streams que aún no estaba en la rama donde se escribió esta guía.

## Backup

### En caliente (la app puede seguir corriendo)

Con `VACUUM INTO`, que produce una copia consistente y compacta sin parar la app:

```bash
sqlite3 data/pincushion.db "VACUUM INTO '/ruta/backups/pincushion-$(date +%F).db'"
```

o con la API de copia en línea de SQLite:

```bash
sqlite3 data/pincushion.db ".backup '/ruta/backups/pincushion-$(date +%F).db'"
```

Requiere el binario `sqlite3` (no viene con Node). Sin él, puedes usar el propio Node:

```bash
node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DATABASE_PATH);
db.exec(\"VACUUM INTO '/ruta/backups/pincushion.db'\");
"
```

(El destino de `VACUUM INTO` no debe existir previamente.)

**No copies solo el `.db` con `cp` mientras la app corre**: puedes perder lo que aún está en el `-wal`.

El plan prevé el script `npm run db:backup` (lo entrega el stream de ops): **(pendiente de verificar)**; en esta rama no existe.

Recomendación: copia diaria a otro disco o servicio, conservando al menos 7 diarias. Guarda también `APP_SECRET` en un gestor de secretos: sin él los tokens del bookmarklet no se pueden verificar (ver más abajo).

### Copias automáticas al migrar

`npm run db:migrate` crea `backups/pre-migrate-<fecha>.db` junto a la DB antes de aplicar migraciones pendientes (solo si la DB ya existía). Esas copias no se borran solas.

## Restauración

1. Detén la app (`SIGTERM`).
2. Aparta la DB actual por si acaso: mueve `pincushion.db`, `pincushion.db-wal` y `pincushion.db-shm`.
3. Copia el backup a `DATABASE_PATH` (renombrándolo si hace falta). Borra cualquier `-wal`/`-shm` antiguo: la copia no los necesita.
4. Si el backup es de una versión anterior del esquema: `npm run db:migrate`.
5. Arranca la app y comprueba `GET /healthz`.

Las sesiones y el token del bookmarklet viven en la DB: tras restaurar, vuelven al estado del backup (sesiones iniciadas después de esa fecha dejan de valer; se vuelve a entrar).

## Retención y borrado

| Dato | Cuánto se conserva | Cómo se borra |
|---|---|---|
| Enlaces en la papelera | 30 días | Mantenimiento horario; antes, "Eliminar definitivamente" o "Vaciar papelera" (con confirmación). |
| Sesiones | 30 días absolutos, 14 de inactividad | Las expiradas se purgan en el mantenimiento; "Cerrar todas las sesiones" y cambiar contraseña las revocan. |
| Contadores de rate limit | Ventanas cortas | El mantenimiento borra los viejos. |
| Eventos de auditoría (login ok/fallido, sesiones revocadas, token rotado, contraseña cambiada) | 365 días | Mantenimiento. La tabla es inmutable: no admite UPDATE. |
| Favicons | Mientras haya enlaces de ese dominio | Se purgan cuando no queda ningún enlace del dominio, y en cascada al borrar un usuario. |

El mantenimiento corre cada hora dentro del proceso (si `JOBS_INLINE_WORKER=1`). **(pendiente de verificar)**: en la rama donde se escribió esto `runMaintenance` es un esqueleto; lo implementa el stream de integraciones. No se borran copias de seguridad automáticamente.

## Salud: `/healthz`

`GET /healthz` es público, no devuelve datos de usuarios y lleva `Cache-Control: no-store`. Úsalo para el healthcheck del proxy u orquestador.

Ejemplo de respuesta sana (HTTP 200):

```json
{ "status": "ok", "db": "ok", "migrations": "up_to_date",
  "queue": { "due": 0, "failed": 0, "oldest_due_age_ms": 0 } }
```

| Campo | Significado |
|---|---|
| `status` | `ok`; `degraded` (HTTP 503) si hay migraciones pendientes; `error` (503) si la DB no responde. |
| `db` | `ok` o `unreachable`. |
| `migrations` | `up_to_date` o `{ "pending": [...] }` con los archivos sin aplicar: ejecuta `npm run db:migrate`. |
| `queue.due` | Enlaces pendientes o reintentando cuyo próximo intento ya venció. Debería bajar a 0 enseguida. |
| `queue.failed` | Enlaces con la obtención de datos fallida (terminal hasta "Reintentar"). Un número alto y creciente apunta a problemas de red saliente. |
| `queue.oldest_due_age_ms` | Antigüedad en ms del intento más atrasado. Si crece sin parar, el worker no está procesando. |

## Logs

- Salen por **stdout**, una línea JSON por evento: `{"ts":"…","level":"info","msg":"…", …}`. Nivel con `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).
- Cada petición lleva un `request_id`, que también se devuelve en la cabecera `X-Request-Id` y se muestra como código de referencia en las páginas de error: pídelo al usuario para localizar el evento. Si el cliente envía `X-Request-Id` válido (8–64 caracteres alfanuméricos o guiones) se reutiliza. Los eventos del worker llevan `job_id`.
- **Nunca se registra**: contraseñas, tokens, cookies, cabecera Authorization, secretos CSRF ni query strings. Las claves con nombres como `password`, `token`, `secret`, `cookie`, `authorization` o `csrf` se sustituyen por `[redactado]`, y las URLs pierden su query y fragmento (para los enlaces guardados solo se registra el dominio).
- Ejemplos de `msg`: `server.listening`, `server.shutdown`, `healthz.failed`, `worker.tick_failed`, `maintenance.failed`.

Para ver errores: `npm start | jq 'select(.level=="error")'` (o el equivalente en tu gestor de logs).

## Migraciones y rollback

- `npm run db:migrate` aplica lo pendiente, con copia previa `VACUUM INTO` en `<carpeta de la DB>/backups/pre-migrate-<fecha>.db`.
- Son **solo hacia adelante**. Para revertir un despliegue que migró: detén la app, restaura `pre-migrate-*.db` como indica la sección de restauración y arranca la versión anterior del código. Se pierde lo escrito después de la migración.
- Despliega siempre en este orden: parar → actualizar código → `npm run build` → `npm run db:migrate` → arrancar.

## Rotar `APP_SECRET`

1. Genera uno nuevo: `openssl rand -hex 32` (mínimo 32 caracteres).
2. Cámbialo en el entorno y reinicia.

**Consecuencia**: el secreto del token del bookmarklet se deriva de `APP_SECRET` y no se guarda, así que **todos los bookmarklets instalados dejan de funcionar** ("Este bookmarklet ya no es válido"). Cada persona debe volver a `/bookmarklet`, rotar el token e instalar el nuevo. Las sesiones del navegador no dependen de `APP_SECRET` (en la DB solo hay el hash del token de sesión) **(pendiente de verificar al integrar el stream de seguridad)**; si se invalidaran, bastaría con volver a entrar.

## Recuperación de fallos comunes

**La obtención de datos de un enlace falló** (insignia "No se pudo leer la página"): el enlace se guarda igual, con la URL como título si hace falta. En el enlace, pulsa **Reintentar**. Causas habituales: la página bloquea bots (403), es lenta o enorme, redirige a una dirección privada (bloqueada a propósito) o el servidor no tiene salida a internet. Revisa `queue.failed` en `/healthz` y los logs de `worker`. Un título editado a mano nunca se sobrescribe.

**Base de datos bloqueada** (`database is locked`): SQLite admite un solo escritor; hay `busy_timeout` de 5 s. Si persiste, comprueba que no hay **dos procesos** de Pincushion sobre el mismo archivo, ni una herramienta externa con una transacción larga abierta. Corta cualquier sesión de `sqlite3` abierta y reinicia la app.

**Disco lleno**: la app dejará de poder escribir (errores 500 y `maintenance.failed`/`worker.tick_failed` en logs). Libera espacio (borra `backups/pre-migrate-*` antiguos y copias viejas), reinicia y comprueba `/healthz`. Para recuperar espacio dentro de la DB tras vaciar la papelera, haz una copia con `VACUUM INTO` y restaura esa copia compacta.

**`/healthz` en 503 con migraciones pendientes**: ejecuta `npm run db:migrate`.

**La app no arranca con "Configuración inválida: …"**: revisa la variable que nombra el mensaje (por ejemplo `APP_SECRET debe tener al menos 32 caracteres`) contra la tabla del README.

**Olvidé la contraseña**: no hay recuperación por email. Si no hay otra vía, crea otro usuario con `npm run user:create` o restaura una sesión activa; (pendiente de verificar: si habrá un comando para restablecer contraseña, hoy no existe).
