// Shell del popup del bookmarklet: lee el fragmento (#v,t,u,ti,de), lo borra de la barra de direcciones y
export {};
// envía un POST same-origin (formulario oculto) a /bookmarklet/guardar. El token nunca viaja en la URL.
const status = document.getElementById('shell-estado');
const say = (text: string) => {
  if (status) status.textContent = text;
};

const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
const params = new URLSearchParams(hash);
const token = params.get('t');

// Borra el fragmento del historial y de la barra de direcciones cuanto antes.
try {
  history.replaceState(null, '', location.pathname);
} catch {
  /* ignorar */
}

if (!token) {
  say('No llegó ninguna página. Abre el bookmarklet desde la página que quieras guardar.');
  document.getElementById('shell-t')!.textContent = 'Nada que guardar';
  document.querySelector('.spinner')?.setAttribute('hidden', '');
} else {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/bookmarklet/guardar';
  form.hidden = true;
  for (const key of ['v', 't', 'u', 'ti', 'de']) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = params.get(key) ?? '';
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
