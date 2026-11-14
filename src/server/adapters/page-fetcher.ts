// Adaptador HTTP real de metadatos. ESQUELETO (Ola 0): lo implementa el stream de integraciones
// con guarda SSRF, IP fijada, redirecciones manuales, límites de tamaño y extracción con htmlparser2.
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import { PageFetchError, type PageFetcher } from './types.ts';

export function createHttpPageFetcher(_config: Config, _log: Logger): PageFetcher {
  return {
    async fetchMetadata() {
      throw new PageFetchError('network', 'PageFetcher HTTP aún no implementado', { retryable: false });
    },
    async fetchFavicon() {
      return null;
    },
  };
}
