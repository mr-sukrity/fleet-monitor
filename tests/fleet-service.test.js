import { describe, expect, it } from 'vitest';
import { DeviceAlreadyExistsError, DeviceNotFoundError } from '../src/devices/errors.js';
import { TIMEOUT_MS, createTestFleet } from './helpers.js';

const heartbeat = (timestamp, extra = {}) => ({
  timestamp: new Date(timestamp),
  status: 'OK',
  ...extra,
});

describe('FleetService', () => {
  describe('register', () => {
    it('stores a new device as OFFLINE until it sends a heartbeat', () => {
      const { fleet } = createTestFleet();

      const device = fleet.register({ id: 'device-01', name: 'Lab Device 01' });

      expect(device).toMatchObject({ id: 'device-01', name: 'Lab Device 01', status: 'OFFLINE', lastSeenAt: null });
      expect(fleet.getDevice('device-01').name).toBe('Lab Device 01');
    });

    it('rejects a duplicate id', () => {
      const { fleet } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'First' });

      expect(() => fleet.register({ id: 'device-01', name: 'Second' })).toThrow(DeviceAlreadyExistsError);
      expect(fleet.getDevice('device-01').name).toBe('First');
    });
  });

  describe('recordHeartbeat', () => {
    it('marks the device ONLINE and records the report', () => {
      const { fleet, clock } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'Lab Device 01' });

      const device = fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:00Z', { cpuUsage: 42 }));

      expect(device.status).toBe('ONLINE');
      expect(device.lastSeenAt).toEqual(clock.now());
      expect(device.lastReport).toMatchObject({ status: 'OK', cpuUsage: 42 });
    });

    it('throws for an unknown device', () => {
      const { fleet } = createTestFleet();
      expect(() => fleet.recordHeartbeat('ghost', heartbeat('2026-09-21T10:30:00Z'))).toThrow(DeviceNotFoundError);
    });

    it('keeps the newest report when heartbeats arrive out of order', () => {
      const { fleet, clock } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'Lab Device 01' });

      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:10Z', { cpuUsage: 80 }));
      clock.advance(1_000);
      const device = fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:05Z', { cpuUsage: 10 }));

      expect(device.lastReport.cpuUsage).toBe(80);
      // The late heartbeat still proves the device is alive.
      expect(device.lastSeenAt).toEqual(clock.now());
    });
  });

  describe('timeout behaviour', () => {
    it('goes OFFLINE once more than 30 seconds pass without a heartbeat', () => {
      const { fleet, clock } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'Lab Device 01' });
      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:00Z'));

      clock.advance(TIMEOUT_MS);
      expect(fleet.getDevice('device-01').status).toBe('ONLINE');

      clock.advance(1);
      expect(fleet.getDevice('device-01').status).toBe('OFFLINE');
    });

    it('comes back ONLINE when heartbeats resume', () => {
      const { fleet, clock } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'Lab Device 01' });
      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:00Z'));

      clock.advance(60_000);
      expect(fleet.getDevice('device-01').status).toBe('OFFLINE');

      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:31:00Z'));
      expect(fleet.getDevice('device-01').status).toBe('ONLINE');
    });

    it('evaluates each device against its own last heartbeat', () => {
      const { fleet, clock } = createTestFleet();
      fleet.register({ id: 'device-01', name: 'One' });
      fleet.register({ id: 'device-02', name: 'Two' });
      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:00Z'));

      clock.advance(20_000);
      fleet.recordHeartbeat('device-02', heartbeat('2026-09-21T10:30:20Z'));
      clock.advance(15_000);

      expect(fleet.getDevice('device-01').status).toBe('OFFLINE');
      expect(fleet.getDevice('device-02').status).toBe('ONLINE');
    });
  });

  describe('listDevices and getSummary', () => {
    function seededFleet() {
      const { fleet, clock } = createTestFleet();
      for (const id of ['device-03', 'device-01', 'device-02']) {
        fleet.register({ id, name: id });
      }
      fleet.recordHeartbeat('device-01', heartbeat('2026-09-21T10:30:00Z'));
      fleet.recordHeartbeat('device-02', heartbeat('2026-09-21T10:30:00Z'));
      return { fleet, clock };
    }

    it('lists devices sorted by id', () => {
      const { fleet } = seededFleet();
      expect(fleet.listDevices().map((d) => d.id)).toEqual(['device-01', 'device-02', 'device-03']);
    });

    it('filters by status', () => {
      const { fleet } = seededFleet();
      expect(fleet.listDevices({ status: 'OFFLINE' }).map((d) => d.id)).toEqual(['device-03']);
      expect(fleet.listDevices({ status: 'ONLINE' })).toHaveLength(2);
    });

    it('summarises the fleet and updates as devices time out', () => {
      const { fleet, clock } = seededFleet();
      expect(fleet.getSummary()).toEqual({ total: 3, online: 2, offline: 1 });

      clock.advance(TIMEOUT_MS + 1);
      expect(fleet.getSummary()).toEqual({ total: 3, online: 0, offline: 3 });
    });

    it('returns an empty summary for an empty fleet', () => {
      const { fleet } = createTestFleet();
      expect(fleet.getSummary()).toEqual({ total: 0, online: 0, offline: 0 });
    });
  });

  it('does not let callers mutate stored devices', () => {
    const { fleet } = createTestFleet();
    fleet.register({ id: 'device-01', name: 'Original' });

    fleet.getDevice('device-01').name = 'Tampered';

    expect(fleet.getDevice('device-01').name).toBe('Original');
  });
});
