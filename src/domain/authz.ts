// Predicados de autorización puros. Pincushion es de una persona por cuenta: un recurso solo lo ve su dueño.
// Recurso ajeno o inexistente se trata igual (404), para no revelar que existe.
import { NotFoundError } from './errors.ts';

function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** true solo si ambos ids son enteros positivos válidos y coinciden. */
export function ownsResource(viewerId: number | null | undefined, ownerId: number | null | undefined): boolean {
  return isId(viewerId) && isId(ownerId) && viewerId === ownerId;
}

/** Lanza `NotFoundError` (→ 404) si el visitante no es el dueño o no hay dueño. */
export function assertOwner(viewerId: number | null | undefined, ownerId: number | null | undefined): void {
  if (!ownsResource(viewerId, ownerId)) throw new NotFoundError();
}

/** Devuelve el recurso si pertenece al visitante; null si es ajeno o no existe. */
export function ownedOrNull<T extends { userId: number }>(viewerId: number | null | undefined, resource: T | null | undefined): T | null {
  return resource && ownsResource(viewerId, resource.userId) ? resource : null;
}

/** Valida un id que llega en la URL o un formulario ("12" → 12). null si no es un entero positivo canónico. */
export function parseId(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return isId(raw) ? raw : null;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return isId(n) ? n : null;
}
