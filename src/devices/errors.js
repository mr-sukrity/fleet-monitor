export class DeviceNotFoundError extends Error {
  /** @param {string} deviceId */
  constructor(deviceId) {
    super(`Device "${deviceId}" is not registered`);
    this.name = 'DeviceNotFoundError';
    this.deviceId = deviceId;
  }
}

export class DeviceAlreadyExistsError extends Error {
  /** @param {string} deviceId */
  constructor(deviceId) {
    super(`Device "${deviceId}" is already registered`);
    this.name = 'DeviceAlreadyExistsError';
    this.deviceId = deviceId;
  }
}
