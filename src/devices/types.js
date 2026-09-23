export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE'];

/**
 * @typedef {'ONLINE' | 'OFFLINE'} DeviceStatus
 *
 * @typedef {object} HeartbeatReport
 *   What the device told us in its most recent heartbeat.
 * @property {Date} timestamp        Time the device says it sent the heartbeat.
 * @property {string} status         The device's own health string, e.g. "OK".
 * @property {number} [cpuUsage]     Percent, 0-100.
 * @property {number} [signalStrength] dBm, -150 to 0.
 *
 * @typedef {object} Device
 * @property {string} id
 * @property {string} name
 * @property {Date} registeredAt
 * @property {Date | null} lastSeenAt  Server time the last heartbeat arrived. Drives ONLINE/OFFLINE.
 * @property {HeartbeatReport | null} lastReport
 *
 * @typedef {Device & { status: DeviceStatus }} DeviceWithStatus
 *
 * @typedef {object} FleetSummary
 * @property {number} total
 * @property {number} online
 * @property {number} offline
 */
