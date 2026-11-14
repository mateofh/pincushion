-- Portadas de enlaces: imagen de vista previa (og:image) o captura real (Chromium sin JavaScript).
-- Si no hay ninguna, la interfaz genera una portada en CSS y no se guarda nada.

ALTER TABLE bookmarks ADD COLUMN cover_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (cover_status IN ('pending','succeeded','none','failed'));
ALTER TABLE bookmarks ADD COLUMN cover_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cover_attempts >= 0);

CREATE TABLE covers (
  bookmark_id  INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  source       TEXT    NOT NULL CHECK (source IN ('og_image','screenshot')),
  content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  bytes        BLOB    NOT NULL CHECK (length(bytes) BETWEEN 1 AND 614400),
  width        INTEGER NOT NULL CHECK (width BETWEEN 1 AND 20000),
  height       INTEGER NOT NULL CHECK (height BETWEEN 1 AND 20000),
  fetched_at   INTEGER NOT NULL,
  FOREIGN KEY (bookmark_id, user_id) REFERENCES bookmarks(id, user_id) ON DELETE CASCADE
);
CREATE INDEX covers_user ON covers(user_id);
CREATE INDEX bookmarks_cover_queue ON bookmarks(cover_status, fetch_status);
