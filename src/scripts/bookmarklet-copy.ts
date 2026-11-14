// Copiar el código del bookmarklet. Sin JavaScript queda el textarea de solo lectura para seleccionarlo a mano.
export {};
const source = document.querySelector<HTMLTextAreaElement>('[data-copy-source]');
const button = document.querySelector<HTMLButtonElement>('[data-copy-button]');
const status = document.querySelector<HTMLElement>('[data-copy-status]');

if (source && button) {
  button.hidden = false;
  // Un clic en el área selecciona todo el código.
  source.addEventListener('focus', () => source.select());
  button.addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(source.value);
      ok = true;
    } catch {
      source.focus();
      source.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (status) {
      status.textContent = '';
      window.setTimeout(() => {
        status.textContent = ok ? 'Código copiado.' : 'No se pudo copiar: selecciónalo y cópialo a mano.';
      }, 50);
    }
    button.textContent = ok ? '✓ Copiado' : 'Copiar código';
    if (ok) window.setTimeout(() => (button.textContent = 'Copiar código'), 2500);
  });
}
