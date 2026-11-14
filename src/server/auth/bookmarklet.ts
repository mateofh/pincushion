// Token del bookmarklet: id público aleatorio + HMAC(subkey(APP_SECRET,'bookmarklet'), userId|id).
// En la DB solo vive el id (y fechas/revocación); el secreto se recalcula. Solo sirve para guardar.
import type { App } from '../context.ts';
import type { BookmarkletService, BookmarkletTokenInfo } from '../contracts.ts';
import { hmac, randomToken, safeEqual, subkey } from '../crypto.ts';
import { audit } from '../security/audit.ts';

/** pc_<id 22 chars base64url>.<hmac 43 chars base64url> */
const TOKEN_RE = /^pc_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const TOKEN_MAX = 80;

interface TokenRow {
  id: string;
  user_id: number;
  created_at: number;
  last_used_at: number | null;
  last_test_at: number | null;
}

function toInfo(r: TokenRow): BookmarkletTokenInfo {
  return { id: r.id, createdAt: r.created_at, lastUsedAt: r.last_used_at, lastTestAt: r.last_test_at };
}

export interface BookmarkletServiceOptions {
  requestId?: string;
}

export function bookmarkletService(app: App, opts: BookmarkletServiceOptions = {}): BookmarkletService {
  const key = subkey(app.config.APP_SECRET, 'bookmarklet');
  const sign = (userId: number, id: string) => hmac(key, `${userId}|${id}`);
  const secretFor = (r: Pick<TokenRow, 'id' | 'user_id'>) => `pc_${r.id}.${sign(r.user_id, r.id)}`;

  const active = (userId: number) =>
    app.db.get<TokenRow>(
      'SELECT id, user_id, created_at, last_used_at, last_test_at FROM bookmarklet_tokens WHERE user_id = ? AND revoked_at IS NULL',
      userId,
    );

  const insert = (userId: number): TokenRow => {
    const row: TokenRow = { id: randomToken(16), user_id: userId, created_at: app.clock.now(), last_used_at: null, last_test_at: null };
    app.db.run('INSERT INTO bookmarklet_tokens (id, user_id, created_at) VALUES (?, ?, ?)', row.id, userId, row.created_at);
    return row;
  };

  return {
    ensureToken(userId) {
      const row = app.db.transaction(() => active(userId) ?? insert(userId));
      return { info: toInfo(row), token: secretFor(row) };
    },

    rotate(userId) {
      const row = app.db.transaction(() => {
        const old = active(userId);
        app.db.run('UPDATE bookmarklet_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', app.clock.now(), userId);
        const fresh = insert(userId);
        audit(app, 'token.rotated', { userId, requestId: opts.requestId, meta: { old_token_id: old?.id ?? null, new_token_id: fresh.id } });
        return fresh;
      });
      return { info: toInfo(row), token: secretFor(row) };
    },

    verify(token) {
      if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
      const m = TOKEN_RE.exec(token);
      if (!m) return null;
      const id = m[1]!;
      const row = app.db.get<{ user_id: number }>('SELECT user_id FROM bookmarklet_tokens WHERE id = ? AND revoked_at IS NULL', id);
      // Se calcula y compara siempre (también sin fila) para no dar pistas de tiempo sobre ids válidos.
      const expected = `pc_${id}.${sign(row?.user_id ?? 0, id)}`;
      const ok = safeEqual(token, expected);
      return ok && row ? { userId: row.user_id, tokenId: id } : null;
    },

    markUsed(tokenId, test) {
      const now = app.clock.now();
      if (test) {
        app.db.run('UPDATE bookmarklet_tokens SET last_used_at = ?, last_test_at = ? WHERE id = ? AND revoked_at IS NULL', now, now, tokenId);
      } else {
        app.db.run('UPDATE bookmarklet_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL', now, tokenId);
      }
    },

    bookmarkletHref(token) {
      return buildBookmarkletHref(app.config.APP_ORIGIN, token);
    },
  };
}

/**
 * Código del bookmarklet. Restricciones:
 * - Sin comillas dobles, sin `%` y sin saltos de línea: cabe en un href y se puede copiar a mano.
 * - No inyecta scripts, iframes ni formularios en la página (funciona con CSP estricta): solo lee
 *   título/meta y abre una ventana de Pincushion; si el navegador bloquea el popup, navega la pestaña.
 * - Datos en el fragmento (#) para que no viajen en la petición ni en el Referer.
 */
export function bookmarkletCode(origin: string, token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error('bookmarkletHref: token con formato inválido');
  const o = new URL(origin);
  if (o.protocol !== 'https:' && o.protocol !== 'http:') throw new Error('bookmarkletHref: APP_ORIGIN inválido');
  const base = `${o.origin}/bookmarklet/guardar#v=1&t=${token}`;
  return [
    '(function(){',
    'var d=document,w=window,L=location,de=0,og=0,ms=d.getElementsByTagName(\'meta\'),i,n,c;',
    'var E=function(s){try{return encodeURIComponent(s)}catch(x){return \'\'}};',
    // Recorta sin dejar un surrogate alto suelto (encodeURIComponent lanzaría).
    'var C=function(s,k){s=String(s||\'\').slice(0,k);c=s.charCodeAt(s.length-1);return c>55295&&c<56320?s.slice(0,-1):s};',
    'for(i=0;i<ms.length;i++){n=(ms[i].getAttribute(\'name\')||ms[i].getAttribute(\'property\')||\'\').toLowerCase();',
    'if(n==\'description\'&&!de)de=ms[i].getAttribute(\'content\');else if(n==\'og:description\'&&!og)og=ms[i].getAttribute(\'content\')}',
    `var u='${base}'+'&u='+E(C(L.href,2048))+'&ti='+E(C(d.title,300))+'&de='+E(C(de||og,1000));`,
    'var p=null;try{p=w.open(u,\'pincushion\',\'width=520,height=640\')}catch(x){}',
    'if(!p)L.href=u',
    '})()',
  ].join('');
}

/** href `javascript:` con el código escapado de forma mínima (decodificable con decodeURIComponent). */
export function buildBookmarkletHref(origin: string, token: string): string {
  const code = bookmarkletCode(origin, token);
  return 'javascript:' + code.replace(/[^A-Za-z0-9\-_.!~*'();:/?=&+,$@]/g, (ch) => encodeURIComponent(ch));
}
