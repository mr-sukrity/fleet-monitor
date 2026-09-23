/**
 * Simulates a fleet of devices sending heartbeats to the fleet monitor.
 *
 *   npm run simulate
 *   npm run simulate -- --devices 8 --interval 3
 *   npm run simulate -- --stop-after device-03=20
 *
 * While it runs, type `stop <id>`, `start <id>`, `status` or `quit`.
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

function parseOptions() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: process.env.FLEET_URL ?? 'http://localhost:3000' },
      devices: { type: 'string', default: '5' },
      interval: { type: 'string', default: '5' },
      'report-every': { type: 'string', default: '10' },
      'stop-after': { type: 'string', multiple: true, default: [] },
    },
  });

  const positive = (raw, flag) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--${flag} must be a positive number, got "${raw}"`);
    }
    return value;
  };

  const scheduledStops = new Map();
  for (const entry of values['stop-after']) {
    const [id, seconds] = entry.split('=');
    if (!id || !seconds) {
      throw new Error(`--stop-after expects <device-id>=<seconds>, got "${entry}"`);
    }
    scheduledStops.set(id, positive(seconds, 'stop-after') * 1000);
  }

  return {
    baseUrl: values.url.replace(/\/+$/, ''),
    deviceCount: Math.floor(positive(values.devices, 'devices')),
    intervalMs: positive(values.interval, 'interval') * 1000,
    reportEveryMs: positive(values['report-every'], 'report-every') * 1000,
    scheduledStops,
  };
}

function log(message) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${message}`);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

class FleetSimulator {
  /** @type {Map<string, { id: string, name: string, timer: NodeJS.Timeout | null }>} */
  #devices = new Map();

  constructor(options) {
    this.options = options;
    for (let i = 1; i <= options.deviceCount; i++) {
      const suffix = String(i).padStart(2, '0');
      const id = `device-${suffix}`;
      this.#devices.set(id, { id, name: `Lab Device ${suffix}`, timer: null });
    }
  }

  async registerAll() {
    for (const device of this.#devices.values()) {
      const res = await postJson(`${this.options.baseUrl}/devices`, { id: device.id, name: device.name });
      if (res.status === 201) {
        log(`registered ${device.id}`);
      } else if (res.status === 409) {
        log(`${device.id} was already registered, reusing it`);
      } else {
        throw new Error(`registering ${device.id} failed with ${res.status}: ${await res.text()}`);
      }
    }
  }

  start(id) {
    const device = this.#devices.get(id);
    if (!device) {
      log(`unknown device "${id}"`);
      return;
    }
    if (device.timer) {
      log(`${id} is already running`);
      return;
    }
    void this.#sendHeartbeat(device);
    device.timer = setInterval(() => void this.#sendHeartbeat(device), this.options.intervalMs);
    log(`${id} started, heartbeat every ${this.options.intervalMs / 1000}s`);
  }

  stop(id) {
    const device = this.#devices.get(id);
    if (!device) {
      log(`unknown device "${id}"`);
      return;
    }
    if (!device.timer) {
      log(`${id} is already stopped`);
      return;
    }
    clearInterval(device.timer);
    device.timer = null;
    log(`${id} stopped, it should turn OFFLINE after the server timeout`);
  }

  startAll() {
    for (const id of this.#devices.keys()) {
      this.start(id);
    }
  }

  stopAll() {
    for (const device of this.#devices.values()) {
      if (device.timer) clearInterval(device.timer);
      device.timer = null;
    }
  }

  async printStatus() {
    try {
      const [summaryRes, devicesRes] = await Promise.all([
        fetch(`${this.options.baseUrl}/summary`),
        fetch(`${this.options.baseUrl}/devices`),
      ]);
      const summary = await summaryRes.json();
      const devices = await devicesRes.json();
      const offline = devices.filter((d) => d.status === 'OFFLINE').map((d) => d.id);
      log(
        `fleet: total=${summary.total} online=${summary.online} offline=${summary.offline}` +
          (offline.length > 0 ? `  [offline: ${offline.join(', ')}]` : ''),
      );
    } catch (err) {
      log(`could not fetch fleet status: ${err.message}`);
    }
  }

  async #sendHeartbeat(device) {
    const payload = {
      timestamp: new Date().toISOString(),
      status: 'OK',
      cpu_usage: randomInt(5, 95),
      signal_strength: randomInt(-90, -40),
    };
    try {
      let res = await postJson(`${this.options.baseUrl}/devices/${device.id}/heartbeat`, payload);

      // The monitor stores devices in memory, so restarting it wipes every registration
      // while this simulator keeps running. Re-register once and resend, instead of
      // logging 404s until someone notices.
      if (res.status === 404) {
        log(`${device.id} is no longer registered (did the server restart?), re-registering`);
        const registration = await postJson(`${this.options.baseUrl}/devices`, {
          id: device.id,
          name: device.name,
        });
        if (!registration.ok && registration.status !== 409) {
          log(`${device.id} could not be re-registered: ${registration.status} ${await registration.text()}`);
          return;
        }
        res = await postJson(`${this.options.baseUrl}/devices/${device.id}/heartbeat`, payload);
      }

      if (!res.ok) {
        log(`${device.id} heartbeat rejected with ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      log(`${device.id} heartbeat failed: ${err.message}`);
    }
  }
}

function listenForCommands(simulator, onQuit) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const [command, arg] = line.trim().split(/\s+/);
    switch (command) {
      case 'stop':
      case 'start':
        if (!arg) {
          log(`usage: ${command} <device-id>`);
        } else if (command === 'stop') {
          simulator.stop(arg);
        } else {
          simulator.start(arg);
        }
        break;
      case 'status':
        void simulator.printStatus();
        break;
      case 'quit':
      case 'exit':
        rl.close();
        onQuit();
        break;
      case '':
      case undefined:
        break;
      default:
        log('commands: stop <id> | start <id> | status | quit');
    }
  });
}

async function main() {
  const options = parseOptions();
  const simulator = new FleetSimulator(options);

  log(`simulating ${options.deviceCount} devices against ${options.baseUrl}`);
  await simulator.registerAll();
  simulator.startAll();

  for (const [id, delayMs] of options.scheduledStops) {
    log(`${id} will stop in ${delayMs / 1000}s`);
    setTimeout(() => simulator.stop(id), delayMs);
  }

  const reporter = setInterval(() => void simulator.printStatus(), options.reportEveryMs);

  const quit = () => {
    clearInterval(reporter);
    simulator.stopAll();
    log('simulator stopped');
    process.exit(0);
  };

  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  if (process.stdin.isTTY) {
    listenForCommands(simulator, quit);
    log('commands: stop <id> | start <id> | status | quit');
  }
}

main().catch((err) => {
  console.error(`simulator failed: ${err.message}`);
  if (err.message.includes('fetch failed')) {
    console.error('is the fleet monitor running? start it with `npm run dev`');
  }
  process.exit(1);
});
