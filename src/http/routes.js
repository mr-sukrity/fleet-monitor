import { Router } from 'express';
import { toDeviceDetailJson, toDeviceSummaryJson } from './presenters.js';
import { deviceIdSchema, heartbeatSchema, listDevicesQuerySchema, registerDeviceSchema } from './schemas.js';

/** @param {import('../devices/fleet-service.js').FleetService} fleet */
export function createRoutes(fleet) {
  const router = Router();

  router.post('/devices', (req, res) => {
    const input = registerDeviceSchema.parse(req.body ?? {});
    const device = fleet.register(input);
    res.status(201).location(`/devices/${encodeURIComponent(device.id)}`).json(toDeviceDetailJson(device));
  });

  router.get('/devices', (req, res) => {
    const { status } = listDevicesQuerySchema.parse(req.query);
    res.json(fleet.listDevices({ status }).map(toDeviceSummaryJson));
  });

  router.get('/devices/:id', (req, res) => {
    const id = deviceIdSchema.parse(req.params.id);
    res.json(toDeviceDetailJson(fleet.getDevice(id)));
  });

  router.post('/devices/:id/heartbeat', (req, res) => {
    const id = deviceIdSchema.parse(req.params.id);
    const heartbeat = heartbeatSchema.parse(req.body ?? {});
    const device = fleet.recordHeartbeat(id, {
      timestamp: heartbeat.timestamp,
      status: heartbeat.status,
      cpuUsage: heartbeat.cpu_usage,
      signalStrength: heartbeat.signal_strength,
    });
    res.json(toDeviceDetailJson(device));
  });

  router.get('/summary', (_req, res) => {
    res.json(fleet.getSummary());
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
}
