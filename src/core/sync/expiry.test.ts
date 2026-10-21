import { describe, expect, it } from 'vitest';
import { expiryMessage, expiryState, parseTokenExpiry } from './expiry';

const DAY = 86_400_000;

describe('token expiry (R4)', () => {
  it('parses GitHub\'s header formats', () => {
    expect(parseTokenExpiry('2026-11-04 10:00:00 UTC')).toBe(Date.UTC(2026, 10, 4, 10));
    expect(parseTokenExpiry('2026-11-04 10:00:00 -0700')).toBe(Date.UTC(2026, 10, 4, 17));
    expect(parseTokenExpiry('2026-11-04 10:00:00 +05:30')).toBe(Date.UTC(2026, 10, 4, 4, 30));
    expect(parseTokenExpiry('2026-11-04T10:00Z')).toBe(Date.UTC(2026, 10, 4, 10));
    expect(parseTokenExpiry(null)).toBeNull();
    expect(parseTokenExpiry('never')).toBeNull();
  });

  it('warns 14 days ahead', () => {
    const now = Date.UTC(2026, 9, 21);
    expect(expiryState(now + 30 * DAY, now)).toMatchObject({ warn: false, expired: false, daysLeft: 30 });
    expect(expiryState(now + 14 * DAY, now)).toMatchObject({ warn: true, expired: false, daysLeft: 14 });
    expect(expiryState(now + 3 * DAY + 5, now)).toMatchObject({ warn: true, daysLeft: 3 });
    expect(expiryState(now - DAY, now)).toMatchObject({ warn: true, expired: true });
    expect(expiryState(undefined, now)).toBeNull();
    expect(expiryMessage(now + 5 * DAY + 1000, now)).toMatch(/expires in 5 days/);
    expect(expiryMessage(now - 1000, now)).toMatch(/expired/);
  });
});
