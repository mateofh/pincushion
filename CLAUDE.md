# Pincushion — reglas para Claude

App de una sola persona para guardar enlaces con etiquetas y colecciones y volver a encontrarlos.
Stack: Node.js 22.23+, Astro 7 SSR (`@astrojs/node` en modo middleware detrás de `server/entry.mjs`), SQLite vía `node:sqlite` con FTS5, HTMX para mejoras progresivas. Interfaz, URLs y documentación en **español**.

El plan completo vive en `docs/PLAN.md` y los contratos entre partes en `docs/CONTRATOS.md`. Si algo de aquí contradice a `CONTRATOS.md`, manda `CONTRATOS.md`.

## Modelos

| Trabajo | Modelo | Agente |
|---|---|---|
| Sesión principal, orquestación, integración y merges | Opus | (sesión principal) |
| Dominio, repos, servicios, adaptadores, cola de jobs, migraciones, seed | Opus | `backend` |
| Autenticación, sesiones, CSRF, rate limits, cabeceras/CSP, token del bookmarklet, guarda SSRF, revisiones de seguridad | Opus | `seguridad` |
| Páginas Astro, componentes, CSS, HTMX/JS de cliente, e2e de sus pantallas, accesibilidad | Sonnet | `ui` |
| README, `docs/`, guías, `.env.example`, trazabilidad, guion de pruebas UX | Sonnet | `docs` |

- Lanza siempre estos agentes por su nombre (`subagent_type`) para que usen el modelo de su definición; no pases `model` para saltártelo.
- Un cambio que toque seguridad (auth, CSRF, cookies, tokens, SSRF, escape de HTML, permisos) lo hace o lo revisa `seguridad`, aunque viva en una página.
- La sesión principal puede fijarse con `/model claude-opus-5-5`.

## Paralelización

- Trabajo en **olas**. Cada ola reparte streams independientes y termina con un merge hecho por la sesión principal y `npm test` en verde.
- **Un worktree y una rama por agente** (`.worktrees/<stream>`, rama `ola<N>/<stream>`), creados desde el último commit de `main`. Nunca dos agentes en el mismo árbol.
- **Propiedad de archivos disjunta**: cada agente solo edita las rutas de su stream (se listan en el prompt). Si necesita cambiar algo ajeno, lo reporta en su resumen final en vez de editarlo.
- Solo la sesión principal toca: `package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `playwright.config.ts`, `vitest.config.ts`, `migrations/`, `src/layouts/`, `src/middleware.ts` (salvo el agente `seguridad` cuando es su stream) y `docs/CONTRATOS.md`.
- Ningún agente instala dependencias, ejecuta `git stash`, `git checkout .`, `git reset`, formatea todo el repo ni hace push. Commits solo en su propia rama.
- Cada agente usa su propio puerto (`PORT`), su `DATABASE_PATH` en `./data/<stream>.db` y su carpeta de build, para no pisarse.
- Cada stream entrega su código **con sus pruebas** y las corre antes de terminar. El resumen final dice qué pasó, qué falló y qué quedó pendiente, sin maquillar.
- Máximo ~8 agentes simultáneos; preferir menos agentes con alcance claro a muchos con solapes.

## Reglas de código

- Reglas de negocio en `src/domain/` (puras) y `src/server/services/` (con DB); nunca en páginas ni componentes.
- Toda consulta y mutación recibe `userId` y filtra por él. Recurso ajeno o inexistente → 404.
- Toda mutación multi-registro va en `db.transaction(fn)` (síncrona).
- Formularios HTML normales con PRG (303); HTMX solo como mejora. Todo debe funcionar sin JavaScript salvo el propio bookmarklet.
- Sin estilos ni scripts inline, ni atributos `style=` (la CSP lo prohíbe). Sin `set:html` salvo el resaltado de búsqueda ya escapado.
- Instantes en ms UTC (`INTEGER`); la zona horaria del usuario solo para mostrar.
- SQL con comillas simples en literales. Migraciones solo hacia adelante, numeradas en `migrations/`.
- Imports relativos con extensión `.ts` (Node ejecuta TypeScript con type stripping): nada de `enum`, `namespace` ni parameter properties.
- Textos de la interfaz en español, con el glosario: enlace, colección, etiqueta, favorito, papelera.
- Logs con `app.log` (JSON); nunca registrar tokens, cookies, contraseñas ni URLs completas.

## Comandos

- `npm run dev` · `npm run build` · `npm start`
- `npm run db:migrate` · `npm run db:seed` · `npm run user:create`
- `npm test` = `astro check` + Vitest + build + Playwright (desktop, Pixel 7, sin JS)
- Playwright siempre con `--trace off` salvo para depurar un test concreto.
