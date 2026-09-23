/**
 * Storage boundary for devices.
 *
 * The app only ships this in-memory implementation, but every caller goes through
 * these four methods (insert / save / findById / findAll). A database-backed store
 * can replace this class without the service or HTTP layers changing.
 */
export class InMemoryDeviceRepository {
  /** @type {Map<string, import('./types.js').Device>} */
  #devices = new Map();

  /**
   * @param {import('./types.js').Device} device
   * @returns {boolean} false if a device with the same id already exists.
   */
  insert(device) {
    if (this.#devices.has(device.id)) {
      return false;
    }
    this.#devices.set(device.id, clone(device));
    return true;
  }

  /** @param {import('./types.js').Device} device */
  save(device) {
    this.#devices.set(device.id, clone(device));
  }

  /**
   * @param {string} id
   * @returns {import('./types.js').Device | undefined}
   */
  findById(id) {
    const device = this.#devices.get(id);
    return device ? clone(device) : undefined;
  }

  /** @returns {import('./types.js').Device[]} */
  findAll() {
    return [...this.#devices.values()].map(clone);
  }
}

// Callers get their own copy so they can't mutate stored state by accident.
function clone(device) {
  return {
    ...device,
    lastReport: device.lastReport ? { ...device.lastReport } : null,
  };
}
