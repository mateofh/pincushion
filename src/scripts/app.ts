// JS de cliente compartido (mejora progresiva). Todo funciona sin él.
import htmx from 'htmx.org';

declare global {
  interface Window {
    htmx: typeof htmx;
  }
}
window.htmx = htmx;

// Enviar el token CSRF en cada petición HTMX.
document.body.addEventListener('htmx:configRequest', (e) => {
  const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  const detail = (e as CustomEvent<{ headers: Record<string, string> }>).detail;
  if (token) detail.headers['X-CSRF-Token'] = token;
});

// Errores de servidor en peticiones HTMX: anunciar y dejar el formulario normal disponible.
document.body.addEventListener('htmx:responseError', (e) => fail(e, 'No se pudo completar la acción. Inténtalo de nuevo.'));
document.body.addEventListener('htmx:sendError', (e) => fail(e, 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.'));

// Estado pendiente: aria-busy en el elemento que se está actualizando (enlace, barra de lote o formulario).
const busyHost = (e: Event): HTMLElement | null => {
  const t = e.target as HTMLElement | null;
  return t?.closest<HTMLElement>('article, form') ?? null;
};
document.body.addEventListener('htmx:beforeRequest', (e) => busyHost(e)?.setAttribute('aria-busy', 'true'));
document.body.addEventListener('htmx:afterRequest', (e) => busyHost(e)?.removeAttribute('aria-busy'));

/** Fallo de una petición HTMX: aviso visible (en #flash) y anunciado; el formulario normal sigue disponible. */
function fail(e: Event, message: string): void {
  busyHost(e)?.removeAttribute('aria-busy');
  const region = document.getElementById('flash');
  if (region) {
    region.replaceChildren();
    const box = document.createElement('div');
    box.className = 'flash flash-error';
    box.tabIndex = -1;
    const p = document.createElement('p');
    p.textContent = message;
    box.append(p);
    region.append(box);
  }
  announce(message);
}

export function announce(message: string): void {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  window.setTimeout(() => (el.textContent = message), 50);
}

// Tras PRG, llevar el foco a la confirmación para lectores de pantalla y teclado.
const flash = document.querySelector<HTMLElement>('[data-flash]');
if (flash) flash.focus({ preventScroll: true });

// Atajo "/" para ir al buscador global (si no se está escribiendo en un campo).
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const q = document.getElementById('q-global') as HTMLInputElement | null;
  if (q) {
    e.preventDefault();
    q.focus();
    q.select();
  }
});
