import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ port: 3000, offlineTimeoutMs: 30_000 });
  });

  it('reads values from the environment', () => {
    expect(loadConfig({ PORT: '8080', OFFLINE_TIMEOUT_SECONDS: '10' })).toEqual({
      port: 8080,
      offlineTimeoutMs: 10_000,
    });
  });

  it.each(['abc', '0', '-5', '1.5'])('rejects an invalid timeout of "%s"', (value) => {
    expect(() => loadConfig({ OFFLINE_TIMEOUT_SECONDS: value })).toThrow(/OFFLINE_TIMEOUT_SECONDS/);
  });
});
