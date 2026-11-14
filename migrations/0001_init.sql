-- Pincushion: esquema inicial.
-- Instantes: INTEGER, milisegundos UTC. Solo comillas simples en literales.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  password_hash TEXT    NOT NULL,
  timezone      TEXT    NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 64),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,               -- sha256(token) en hex; el token nunca se guarda
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret  TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,                  -- límite absoluto
  revoked_at   INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE bookmarklet_tokens (
  id           TEXT    PRIMARY KEY,               -- id público aleatorio; el secreto se deriva por HMAC
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  last_test_at INTEGER,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX bookmarklet_tokens_one_active ON bookmarklet_tokens(user_id) WHERE revoked_at IS NULL;

CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  name_key   TEXT    NOT NULL CHECK (length(name_key) BETWEEN 1 AND 80),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, name_key),
  UNIQUE (id, user_id)
);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key   TEXT    NOT NULL CHECK (length(name_key) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name_key),
  UNIQUE (id, user_id)
);

CREATE TABLE bookmarks (
  id               INTEGER PRIMARY KEY,           -- rowid estable para FTS external content
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url              TEXT    NOT NULL CHECK (length(url) BETWEEN 8 AND 2048 AND (url LIKE 'http://%' OR url LIKE 'https://%')),
  normalized_url   TEXT    NOT NULL CHECK (length(normalized_url) BETWEEN 1 AND 2048),
  domain           TEXT    NOT NULL CHECK (length(domain) BETWEEN 1 AND 253),
  title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  title_source     TEXT    NOT NULL DEFAULT 'fallback' CHECK (title_source IN ('page','user','fallback')),
  description      TEXT    NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  excerpt          TEXT    NOT NULL DEFAULT '' CHECK (length(excerpt) <= 8000),
  collection_id    INTEGER,
  is_favorite      INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
  fetch_status     TEXT    NOT NULL DEFAULT 'pending' CHECK (fetch_status IN ('pending','retrying','succeeded','failed','skipped')),
  fetch_error_code TEXT,
  fetch_attempts   INTEGER NOT NULL DEFAULT 0 CHECK (fetch_attempts >= 0),
  next_attempt_at  INTEGER,
  lease_until      INTEGER,
  fetched_at       INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  trashed_at       INTEGER,
  UNIQUE (user_id, normalized_url),
  UNIQUE (id, user_id),
  FOREIGN KEY (collection_id, user_id) REFERENCES collections(id, user_id)
);
CREATE INDEX bookmarks_library   ON bookmarks(user_id, trashed_at, created_at DESC, id DESC);
CREATE INDEX bookmarks_coll      ON bookmarks(user_id, collection_id, created_at DESC, id DESC);
CREATE INDEX bookmarks_fav       ON bookmarks(user_id, is_favorite, created_at DESC, id DESC);
CREATE INDEX bookmarks_domain    ON bookmarks(user_id, domain);
CREATE INDEX bookmarks_title     ON bookmarks(user_id, title COLLATE NOCASE);
CREATE INDEX bookmarks_queue     ON bookmarks(fetch_status, next_attempt_at);

CREATE TABLE bookmark_tags (
  bookmark_id INTEGER NOT NULL,
  tag_id      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  PRIMARY KEY (bookmark_id, tag_id),
  FOREIGN KEY (bookmark_id, user_id) REFERENCES bookmarks(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, user_id)      REFERENCES tags(id, user_id)      ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id, bookmark_id);

CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
  title, description, excerpt,
  content = 'bookmarks', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER bookmarks_fts_ai AFTER INSERT ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(rowid, title, description, excerpt) VALUES (new.id, new.title, new.description, new.excerpt);
END;
CREATE TRIGGER bookmarks_fts_ad AFTER DELETE ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, description, excerpt) VALUES ('delete', old.id, old.title, old.description, old.excerpt);
END;
CREATE TRIGGER bookmarks_fts_au AFTER UPDATE OF title, description, excerpt ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, description, excerpt) VALUES ('delete', old.id, old.title, old.description, old.excerpt);
  INSERT INTO bookmarks_fts(rowid, title, description, excerpt) VALUES (new.id, new.title, new.description, new.excerpt);
END;

CREATE TABLE favicons (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain          TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status IN ('succeeded','failed')),
  content_type    TEXT,
  bytes           BLOB    CHECK (bytes IS NULL OR length(bytes) <= 102400),
  fetched_at      INTEGER NOT NULL,
  last_error_code TEXT,
  PRIMARY KEY (user_id, domain)
) WITHOUT ROWID;

CREATE TABLE rate_limits (
  key          TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE audit_events (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('login.succeeded','login.failed','session.revoked','sessions.revoked_all','token.rotated','password.changed')),
  request_id TEXT,
  meta_json  TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_events_user ON audit_events(user_id, created_at);
CREATE TRIGGER audit_events_immutable BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events es append-only');
END;
