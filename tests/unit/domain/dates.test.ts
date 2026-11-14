import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  TRASH_RETENTION_MS,
  daysUntilPurge,
  formatDateTime,
  formatSavedDate,
  formatShortDate,
  formatTime,
  isTrashExpired,
  isValidTimeZone,
  isoInstant,
  listTimeZones,
  trashPurgeAt,
} from '../../../src/domain/dates.ts';

// 3 nov 2026 23:30 UTC
const T = Date.UTC(2026, 10, 3, 23, 30, 0);

describe('formatSavedDate', () => {
  it('"3 nov 2026" en español', () => {
    expect(formatSavedDate(T, 'UTC')).toBe('3 nov 2026');
  });
  it.each([
    ['UTC', '3 nov 2026'],
    ['Europe/Madrid', '4 nov 2026'], // UTC+1 → 00:30 del día 4
    ['America/Bogota', '3 nov 2026'], // UTC−5
    ['Asia/Tokyo', '4 nov 2026'], // UTC+9
    ['Pacific/Kiritimati', '4 nov 2026'], // UTC+14
    ['Pacific/Pago_Pago', '3 nov 2026'], // UTC−11
  ])('zona %s → %s', (tz, expected) => {
    expect(formatSavedDate(T, tz)).toBe(expected);
  });
  it('todos los meses abreviados en español', () => {
    const months = Array.from({ length: 12 }, (_, m) => formatSavedDate(Date.UTC(2026, m, 15, 12), 'UTC').split(' ')[1]);
    expect(months).toEqual(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']);
  });
  it('cambio de año según la zona', () => {
    const newYearUtc = Date.UTC(2027, 0, 1, 2, 0);
    expect(formatSavedDate(newYearUtc, 'UTC')).toBe('1 ene 2027');
    expect(formatSavedDate(newYearUtc, 'America/Mexico_City')).toBe('31 dic 2026');
  });
  it('zona inválida → UTC, sin lanzar', () => {
    expect(formatSavedDate(T, 'Marte/Olympus')).toBe('3 nov 2026');
    expect(formatSavedDate(T, '')).toBe('3 nov 2026');
  });
  it('instante no finito lanza RangeError', () => {
    expect(() => formatSavedDate(Number.NaN, 'UTC')).toThrow(RangeError);
  });
});

describe('formatShortDate', () => {
  it('omite el año si es el mismo que hoy en esa zona', () => {
    const now = Date.UTC(2026, 10, 14, 12);
    expect(formatShortDate(T, 'UTC', now)).toBe('3 nov');
    expect(formatShortDate(Date.UTC(2025, 10, 3, 12), 'UTC', now)).toBe('3 nov 2025');
  });
  it('el año se evalúa en la zona del usuario', () => {
    const saved = Date.UTC(2026, 11, 31, 23, 30); // 31 dic UTC, 1 ene en Madrid
    const now = Date.UTC(2027, 0, 1, 10);
    expect(formatShortDate(saved, 'UTC', now)).toBe('31 dic 2026');
    expect(formatShortDate(saved, 'Europe/Madrid', now)).toBe('1 ene');
  });
});

describe('formatDateTime y formatTime', () => {
  it.each([
    ['UTC', '3 nov 2026, 23:30', '23:30'],
    ['Europe/Madrid', '4 nov 2026, 00:30', '00:30'],
    ['America/Bogota', '3 nov 2026, 18:30', '18:30'],
    ['Asia/Kolkata', '4 nov 2026, 05:00', '05:00'],
  ])('%s', (tz, dt, t) => {
    expect(formatDateTime(T, tz)).toBe(dt);
    expect(formatTime(T, tz)).toBe(t);
  });
  it('respeta el horario de verano', () => {
    const summer = Date.UTC(2026, 6, 1, 10, 42);
    expect(formatTime(summer, 'Europe/Madrid')).toBe('12:42');
    expect(formatTime(Date.UTC(2026, 0, 1, 10, 42), 'Europe/Madrid')).toBe('11:42');
  });
  it('isoInstant', () => {
    expect(isoInstant(T)).toBe('2026-11-03T23:30:00.000Z');
  });
});

describe('isValidTimeZone', () => {
  it.each(['UTC', 'Europe/Madrid', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'Etc/GMT+3', 'Asia/Kolkata'])('acepta %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });
  it.each(['', 'Marte/Olympus', '+01:00', '-0500', 'Europe/Madrid; DROP', '../../etc/passwd', 'x'.repeat(65), null, 3])('rechaza %j', (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
  it('listTimeZones devuelve zonas válidas', () => {
    const list = listTimeZones();
    expect(list.length).toBeGreaterThan(100);
    expect(list).toContain('Europe/Madrid');
    expect(list.every((z) => isValidTimeZone(z))).toBe(true);
  });
});

describe('papelera', () => {
  it('se purga 30 días después', () => {
    expect(TRASH_RETENTION_MS).toBe(30 * DAY_MS);
    expect(trashPurgeAt(T)).toBe(T + 30 * DAY_MS);
  });
  it('isTrashExpired', () => {
    expect(isTrashExpired(T, T + 30 * DAY_MS - 1)).toBe(false);
    expect(isTrashExpired(T, T + 30 * DAY_MS)).toBe(true);
    expect(isTrashExpired(T, T + 31 * DAY_MS)).toBe(true);
  });
  it('daysUntilPurge', () => {
    expect(daysUntilPurge(T, T)).toBe(30);
    expect(daysUntilPurge(T, T + 1)).toBe(30);
    expect(daysUntilPurge(T, T + 29 * DAY_MS + 1)).toBe(1);
    expect(daysUntilPurge(T, T + 30 * DAY_MS)).toBe(0);
    expect(daysUntilPurge(T, T + 40 * DAY_MS)).toBe(0);
  });
});
