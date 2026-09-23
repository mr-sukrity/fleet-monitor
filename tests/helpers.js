import { InMemoryDeviceRepository } from '../src/devices/device-repository.js';
import { FleetService } from '../src/devices/fleet-service.js';
import { createApp } from '../src/http/app.js';

export const TIMEOUT_MS = 30_000;

/** A clock the tests can move forward by hand, so no test ever has to sleep. */
export class FakeClock {
  #current;

  constructor(start = '2026-09-21T10:30:00.000Z') {
    this.#current = new Date(start).getTime();
  }

  now = () => new Date(this.#current);

  advance(ms) {
    this.#current += ms;
  }
}

export function createTestFleet(clock = new FakeClock()) {
  const fleet = new FleetService({
    repository: new InMemoryDeviceRepository(),
    offlineTimeoutMs: TIMEOUT_MS,
    clock: clock.now,
  });
  return { fleet, clock };
}

export function createTestApp(clock = new FakeClock()) {
  const { fleet } = createTestFleet(clock);
  return { app: createApp({ fleet }), fleet, clock };
}
