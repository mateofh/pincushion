# Operación de Pincushion

Guía para quien administra una instancia. Todo el estado vive en **un archivo SQLite** (`DATABASE_PATH`, con modo WAL: junto a él aparecen `-wal` y `-shm`). Los favicons también están dentro de la DB, así que una copia de ese archivo es una copia completa.

Los comandos de esta guía se ejecutaron en un clon limpio. Recuerda que `npm run db:backup` y `npm run db:restore` solo leen `DATABASE_PATH` del entorno (no de `.env`): si usas una ruta distinta de `./data/pincushion.db`, expórtala antes.

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

### Con el script del proyecto

```bash
npm run db:backup                           # <carpeta de la DB>/backups/pincushion-<fecha>.db
npm run db:backup -- --out /ruta/copia.db   # destino propio (no debe existir)
npm run db:backup -- --keep 14              # copias pincushion-*.db que se conservan (7 por defecto; 0 = no borrar)
```

Hace la copia con `VACUUM INTO`, abre la copia para comprobar `integrity_check` y que tiene las mismas tablas, la descarta si algo falla e imprime los conteos (usuarios, enlaces…). La rotación solo borra copias `pincushion-*.db` del directorio destino: nunca `pre-migrate-*` ni `pre-restore-*`. No pide `APP_SECRET`. En Docker: `docker exec <contenedor> node --disable-warning=ExperimentalWarning scripts/backup.ts --keep 7`.

Recomendación: copia diaria a otro disco o servicio, conservando al menos 7 diarias. Guarda también `APP_SECRET` en un gestor de secretos: sin él los tokens del bookmarklet no se pueden verificar (ver más abajo).

### Copias automáticas al migrar

`npm run db:migrate` crea `backups/pre-migrate-<fecha>.db` junto a la DB antes de aplicar migraciones pendientes (solo si la DB ya existía). Esas copias no se borran solas.

## Restauración

### Con el script del proyecto

1. Detén la app (`SIGTERM`).
2. `npm run db:restore -- --from /ruta/copia.db`. El script valida la copia (`integrity_check` y tablas de Pincushion), guarda la base actual en `<carpeta de la DB>/backups/pre-restore-<fecha>.db`, borra el `-wal`/`-shm` viejos y reemplaza el archivo de forma atómica. Si el `-wal` se modificó hace menos de 10 s, se niega (la app parece activa); detén la app o usa `--force`.
3. Si imprime "Atención: la copia tiene migraciones pendientes", ejecuta `npm run db:migrate`.
4. Arranca la app y comprueba `GET /healthz`.

### A mano

Con la app parada: mueve aparte `pincushion.db`, `pincushion.db-wal` y `pincushion.db-shm`, copia el backup a `DATABASE_PATH` y no dejes ningún `-wal`/`-shm` antiguo (la copia no los necesita). Después `npm run db:migrate` si el backup es de un esquema anterior y comprueba `/healthz`.

Las sesiones y el token del bookmarklet viven en la DB: tras restaurar, vuelven al estado del backup (sesiones iniciadas después de esa fecha dejan de valer; se vuelve a entrar).

## Retención y borrado

| Dato | Cuánto se conserva | Cómo se borra |
|---|---|---|
| Enlaces en la papelera | 30 días | Mantenimiento horario; antes, "Eliminar definitivamente" o "Vaciar papelera" (con confirmación). |
| Sesiones | 30 días absolutos, 14 de inactividad | Las expiradas se purgan en el mantenimiento; "Cerrar todas las sesiones" y cambiar contraseña las revocan. |
| Contadores de rate limit | Ventanas cortas | El mantenimiento borra los viejos. |
| Eventos de auditoría (login ok/fallido, sesiones revocadas, token rotado, contraseña cambiada) | 365 días | Mantenimiento. La tabla es inmutable: no admite UPDATE. |
| Favicons | Mientras haya enlaces de ese dominio | Se purgan cuando no queda ningún enlace del dominio, y en cascada al borrar un usuario. |

El mantenimiento corre cada hora dentro del proceso (si `JOBS_INLINE_WORKER=1`); también puedes lanzarlo una vez con `npm run jobs:once`, que además procesa la cola de metadatos vencida (recuerda exportar el entorno: ese script no lee `.env`) e imprime un resumen (`trashedPurged`, `sessionsPurged`…). Ejecutado en un clon limpio, purgó el enlace de la papelera de más de 30 días que trae el seed. No se borran copias de seguridad automáticamente (salvo la rotación de `db:backup`).

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
- Despliega siempre en este orden: parar → actualizar código → `npm run build` → `npm run db:migrate` → arrancar. Con `NODE_ENV=production` la app no migra sola y se niega a arrancar con migraciones pendientes; sin esa variable las aplica al crearse, sin copia previa.

## Rotar `APP_SECRET`

1. Genera uno nuevo: `openssl rand -hex 32` (mínimo 32 caracteres).
2. Cámbialo en el entorno y reinicia.

**Consecuencia**: el secreto del token del bookmarklet se deriva de `APP_SECRET` y no se guarda, así que **todos los bookmarklets instalados dejan de funcionar** ("Este bookmarklet ya no es válido"). Cada persona debe volver a `/bookmarklet`, rotar el token e instalar el nuevo. Las sesiones del navegador no dependen de `APP_SECRET` (en la DB solo hay el hash SHA-256 del token de sesión), así que siguen valiendo; si se invalidaran, bastaría con volver a entrar.

## Recuperación de fallos comunes

**La obtención de datos de un enlace falló** (insignia "No se pudo leer la página"): el enlace se guarda igual, con la URL como título si hace falta. En el enlace, pulsa **Reintentar**. Causas habituales: la página bloquea bots (403), es lenta o enorme, redirige a una dirección privada (bloqueada a propósito) o el servidor no tiene salida a internet. Revisa `queue.failed` en `/healthz` y los logs de `worker`. Un título editado a mano nunca se sobrescribe.

**Base de datos bloqueada** (`database is locked`): SQLite admite un solo escritor; hay `busy_timeout` de 5 s. Si persiste, comprueba que no hay **dos procesos** de Pincushion sobre el mismo archivo, ni una herramienta externa con una transacción larga abierta. Corta cualquier sesión de `sqlite3` abierta y reinicia la app.

**Disco lleno**: la app dejará de poder escribir (errores 500 y `maintenance.failed`/`worker.tick_failed` en logs). Libera espacio (borra `backups/pre-migrate-*` antiguos y copias viejas), reinicia y comprueba `/healthz`. Para recuperar espacio dentro de la DB tras vaciar la papelera, haz una copia con `VACUUM INTO` y restaura esa copia compacta.

**`/healthz` en 503 con migraciones pendientes**: ejecuta `npm run db:migrate`.

**La app no arranca con "Configuración inválida: …"**: revisa la variable que nombra el mensaje (por ejemplo `APP_SECRET debe tener al menos 32 caracteres`) contra la tabla del README.

**Olvidé la contraseña**: no hay recuperación por email ni comando para restablecerla. Si tienes otra sesión abierta, cámbiala en Ajustes; si no, crea otro usuario con `npm run user:create` (sus enlaces serán otros).
