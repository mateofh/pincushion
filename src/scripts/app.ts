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
document.body.addEventListener('htmx:responseError', () => announce('No se pudo completar la acción. Inténtalo de nuevo.'));
document.body.addEventListener('htmx:sendError', () => announce('Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.'));

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
