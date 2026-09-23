import { describe, expect, it } from 'vitest';
import { computeStatus } from '../src/devices/status.js';

const TIMEOUT = 30_000;
const now = new Date('2026-09-21T10:30:30.000Z');
const secondsAgo = (s) => new Date(now.getTime() - s * 1000);

describe('computeStatus', () => {
  it('is OFFLINE when the device has never sent a heartbeat', () => {
    expect(computeStatus(null, now, TIMEOUT)).toBe('OFFLINE');
  });

  it('is ONLINE for a heartbeat received just now', () => {
    expect(computeStatus(now, now, TIMEOUT)).toBe('ONLINE');
  });

  it('is ONLINE for a heartbeat received 29 seconds ago', () => {
    expect(computeStatus(secondsAgo(29), now, TIMEOUT)).toBe('ONLINE');
  });

  it('is still ONLINE at exactly the 30 second boundary', () => {
    expect(computeStatus(secondsAgo(30), now, TIMEOUT)).toBe('ONLINE');
  });

  it('is OFFLINE one millisecond after the timeout', () => {
    const lastSeen = new Date(now.getTime() - TIMEOUT - 1);
    expect(computeStatus(lastSeen, now, TIMEOUT)).toBe('OFFLINE');
  });

  it('respects a custom timeout', () => {
    expect(computeStatus(secondsAgo(10), now, 5_000)).toBe('OFFLINE');
  });
});
