// Artefactos de revisión (no bloquean): capturas de todas las pantallas a 360/768/1024/1440 px en test-results/visual/
// y adjuntas al reporte HTML. Solo guardan imágenes; no comparan.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, createOwner, login, seedBookmarks } from '../fixtures/test.ts';
import { sembrarDeterministas } from '../helpers/datos.ts';

const ANCHOS = [360, 768, 1024, 1440];
const DIR = join(process.cwd(), 'test-results', 'visual');

interface Pantalla {
  id: string;
  ruta: string;
  /** Con sesión (por defecto) o sin ella. */
  anonima?: boolean;
  preparar?: (page: import('@playwright/test').Page) => Promise<void>;
  /** Biblioteca vacía: dueño sin enlaces. */
  vacia?: boolean;
}

const PANTALLAS: Pantalla[] = [
  { id: 'biblioteca-tarjetas', ruta: '/?vista=tarjetas' },
  { id: 'biblioteca-lista', ruta: '/?vista=lista' },
  { id: 'biblioteca-vacia', ruta: '/', vacia: true },
  { id: 'biblioteca-sin-resultados', ruta: '/?etiqueta=no-existe' },
  { id: 'biblioteca-seleccion', ruta: '/', preparar: async (p) => { await p.getByRole('checkbox', { name: /^Seleccionar/ }).first().check().catch(() => {}); } },
  { id: 'guardar', ruta: '/guardar' },
  { id: 'guardar-error', ruta: '/guardar', preparar: async (p) => { await p.getByLabel('URL').fill('no es una url'); await p.getByRole('button', { name: 'Guardar', exact: true }).click(); } },
  { id: 'buscar-vacio', ruta: '/buscar' },
  { id: 'buscar-resultados', ruta: '/buscar?q=nube' },
  { id: 'buscar-sin-resultados', ruta: '/buscar?q=zzzinexistente' },
  { id: 'bookmarklet', ruta: '/bookmarklet' },
  { id: 'bookmarklet-prueba', ruta: '/bookmarklet/prueba' },
  { id: 'papelera', ruta: '/papelera' },
  { id: 'colecciones', ruta: '/colecciones' },
  { id: 'etiquetas', ruta: '/etiquetas' },
  { id: 'ajustes', ruta: '/ajustes' },
  { id: 'entrar', ruta: '/entrar', anonima: true },
  { id: 'popup-bookmarklet-sin-sesion', ruta: '/bookmarklet/guardar#t=token-invalido&u=https%3A%2F%2Fexample.com%2F&ti=Ejemplo', anonima: true },
  { id: 'error-404', ruta: '/esta-ruta-no-existe' },
  { id: 'error-429', ruta: '/429?espera=30' },
  { id: 'error-500', ruta: '/500' },
];

for (const ancho of ANCHOS) {
  test(`artefactos de revisión a ${ancho} px @nocturno`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: ancho, height: ancho < 800 ? 800 : 900 });
    const dir = join(DIR, String(ancho));
    mkdirSync(dir, { recursive: true });

    const conDatos = await createOwner('visual');
    sembrarDeterministas(conDatos, 12, (i) => ({
      isFavorite: i % 5 === 1,
      fetchStatus: i === 3 ? 'failed' : i === 4 ? 'retrying' : i === 5 ? 'pending' : 'succeeded',
    }));
    seedBookmarks(conDatos, [{ url: 'https://example.com/papelera', title: 'Enlace en la papelera', trashed: true }]);
    const vacio = await createOwner('visual-vacio');

    let sesion: 'datos' | 'vacio' | 'ninguna' = 'ninguna';
    const capturadas: string[] = [];
    for (const p of PANTALLAS) {
      const quiere = p.anonima ? 'ninguna' : p.vacia ? 'vacio' : 'datos';
      if (quiere !== sesion) {
        await page.context().clearCookies();
        if (quiere === 'datos') await login(page, conDatos);
        if (quiere === 'vacio') await login(page, vacio);
        sesion = quiere;
      }
      await page.goto(p.ruta);
      await p.preparar?.(page);
      await page.waitForLoadState('networkidle').catch(() => {});
      const archivo = join(dir, `${p.id}.png`);
      await page.screenshot({ path: archivo, fullPage: true });
      await testInfo.attach(`${ancho}/${p.id}`, { path: archivo, contentType: 'image/png' });
      capturadas.push(p.id);
    }
    expect(capturadas).toHaveLength(PANTALLAS.length);
  });
}
