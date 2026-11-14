// Fetcher determinista para tests y desarrollo sin red.
import { PageFetchError, type FaviconData, type PageFetcher, type PageMetadata } from './types.ts';

export type FakeResponse = PageMetadata | PageFetchError | ((url: string) => PageMetadata | PageFetchError | Promise<PageMetadata | PageFetchError>);

export interface FakeFetcher extends PageFetcher {
  set(url: string, response: FakeResponse): void;
  setFavicon(url: string, favicon: FaviconData | null): void;
  calls: string[];
}

export function createFakeFetcher(initial: Record<string, FakeResponse> = {}): FakeFetcher {
  const pages = new Map<string, FakeResponse>(Object.entries(initial));
  const favicons = new Map<string, FaviconData | null>();
  const calls: string[] = [];
  return {
    calls,
    set: (url, r) => void pages.set(url, r),
    setFavicon: (url, f) => void favicons.set(url, f),
    async fetchMetadata(url) {
      calls.push(url);
      const r = pages.get(url);
      if (!r) throw new PageFetchError('http_error', 'Sin respuesta configurada en el fake', { status: 404 });
      const out = typeof r === 'function' ? await r(url) : r;
      if (out instanceof PageFetchError) throw out;
      return out;
    },
    async fetchFavicon(url) {
      return favicons.get(url) ?? null;
    },
  };
}
