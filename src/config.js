const DEFAULT_PORT = 3000;
const DEFAULT_OFFLINE_TIMEOUT_SECONDS = 30;

function readPositiveInt(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ port: number, offlineTimeoutMs: number }}
 */
export function loadConfig(env = process.env) {
  return {
    port: readPositiveInt(env, 'PORT', DEFAULT_PORT),
    offlineTimeoutMs: readPositiveInt(env, 'OFFLINE_TIMEOUT_SECONDS', DEFAULT_OFFLINE_TIMEOUT_SECONDS) * 1000,
  };
}
