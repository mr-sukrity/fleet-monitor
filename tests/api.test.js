import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TIMEOUT_MS, createTestApp } from './helpers.js';

const validHeartbeat = { timestamp: '2026-09-21T10:30:00Z', status: 'OK' };

async function register(app, id, name = `Device ${id}`) {
  return request(app).post('/devices').send({ id, name });
}

describe('POST /devices', () => {
  it('registers a device and returns 201 with its details', async () => {
    const { app } = createTestApp();

    const res = await register(app, 'device-01', 'Lab Device 01');

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/devices/device-01');
    expect(res.body).toMatchObject({
      id: 'device-01',
      name: 'Lab Device 01',
      status: 'OFFLINE',
      last_heartbeat: null,
      last_report: null,
    });
  });

  it('returns 409 when the id is already registered', async () => {
    const { app } = createTestApp();
    await register(app, 'device-01');

    const res = await register(app, 'device-01');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEVICE_ALREADY_EXISTS');
  });

  it.each([
    ['missing id', { name: 'x' }, 'id'],
    ['missing name', { id: 'device-01' }, 'name'],
    ['blank name', { id: 'device-01', name: '   ' }, 'name'],
    ['id with a slash', { id: 'a/b', name: 'x' }, 'id'],
    ['numeric id', { id: 42, name: 'x' }, 'id'],
  ])('returns 400 for %s', async (_case, body, field) => {
    const { app } = createTestApp();

    const res = await request(app).post('/devices').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it('returns 400 for malformed JSON', async () => {
    const { app } = createTestApp();

    const res = await request(app).post('/devices').set('content-type', 'application/json').send('{"id": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('returns 400 when there is no body at all', async () => {
    const { app } = createTestApp();

    const res = await request(app).post('/devices');

    expect(res.status).toBe(400);
  });
});

describe('POST /devices/:id/heartbeat', () => {
  it('accepts a heartbeat and marks the device ONLINE', async () => {
    const { app, clock } = createTestApp();
    await register(app, 'device-01');

    const res = await request(app)
      .post('/devices/device-01/heartbeat')
      .send({ ...validHeartbeat, cpu_usage: 42, signal_strength: -71 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ONLINE',
      last_heartbeat: clock.now().toISOString(),
      last_report: { timestamp: '2026-09-21T10:30:00.000Z', status: 'OK', cpu_usage: 42, signal_strength: -71 },
    });
  });

  it('returns 404 for an unregistered device', async () => {
    const { app } = createTestApp();

    const res = await request(app).post('/devices/ghost/heartbeat').send(validHeartbeat);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it.each([
    ['missing timestamp', { status: 'OK' }],
    ['non ISO timestamp', { timestamp: '21/09/2026 10:30', status: 'OK' }],
    ['missing status', { timestamp: validHeartbeat.timestamp }],
    ['cpu_usage above 100', { ...validHeartbeat, cpu_usage: 150 }],
    ['cpu_usage as a string', { ...validHeartbeat, cpu_usage: '42' }],
    ['positive signal_strength', { ...validHeartbeat, signal_strength: 10 }],
  ])('returns 400 for %s', async (_case, body) => {
    const { app } = createTestApp();
    await register(app, 'device-01');

    const res = await request(app).post('/devices/device-01/heartbeat').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not change device state when the heartbeat is invalid', async () => {
    const { app } = createTestApp();
    await register(app, 'device-01');

    await request(app).post('/devices/device-01/heartbeat').send({ status: 'OK' });
    const res = await request(app).get('/devices/device-01');

    expect(res.body.status).toBe('OFFLINE');
    expect(res.body.last_heartbeat).toBeNull();
  });
});

describe('GET /devices and GET /devices/:id', () => {
  it('lists every registered device with its status', async () => {
    const { app } = createTestApp();
    await register(app, 'device-01', 'Lab Device 01');
    await register(app, 'device-02', 'Lab Device 02');
    await request(app).post('/devices/device-01/heartbeat').send(validHeartbeat);

    const res = await request(app).get('/devices');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'device-01', name: 'Lab Device 01', status: 'ONLINE', last_heartbeat: '2026-09-21T10:30:00.000Z' },
      { id: 'device-02', name: 'Lab Device 02', status: 'OFFLINE', last_heartbeat: null },
    ]);
  });

  it('returns an empty list when nothing is registered', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/devices');
    expect(res.body).toEqual([]);
  });

  it('filters by status, case-insensitively', async () => {
    const { app } = createTestApp();
    await register(app, 'device-01');
    await register(app, 'device-02');
    await request(app).post('/devices/device-02/heartbeat').send(validHeartbeat);

    const res = await request(app).get('/devices?status=online');

    expect(res.body.map((d) => d.id)).toEqual(['device-02']);
  });

  it('returns 400 for an unknown status filter', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/devices?status=SLEEPING');
    expect(res.status).toBe(400);
  });

  it('returns a single device', async () => {
    const { app } = createTestApp();
    await register(app, 'device-01', 'Lab Device 01');

    const res = await request(app).get('/devices/device-01');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'device-01', name: 'Lab Device 01', status: 'OFFLINE' });
    expect(res.body.registered_at).toBe('2026-09-21T10:30:00.000Z');
  });

  it('returns 404 for an unknown device', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/devices/ghost');
    expect(res.status).toBe(404);
  });
});

describe('GET /summary', () => {
  it('counts online and offline devices', async () => {
    const { app } = createTestApp();
    for (const id of ['device-01', 'device-02', 'device-03']) {
      await register(app, id);
    }
    await request(app).post('/devices/device-01/heartbeat').send(validHeartbeat);
    await request(app).post('/devices/device-02/heartbeat').send(validHeartbeat);

    const res = await request(app).get('/summary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3, online: 2, offline: 1 });
  });
});

describe('30 second timeout through the API', () => {
  it('flips a silent device to OFFLINE while the others stay ONLINE', async () => {
    const { app, clock } = createTestApp();
    for (const id of ['device-01', 'device-02']) {
      await register(app, id);
      await request(app).post(`/devices/${id}/heartbeat`).send(validHeartbeat);
    }

    // device-02 keeps reporting every 5 seconds, device-01 goes quiet.
    for (let elapsed = 0; elapsed <= TIMEOUT_MS; elapsed += 5_000) {
      clock.advance(5_000);
      await request(app).post('/devices/device-02/heartbeat').send(validHeartbeat);
    }

    const device01 = await request(app).get('/devices/device-01');
    const summary = await request(app).get('/summary');

    expect(device01.body.status).toBe('OFFLINE');
    expect(summary.body).toEqual({ total: 2, online: 1, offline: 1 });
  });

  it('keeps a device ONLINE at exactly 30 seconds and drops it right after', async () => {
    const { app, clock } = createTestApp();
    await register(app, 'device-01');
    await request(app).post('/devices/device-01/heartbeat').send(validHeartbeat);

    clock.advance(TIMEOUT_MS);
    expect((await request(app).get('/devices/device-01')).body.status).toBe('ONLINE');

    clock.advance(1);
    expect((await request(app).get('/devices/device-01')).body.status).toBe('OFFLINE');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const { app } = createTestApp();
    const res = await request(app).delete('/devices');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('dashboard', () => {
  it('serves the static page at the root', async () => {
    const { app } = createTestApp();

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Fleet Monitor');
  });
});
