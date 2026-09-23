/**
 * A device is ONLINE if its last heartbeat arrived no more than `timeoutMs` ago.
 * Exactly `timeoutMs` still counts as ONLINE; the requirement only calls a device
 * OFFLINE after *more than* the timeout has passed.
 *
 * @param {Date | null} lastSeenAt Server time of the last heartbeat, or null if none.
 * @param {Date} now
 * @param {number} timeoutMs
 * @returns {import('./types.js').DeviceStatus}
 */
export function computeStatus(lastSeenAt, now, timeoutMs) {
  if (lastSeenAt === null) {
    return 'OFFLINE';
  }
  const elapsedMs = now.getTime() - lastSeenAt.getTime();
  return elapsedMs <= timeoutMs ? 'ONLINE' : 'OFFLINE';
}
