// Subclaves HKDF propias del stream de seguridad (separación de dominio por propósito).
// `crypto.ts` cubre bookmarklet/csrf/flash; aquí van las que no comparten código con otras partes.
import { hkdfSync } from 'node:crypto';

export type SecurityPurpose = 'draft' | 'audit';

const cache = new Map<string, Buffer>();

export function securityKey(secret: string, purpose: SecurityPurpose): Buffer {
  const k = `${purpose}\u0000${secret}`;
  let key = cache.get(k);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, 'pincushion', `security:${purpose}`, 32));
    cache.set(k, key);
  }
  return key;
}
