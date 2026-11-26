import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  endOfMonth,
  isValidIsoDate,
  startOfMonth,
  startOfYear,
} from '../../shared/dates.js';

describe('dates', () => {
  it.each(['2026-01-01', '2024-02-29', '2026-12-31'])('accepts %s', (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '2026/01/01', '', null, 20260101])(
    'rejects %j',
    (d) => {
      expect(isValidIsoDate(d)).toBe(false);
    },
  );

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('adds months and clamps the day', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('month and year boundaries', () => {
    expect(startOfMonth('2026-11-11')).toBe('2026-11-01');
    expect(endOfMonth('2026-02-11')).toBe('2026-02-28');
    expect(startOfYear('2026-11-11')).toBe('2026-01-01');
  });
});
