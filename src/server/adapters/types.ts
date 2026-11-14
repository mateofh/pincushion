// Contrato del adaptador de metadatos de páginas. Implementaciones: HTTP real (page-fetcher.ts) y fake (fake-fetcher.ts).

export type FetchErrorCode =
  | 'invalid_url'
  | 'blocked_address'
  | 'timeout'
  | 'too_large'
  | 'not_html'
  | 'http_error'
  | 'too_many_redirects'
  | 'network';

export class PageFetchError extends Error {
  readonly code: FetchErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  constructor(code: FetchErrorCode, message: string, opts: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'PageFetchError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

export interface PageMetadata {
  /** URL final tras redirecciones. */
  finalUrl: string;
  title: string | null;
  description: string | null;
  /** Texto plano, ya recortado a EXCERPT_MAX_CHARS. */
  excerpt: string;
  /** URL absoluta del favicon declarado, o /favicon.ico del origen. */
  faviconUrl: string | null;
}

export interface FaviconData {
  contentType: 'image/png' | 'image/x-icon' | 'image/gif' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array;
}

export interface PageFetcher {
  /** Lanza PageFetchError en cualquier fallo. Nunca ejecuta scripts remotos. */
  fetchMetadata(url: string, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PageMetadata>;
  /** Devuelve null si no hay favicon válido (tipo no permitido, demasiado grande, etc.). */
  fetchFavicon(url: string, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<FaviconData | null>;
}
