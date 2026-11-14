// Búsqueda en vivo (mejora progresiva sobre el formulario GET de /buscar).
// HTMX hace la petición (hx-get con delay:250ms); aquí solo marcamos aria-busy y anunciamos el resultado.
const RESULTS = 'search-results';

function announceText(message: string): void {
  const el = document.getElementById('announcer');
  if (!el || !message) return;
  el.textContent = '';
  window.setTimeout(() => (el.textContent = message), 50);
}

function isSearch(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && t.id === 'search-form';
}

document.body.addEventListener('htmx:beforeRequest', (e) => {
  if (!isSearch(e)) return;
  document.getElementById(RESULTS)?.setAttribute('aria-busy', 'true');
});

// htmx:afterRequest se emite sobre el formulario (htmx:afterSwap lo hace sobre el nodo ya reemplazado).
document.body.addEventListener('htmx:afterRequest', (e) => {
  if (!isSearch(e)) return;
  const ok = (e as CustomEvent<{ successful?: boolean }>).detail?.successful !== false;
  window.setTimeout(() => {
    const res = document.getElementById(RESULTS);
    res?.removeAttribute('aria-busy');
    if (ok) announceText(res?.dataset.announce ?? '');
  }, 30);
});
