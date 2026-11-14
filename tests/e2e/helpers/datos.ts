// Datos deterministas para pruebas visuales y de rendimiento: mismos títulos, etiquetas y fechas en cada corrida.
import { e2eDb, seedBookmarks, type Owner, type SeedBookmark } from '../fixtures/test.ts';
import type { Bookmark } from '../../../src/server/contracts.ts';

/** 10 mar 2026, 10:00 UTC: referencia fija para las fechas de los enlaces sembrados. */
export const FECHA_BASE = Date.UTC(2026, 2, 10, 10, 0, 0);
export const HORA = 3_600_000;

const TEMAS = ['Receta de pan', 'Guía de viaje', 'Herramienta de notas', 'Artículo sobre diseño', 'Tutorial de SQL', 'Lectura de fin de semana'];
const ETIQUETAS = ['cocina', 'viajes', 'trabajo', 'lectura', 'diseño'];

/** Reescribe created_at/updated_at (el más reciente primero) para que el orden y las fechas mostradas no dependan del reloj. */
export function fijarFechas(owner: Owner, items: Bookmark[]): void {
  const db = e2eDb();
  items.forEach((b, i) => {
    const t = FECHA_BASE - i * HORA;
    db.run('UPDATE bookmarks SET created_at = ?, updated_at = ?, fetched_at = ? WHERE id = ? AND user_id = ?', t, t, t, b.id, owner.id);
  });
}

/** `n` enlaces con contenido determinista y fechas fijas. Quedan con fetch "succeeded" y favicon de respaldo. */
export function sembrarDeterministas(owner: Owner, n: number, extra: (i: number) => Partial<SeedBookmark> = () => ({})): Bookmark[] {
  const items: SeedBookmark[] = Array.from({ length: n }, (_, i) => ({
    url: `https://sitio-${String(i).padStart(4, '0')}.example.com/articulo/${i}`,
    title: `${TEMAS[i % TEMAS.length]} ${i + 1}`,
    description: `Descripción breve del enlace número ${i + 1}.`,
    excerpt: `Texto guardado del enlace ${i + 1} con una frase memorable llamada nube de algodón ${i + 1}.`,
    tags: [ETIQUETAS[i % ETIQUETAS.length]!, ETIQUETAS[(i + 2) % ETIQUETAS.length]!],
    ...extra(i),
  }));
  // Inserción por lotes con una sola transacción: 1000 enlaces tardarían minutos uno a uno.
  const db = e2eDb();
  const out: Bookmark[] = [];
  db.transaction(() => {
    out.push(...seedBookmarks(owner, items));
  });
  // El más reciente primero: id mayor = fecha mayor.
  fijarFechas(owner, [...out].reverse());
  return out;
}
