// "Cerrar ventana" del popup del bookmarklet (solo con JavaScript; sin él el botón no se muestra).
export {};
const button = document.querySelector<HTMLButtonElement>('[data-close]');
const status = document.querySelector<HTMLElement>('[data-close-status]');
if (button) {
  button.hidden = false;
  button.addEventListener('click', () => {
    window.close();
    // Si la pestaña no se abrió con window.open, el navegador no deja cerrarla.
    window.setTimeout(() => {
      if (status) status.textContent = 'No se pudo cerrar la ventana: ciérrala tú o vuelve a la página anterior.';
    }, 200);
  });
}
