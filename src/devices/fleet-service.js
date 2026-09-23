import { DeviceAlreadyExistsError, DeviceNotFoundError } from './errors.js';
import { computeStatus } from './status.js';

/**
 * @typedef {() => Date} Clock
 *
 * @typedef {object} FleetServiceOptions
 * @property {import('./device-repository.js').InMemoryDeviceRepository} repository
 * @property {number} offlineTimeoutMs
 * @property {Clock} [clock] Injected so tests can control time instead of sleeping.
 */
export class FleetService {
  /** @param {FleetServiceOptions} options */
  constructor(options) {
    this.repository = options.repository;
    this.offlineTimeoutMs = options.offlineTimeoutMs;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * @param {{ id: string, name: string }} input
   * @returns {import('./types.js').DeviceWithStatus}
   */
  register(input) {
    const device = {
      id: input.id,
      name: input.name,
      registeredAt: this.clock(),
      lastSeenAt: null,
      lastReport: null,
    };
    if (!this.repository.insert(device)) {
      throw new DeviceAlreadyExistsError(input.id);
    }
    return this.#withStatus(device, this.clock());
  }

  /**
   * @param {string} id
   * @param {import('./types.js').HeartbeatReport} report
   * @returns {import('./types.js').DeviceWithStatus}
   */
  recordHeartbeat(id, report) {
    const device = this.repository.findById(id);
    if (!device) {
      throw new DeviceNotFoundError(id);
    }

    const receivedAt = this.clock();
    device.lastSeenAt = receivedAt;

    // Heartbeats can arrive out of order (retries, network delays). Any heartbeat
    // proves the device is alive, but only a newer one should replace the metrics.
    const previous = device.lastReport;
    if (!previous || report.timestamp.getTime() >= previous.timestamp.getTime()) {
      device.lastReport = { ...report };
    }

    this.repository.save(device);
    return this.#withStatus(device, receivedAt);
  }

  /**
   * @param {string} id
   * @returns {import('./types.js').DeviceWithStatus}
   */
  getDevice(id) {
    const device = this.repository.findById(id);
    if (!device) {
      throw new DeviceNotFoundError(id);
    }
    return this.#withStatus(device, this.clock());
  }

  /**
   * @param {{ status?: import('./types.js').DeviceStatus }} [filter]
   * @returns {import('./types.js').DeviceWithStatus[]}
   */
  listDevices(filter = {}) {
    const now = this.clock();
    return this.repository
      .findAll()
      .map((device) => this.#withStatus(device, now))
      .filter((device) => !filter.status || device.status === filter.status)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** @returns {import('./types.js').FleetSummary} */
  getSummary() {
    const devices = this.listDevices();
    const online = devices.filter((device) => device.status === 'ONLINE').length;
    return {
      total: devices.length,
      online,
      offline: devices.length - online,
    };
  }

  #withStatus(device, now) {
    return {
      ...device,
      status: computeStatus(device.lastSeenAt, now, this.offlineTimeoutMs),
    };
  }
}
