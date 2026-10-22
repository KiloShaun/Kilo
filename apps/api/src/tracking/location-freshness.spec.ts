import { classifyFreshness } from './location-freshness';

describe('classifyFreshness', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('is OFFLINE when there is no recorded point at all', () => {
    expect(classifyFreshness(null, now, 45, 300)).toBe('OFFLINE');
  });

  it('is LIVE within the live window', () => {
    const recordedAt = new Date(now.getTime() - 10_000);
    expect(classifyFreshness(recordedAt, now, 45, 300)).toBe('LIVE');
  });

  it('is STALE between the live and stale windows', () => {
    const recordedAt = new Date(now.getTime() - 120_000);
    expect(classifyFreshness(recordedAt, now, 45, 300)).toBe('STALE');
  });

  it('is OFFLINE past the stale window', () => {
    const recordedAt = new Date(now.getTime() - 600_000);
    expect(classifyFreshness(recordedAt, now, 45, 300)).toBe('OFFLINE');
  });

  it('treats the exact boundary as still within that window', () => {
    const recordedAt = new Date(now.getTime() - 45_000);
    expect(classifyFreshness(recordedAt, now, 45, 300)).toBe('LIVE');
  });
});
