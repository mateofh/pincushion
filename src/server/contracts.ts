// Contratos entre streams. Los servicios de src/server/services/ deben exportar estas firmas
// (los nombres de archivo se indican en cada bloque). La UI solo consume lo que está aquí.
// Cambiar un contrato es tarea de la sesión principal.

export type FetchStatus = 'pending' | 'retrying' | 'succeeded' | 'failed' | 'skipped';
export type SortKey = 'recientes' | 'antiguos' | 'titulo' | 'dominio';
export type ViewMode = 'tarjetas' | 'lista';

export interface TagRef {
  id: number;
  name: string;
}

export interface CollectionRef {
  id: number;
  name: string;
}

export interface Bookmark {
  id: number;
  url: string;
  domain: string;
  title: string;
  titleSource: 'page' | 'user' | 'fallback';
  description: string;
  excerpt: string;
  collection: CollectionRef | null;
  tags: TagRef[];
  isFavorite: boolean;
  fetchStatus: FetchStatus;
  /** Código normalizado del último fallo (PageFetchError.code) o null. */
  fetchErrorCode: string | null;
  /** true si el usuario tiene favicon guardado para el dominio (servido en /favicons/:dominio). */
  hasFavicon: boolean;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  /**
   * Portada del enlace (Ola 4). Opcional mientras el stream de portadas la rellena en los servicios.
   * status: pending (aún no se intentó), succeeded (hay imagen en `url`), none (no hay imagen: usar portada generada), failed.
   */
  cover?: BookmarkCover;
}

export interface BookmarkCover {
  status: 'pending' | 'succeeded' | 'none' | 'failed';
  /** `/portadas/:id?v=<fetched_at>` si status = succeeded; null en otro caso. */
  url: string | null;
  width: number | null;
  height: number | null;
  source: 'og_image' | 'screenshot' | null;
}

// ---------- adapters/screenshotter.ts (stream de capturas) ----------

export interface ScreenshotResult {
  contentType: 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface Screenshotter {
  /**
   * Captura la página con Chromium y JavaScript DESACTIVADO; toda la red pasa por el fetcher guardado (SSRF).
   * Devuelve null si la página sale vacía o no se pudo capturar (la UI usa la portada generada). Nunca lanza.
   */
  capture(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ScreenshotResult | null>;
  close(): Promise<void>;
}

// ---------- services/bookmarks.ts ----------

export interface SaveInput {
  url: string;
  title?: string;
  description?: string;
  excerpt?: string;
  tags?: string[];
  /** id de colección existente del usuario, o null para "Sin colección". undefined = no tocar. */
  collectionId?: number | null;
  /** Nombre de colección nueva a crear (si se da, gana sobre collectionId). */
  newCollectionName?: string;
  isFavorite?: boolean;
}

export type SaveSource = 'web' | 'bookmarklet';

export interface SaveOutcome {
  bookmark: Bookmark;
  /** true si se creó; false si ya existía y se fusionó. */
  created: boolean;
  /** true si estaba en la papelera y se restauró (solo con origen 'web'). */
  restored: boolean;
}

export interface DuplicateInfo {
  id: number;
  title: string;
  createdAt: number;
  trashed: boolean;
  tags: TagRef[];
  collection: CollectionRef | null;
}

export interface LibraryQuery {
  collection?: number | 'sin-coleccion';
  tags?: string[]; // name_key
  favorites?: boolean;
  sort?: SortKey;
  /** Cursor opaco devuelto por la página anterior. */
  cursor?: string;
  limit?: number; // por defecto 50, máx. 100
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export type BulkAction =
  | { kind: 'add-tag'; tag: string }
  | { kind: 'remove-tag'; tagId: number }
  | { kind: 'move'; collectionId: number | null }
  | { kind: 'move-new'; collectionName: string }
  | { kind: 'favorite'; value: boolean }
  | { kind: 'trash' };

export interface BookmarkService {
  /** Normaliza, detecta duplicado y crea o fusiona (etiquetas = unión). Lanza InvalidUrlError / ValidationError. */
  save(userId: number, input: SaveInput, source: SaveSource): SaveOutcome;
  findDuplicate(userId: number, url: string): DuplicateInfo | null;
  get(userId: number, id: number): Bookmark | null; // null = no existe o es de otro usuario → 404
  update(userId: number, id: number, patch: Omit<SaveInput, 'url'>): Bookmark | null;
  setFavorite(userId: number, id: number, value: boolean): Bookmark | null;
  trash(userId: number, ids: number[]): number; // devuelve cuántos cambiaron
  restore(userId: number, ids: number[]): number;
  purge(userId: number, ids: number[]): number; // solo de la papelera
  emptyTrash(userId: number): number;
  list(userId: number, q: LibraryQuery): Page<Bookmark>;
  listTrash(userId: number, cursor?: string): Page<Bookmark>;
  bulk(userId: number, ids: number[], action: BulkAction): number;
  /** Marca para reintentar el fetch de metadatos (vuelve a 'pending'). */
  requestRefetch(userId: number, id: number): Bookmark | null;
}

// ---------- services/search.ts ----------

export interface SearchQuery {
  q: string;
  tags?: string[];
  collection?: number | 'sin-coleccion';
  favorites?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SearchHit {
  bookmark: Bookmark;
  /** HTML seguro con <mark> (de highlightToHtml). */
  titleHtml: string;
  excerptHtml: string;
  descriptionHtml: string;
}

export interface SearchService {
  /** Vacío o solo signos → { items: [], total: 0 }. Lanza ValidationError si q > 200 caracteres. */
  search(userId: number, q: SearchQuery): Page<SearchHit>;
}

// ---------- services/collections.ts y services/tags.ts ----------

export interface CollectionSummary extends CollectionRef {
  count: number;
}
export interface TagSummary extends TagRef {
  key: string;
  count: number;
}

export interface CollectionService {
  list(userId: number): CollectionSummary[];
  create(userId: number, name: string): CollectionRef; // idempotente por nombre normalizado
  rename(userId: number, id: number, name: string): CollectionRef | null;
  /** Mueve sus enlaces a "Sin colección" y la borra. Devuelve cuántos enlaces se movieron, o null si no existe. */
  remove(userId: number, id: number): number | null;
  counts(userId: number): { all: number; favorites: number; unsorted: number; trash: number };
}

export interface TagService {
  list(userId: number): TagSummary[];
  rename(userId: number, id: number, name: string): TagRef | null; // error si el nombre ya existe
  remove(userId: number, id: number): boolean;
}

// ---------- auth/bookmarklet.ts (stream de seguridad) ----------

export interface BookmarkletTokenInfo {
  id: string;
  createdAt: number;
  lastUsedAt: number | null;
  lastTestAt: number | null;
}

export interface BookmarkletService {
  /** Devuelve el token activo (creándolo si no hay) y su secreto derivado para incrustar en el bookmarklet. */
  ensureToken(userId: number): { info: BookmarkletTokenInfo; token: string };
  rotate(userId: number): { info: BookmarkletTokenInfo; token: string };
  /** Verifica en tiempo constante. null si es inválido o está revocado. */
  verify(token: string): { userId: number; tokenId: string } | null;
  markUsed(tokenId: string, test: boolean): void;
  /** Código JavaScript del bookmarklet (href completo `javascript:…`). */
  bookmarkletHref(token: string): string;
}

// ---------- errores compartidos (src/domain/errors.ts) ----------
// ValidationError { field: string; message: string } — mensajes en español listos para mostrar.
// InvalidUrlError (src/domain/url.ts).
