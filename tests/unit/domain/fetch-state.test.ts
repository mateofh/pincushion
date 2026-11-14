import { describe, expect, it } from 'vitest';
import {
  BACKOFF_JITTER,
  BACKOFF_MS,
  FETCH_STATUSES,
  FETCH_TRANSITIONS,
  LEASE_MS,
  MAX_ATTEMPTS,
  backoffDelay,
  canRetryManually,
  canTransition,
  fetchStatusLabel,
  isDue,
  isFetchStatus,
  isRetryableHttpStatus,
  jitterFrom,
  leaseExpiredState,
  leaseUntil,
  manualRetry,
  nextFetchState,
  type FetchOutcome,
  type FetchStatus,
} from '../../../src/domain/fetch-state.ts';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const transient: FetchOutcome = { kind: 'error', code: 'timeout', retryable: true };
const terminal: FetchOutcome = { kind: 'error', code: 'http_403', retryable: false };

describe('nextFetchState', () => {
  it('pending → succeeded', () => {
    expect(nextFetchState(0, { kind: 'succeeded' }, NOW)).toEqual({ status: 'succeeded', attempts: 1, nextAttemptAt: null, errorCode: null });
  });
  it('pending → skipped (no HTML)', () => {
    expect(nextFetchState(0, { kind: 'skipped' }, NOW)).toEqual({ status: 'skipped', attempts: 1, nextAttemptAt: null, errorCode: 'not_html' });
  });
  it('pending → failed inmediato con error no reintentable (sin backoff)', () => {
    expect(nextFetchState(0, terminal, NOW)).toEqual({ status: 'failed', attempts: 1, nextAttemptAt: null, errorCode: 'http_403' });
  });
  it('pending → retrying con la primera espera (30 s)', () => {
    expect(nextFetchState(0, transient, NOW)).toEqual({ status: 'retrying', attempts: 1, nextAttemptAt: NOW + 30_000, errorCode: 'timeout' });
  });
  it('retrying → retrying con esperas 30 s · 2 min · 10 min y luego failed', () => {
    const delays: number[] = [];
    let attempts = 0;
    let state = nextFetchState(attempts, transient, NOW);
    while (state.status === 'retrying') {
      delays.push(state.nextAttemptAt! - NOW);
      attempts = state.attempts;
      state = nextFetchState(attempts, transient, NOW);
    }
    expect(delays).toEqual([30_000, 120_000, 600_000]);
    expect(state).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, nextAttemptAt: null, errorCode: 'timeout' });
    expect(MAX_ATTEMPTS).toBe(BACKOFF_MS.length + 1);
  });
  it('retrying → succeeded / skipped / failed (no reintentable)', () => {
    expect(nextFetchState(2, { kind: 'succeeded' }, NOW).status).toBe('succeeded');
    expect(nextFetchState(2, { kind: 'skipped' }, NOW).status).toBe('skipped');
    expect(nextFetchState(1, terminal, NOW)).toMatchObject({ status: 'failed', attempts: 2 });
  });
  it('tope de intentos: aunque sea reintentable, a partir de MAX_ATTEMPTS es failed', () => {
    expect(nextFetchState(MAX_ATTEMPTS - 1, transient, NOW).status).toBe('failed');
    expect(nextFetchState(MAX_ATTEMPTS + 5, transient, NOW).status).toBe('failed');
  });
  it('attemptsBefore inválido cuenta como 0', () => {
    expect(nextFetchState(-3, transient, NOW).attempts).toBe(1);
    expect(nextFetchState(Number.NaN, transient, NOW).attempts).toBe(1);
  });

  describe('jitter acotado (±20 %)', () => {
    it.each([
      [-1, 0.8],
      [-0.5, 0.9],
      [0, 1],
      [0.5, 1.1],
      [1, 1.2],
    ])('jitter %d → factor %d', (jitter, factor) => {
      const s = nextFetchState(0, transient, NOW, jitter);
      expect(s.nextAttemptAt! - NOW).toBe(Math.round(30_000 * factor));
    });
    it('jitter fuera de rango se acota y no finito cuenta como 0', () => {
      expect(nextFetchState(0, transient, NOW, 50).nextAttemptAt! - NOW).toBe(36_000);
      expect(nextFetchState(0, transient, NOW, -50).nextAttemptAt! - NOW).toBe(24_000);
      expect(nextFetchState(0, transient, NOW, Number.NaN).nextAttemptAt! - NOW).toBe(30_000);
      expect(nextFetchState(0, transient, NOW, Number.POSITIVE_INFINITY).nextAttemptAt! - NOW).toBe(30_000);
    });
    it('con jitter aleatorio la espera siempre queda en [base·0.8, base·1.2]', () => {
      for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt++) {
        const base = BACKOFF_MS[attempt - 1]!;
        for (let i = 0; i < 200; i++) {
          const d = backoffDelay(attempt, jitterFrom(Math.random()));
          expect(d).toBeGreaterThanOrEqual(Math.round(base * (1 - BACKOFF_JITTER)));
          expect(d).toBeLessThanOrEqual(Math.round(base * (1 + BACKOFF_JITTER)));
        }
      }
    });
    it('jitterFrom mapea [0,1) a [−1,1)', () => {
      expect(jitterFrom(0)).toBe(-1);
      expect(jitterFrom(0.5)).toBe(0);
      expect(jitterFrom(0.999)).toBeCloseTo(0.998);
      expect(jitterFrom(Number.NaN)).toBe(0);
    });
    it('backoffDelay satura en la última espera', () => {
      expect(backoffDelay(0)).toBe(30_000);
      expect(backoffDelay(10)).toBe(600_000);
    });
  });
});

describe('lease', () => {
  it('lease vencido cuenta como intento reintentable', () => {
    expect(leaseExpiredState(0, NOW)).toEqual({ status: 'retrying', attempts: 1, nextAttemptAt: NOW + 30_000, errorCode: 'lease_expired' });
    expect(leaseExpiredState(MAX_ATTEMPTS - 1, NOW)).toMatchObject({ status: 'failed', errorCode: 'lease_expired' });
  });
  it('leaseUntil', () => {
    expect(leaseUntil(NOW)).toBe(NOW + LEASE_MS);
  });
  it('isDue', () => {
    expect(isDue('pending', NOW, NOW)).toBe(true);
    expect(isDue('pending', null, NOW)).toBe(true);
    expect(isDue('retrying', NOW + 1, NOW)).toBe(false);
    expect(isDue('retrying', NOW - 1, NOW)).toBe(true);
    expect(isDue('retrying', NOW - 1, NOW, NOW + 10)).toBe(false); // lease vigente
    expect(isDue('retrying', NOW - 1, NOW, NOW - 10)).toBe(true); // lease vencido
    for (const s of ['succeeded', 'failed', 'skipped'] as const) expect(isDue(s, NOW - 1, NOW)).toBe(false);
  });
});

describe('Reintentar del dueño', () => {
  it('vuelve a pending con contador a 0 y vencimiento inmediato', () => {
    expect(manualRetry(NOW)).toEqual({ status: 'pending', attempts: 0, nextAttemptAt: NOW, errorCode: null });
  });
  it('tras failed, el ciclo empieza de nuevo con todas sus esperas', () => {
    const r = manualRetry(NOW);
    expect(nextFetchState(r.attempts, transient, NOW).status).toBe('retrying');
  });
  it('canRetryManually', () => {
    expect(canRetryManually('pending')).toBe(false);
    for (const s of ['retrying', 'succeeded', 'failed', 'skipped'] as const) expect(canRetryManually(s)).toBe(true);
  });
});

describe('transiciones', () => {
  const outcomes: FetchOutcome[] = [{ kind: 'succeeded' }, { kind: 'skipped' }, transient, terminal];
  it('todo resultado desde pending/retrying produce una transición permitida', () => {
    for (const from of ['pending', 'retrying'] as const) {
      for (let before = 0; before < MAX_ATTEMPTS; before++) {
        for (const o of outcomes) {
          const to = nextFetchState(before, o, NOW).status;
          expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
        }
      }
    }
  });
  it('manualRetry es transición permitida desde todo estado salvo pending', () => {
    for (const from of FETCH_STATUSES) expect(canTransition(from, 'pending')).toBe(from !== 'pending');
  });
  it('estados terminales solo salen por Reintentar', () => {
    for (const from of ['succeeded', 'failed', 'skipped'] as const) {
      expect(FETCH_TRANSITIONS[from]).toEqual(['pending']);
    }
  });
  it('tabla completa', () => {
    const allowed: Array<[FetchStatus, FetchStatus]> = [];
    for (const a of FETCH_STATUSES) for (const b of FETCH_STATUSES) if (canTransition(a, b)) allowed.push([a, b]);
    expect(allowed).toEqual([
      ['pending', 'retrying'],
      ['pending', 'succeeded'],
      ['pending', 'failed'],
      ['pending', 'skipped'],
      ['retrying', 'pending'],
      ['retrying', 'retrying'],
      ['retrying', 'succeeded'],
      ['retrying', 'failed'],
      ['retrying', 'skipped'],
      ['succeeded', 'pending'],
      ['failed', 'pending'],
      ['skipped', 'pending'],
    ]);
  });
});

describe('utilidades', () => {
  it('isRetryableHttpStatus: 408, 429 y 5xx', () => {
    for (const s of [408, 429, 500, 502, 503, 504, 599]) expect(isRetryableHttpStatus(s)).toBe(true);
    for (const s of [200, 301, 400, 401, 403, 404, 410, 451, 600]) expect(isRetryableHttpStatus(s)).toBe(false);
  });
  it('isFetchStatus', () => {
    for (const s of FETCH_STATUSES) expect(isFetchStatus(s)).toBe(true);
    for (const s of ['', 'PENDING', 'done', null, 1]) expect(isFetchStatus(s)).toBe(false);
  });
  it('etiquetas visibles del contrato', () => {
    expect(FETCH_STATUSES.map(fetchStatusLabel)).toEqual(['Obteniendo datos…', 'Reintentando…', 'Datos obtenidos', 'No se pudo leer la página', 'Sin vista previa']);
  });
});
