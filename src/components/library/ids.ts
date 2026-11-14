// Ids de enlaces que llegan de un formulario: repetidos (`ids=1&ids=2`) o en una lista "1,2,3". Solo enteros válidos, sin duplicados.
import { parseId } from '../../domain/authz.ts';

export const MAX_BULK_IDS = 200;

export function parseIds(values: FormDataEntryValue[]): number[] {
  const out = new Set<number>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    for (const piece of v.split(',')) {
      const id = parseId(piece.trim());
      if (id !== null) out.add(id);
      if (out.size >= MAX_BULK_IDS) return [...out];
    }
  }
  return [...out];
}
