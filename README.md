# Fleet Monitor

A small Node.js HTTP service that tracks heartbeats from a fleet of devices and reports which ones are online.

Devices register once, then send heartbeats periodically. A device is **ONLINE** if its last heartbeat arrived within the last 30 seconds and **OFFLINE** otherwise. Operators can list devices, look at one device, or get a fleet-wide summary, either through the JSON API or the small dashboard at `http://localhost:3000`. The repo also includes a simulator that runs a fleet of fake devices, so you can watch devices go offline in real time.

## Contents

- [Design](#design)
- [Prerequisites](#prerequisites)
- [Build and run](#build-and-run)
- [Run the simulator](#run-the-simulator)
- [Dashboard](#dashboard)
- [Run the tests](#run-the-tests)
- [API](#api)
- [Assumptions](#assumptions)
- [Known limitations](#known-limitations)
- [With one more day](#with-one-more-day)
- [AI Usage](#ai-usage)

## Design

```
src/
├── server.js                  entry point: config, wiring, graceful shutdown
├── config.js                  env var parsing (PORT, OFFLINE_TIMEOUT_SECONDS)
├── logger.js                  JSON-lines logger
├── devices/                   domain logic, no HTTP in here
│   ├── types.js
│   ├── status.js              computeStatus(): the ONLINE/OFFLINE rule
│   ├── fleet-service.js       register, heartbeat, list, summary
│   ├── device-repository.js   in-memory store (swappable for a database)
│   └── errors.js
└── http/                      Express layer
    ├── app.js                 builds the app (used by server and tests)
    ├── routes.js
    ├── schemas.js             request validation (zod)
    ├── presenters.js          domain objects -> snake_case JSON
    └── error-handler.js       maps errors to status codes
public/index.html              dashboard: one static page, no build step
simulator/simulator.js         fake device fleet
tests/                         unit and API tests (vitest + supertest)
```

A request goes through three layers:

1. **HTTP** (`src/http`) validates input with zod, calls the service and formats the response. It has no business rules.
2. **Service** (`FleetService`) holds the logic: registering devices, recording heartbeats and working out status.
3. **Repository** (`InMemoryDeviceRepository`) stores devices. Everything goes through four methods (`insert`, `save`, `findById`, `findAll`), so a database-backed store can replace it without touching the other layers.

### How the timeout works

Status is **computed when it is read**. It is never stored. Every heartbeat records the server time at which it arrived (`lastSeenAt`). Whenever a device is returned, `computeStatus(lastSeenAt, now, timeout)` decides ONLINE or OFFLINE.

I chose this over a background job that flips devices to OFFLINE for three reasons:

- **The status is always correct.** A sweeper that runs every N seconds can report a dead device as ONLINE for up to N extra seconds.
- **No timers to manage.** No interval to start, stop or clean up on shutdown, and no race between the sweeper and incoming heartbeats.
- **Easy to test.** The service takes a `clock` function. The tests use a fake clock and move time forward by hand, so the 30-second tests run in milliseconds without calling `sleep`.

The cost is one small calculation per device per read. That is negligible at this scale.

### Other decisions

- **Liveness uses server time, not the device's `timestamp`.** Device clocks can drift or be wrong. If the device's timestamp were trusted, a device with a clock set in the future could stay ONLINE forever. The device's timestamp is still stored and returned under `last_report`.
- **Out-of-order heartbeats.** A delayed heartbeat still counts as proof of life. It only replaces `last_report` (the metrics) if its timestamp is newer than the stored one, so a late packet can't overwrite fresher data.
- **Concurrency.** Node runs request handlers on a single thread, and every store operation is synchronous. Each read-modify-write therefore finishes before the next request is handled, so no locks are needed. A shared database would change this (see limitations).
- **Consistent errors.** Every error response has the same shape: `{ "error": { "code", "message", "details?" } }`.

## Prerequisites

- **Node.js 20 or newer** (built and tested on Node 22). Check with `node --version`.
- npm (comes with Node).

No database or other services are needed.

## Build and run

```bash
git clone <repo-url> fleet-monitor
cd fleet-monitor
npm install
```

**There is no build step.** This is plain JavaScript with ES modules, so Node runs `src/` directly. `npm install` is all the preparation needed.

Start the server:

```bash
npm start
```

Development mode (restarts automatically when a file changes):

```bash
npm run dev
```

The server listens on `http://localhost:3000` by default.

### Configuration

| Variable                  | Default | Meaning                                            |
|---------------------------|---------|----------------------------------------------------|
| `PORT`                    | `3000`  | HTTP port                                          |
| `OFFLINE_TIMEOUT_SECONDS` | `30`    | Seconds without a heartbeat before a device is OFFLINE |

```bash
PORT=8080 OFFLINE_TIMEOUT_SECONDS=10 npm start
# or copy .env.example to .env and run:
node --env-file=.env src/server.js
```

The server exits with an error if a variable is set to something invalid, such as `OFFLINE_TIMEOUT_SECONDS=abc`.

Logs are written to stdout as one JSON object per line. `Ctrl+C` or `SIGTERM` shuts the server down gracefully: it stops accepting connections, lets in-flight requests finish, and force-exits after 5 seconds.

## Run the simulator

Start the server in one terminal, then run this in another:

```bash
npm run simulate
```

This registers `device-01` to `device-05`. Each device sends a heartbeat every 5 seconds with random `cpu_usage` and `signal_strength` values. A fleet summary is printed every 10 seconds.

**To see a device go OFFLINE,** type this into the running simulator:

```
stop device-03
```

About 30 seconds later the summary line shows:

```
[18:50:35] fleet: total=5 online=4 offline=1  [offline: device-03]
```

Type `start device-03` to bring it back. The full command list is `stop <id>`, `start <id>`, `status` and `quit`.

You can also schedule a stop without typing anything:

```bash
npm run simulate -- --stop-after device-03=10
```

| Flag             | Default                 | Meaning                                  |
|------------------|-------------------------|------------------------------------------|
| `--url`          | `http://localhost:3000` | Server URL (or set `FLEET_URL`)          |
| `--devices`      | `5`                     | Number of devices                        |
| `--interval`     | `5`                     | Seconds between heartbeats               |
| `--report-every` | `10`                    | Seconds between summary lines            |
| `--stop-after`   | none                    | `<id>=<seconds>`; can be repeated        |

The simulator can be restarted against a server that is already running. Devices that are already registered are reused.

## Dashboard

With the server running, open **http://localhost:3000** in a browser. Nothing else needs to be started — the whole exercise can be driven from this page.

It shows the fleet summary as three tiles and a table of every device with the time since its last heartbeat, refreshed every 2 seconds. From the same page you can:

| Control | What it does |
|---|---|
| **Add 5 devices** | Registers `device-01` … `device-05` and starts beating them, the same fleet the CLI simulator creates |
| **Register** | Registers one device with an id and name you type, then starts beating it |
| **Start / Stop** (per row) | Starts or stops heartbeats for that device |
| **Start all / Stop all** | The same, for every device in the table |
| **Heartbeat every _n_ seconds** | Retimes the running devices without restarting them |

**To see the 30-second rule:** click *Add 5 devices*, then *Stop* on any row. Its "last heartbeat" column counts up and the row flips to OFFLINE once it passes 30 seconds, while the rest stay ONLINE and the tiles update to 4 / 1.

An activity log at the bottom records every registration, start and stop, so it is clear what the page did and when.

### How it is built

- **One static file** (`public/index.html`), served by `express.static`. No framework, no build step, no external requests, so it still works offline and cannot rot.
- **The page is just another API client.** It registers devices and sends heartbeats over the same public endpoints as the CLI simulator. No private endpoint was added for it, so the API stays the real interface and the browser cannot do anything `curl` could not.
- **It only controls the devices it beats.** Devices driven by `npm run simulate` belong to that process; the page shows their status but its Start/Stop cannot reach them. Its own heartbeats stop when the tab is closed.
- **Status is never colour alone.** Each row carries a coloured dot *and* the word ONLINE or OFFLINE, which keeps it readable for colourblind users and in greyscale. Light and dark themes both follow the OS setting.
- **The "x s ago" column uses the server's clock**, read from the response `Date` header, so the countdown stays honest even if the browser's clock is off.
- **Polling uses a timeout chain**, not `setInterval`, so a slow response cannot stack up overlapping requests.

The dashboard is optional. Everything it does is available from the API with `curl`.

## Run the tests

```bash
npm test            # run once
npm run test:watch  # re-run on change
```

| File                          | Covers                                                                                           |
|-------------------------------|--------------------------------------------------------------------------------------------------|
| `tests/status.test.js`        | The ONLINE/OFFLINE rule, including the exact 30s boundary and a device that never sent a heartbeat |
| `tests/fleet-service.test.js` | Registration, duplicates, heartbeats, timeout transitions, recovery, out-of-order heartbeats, filtering, summary |
| `tests/api.test.js`           | Every endpoint over HTTP: status codes, validation errors, malformed JSON, 404/409, the 30s timeout end to end, and that the dashboard page is served |
| `tests/config.test.js`        | Env var parsing and rejection of invalid values                                                  |

None of the timeout tests sleep. They move a fake clock forward instead, so the whole suite runs in about a second.

## API

All request and response bodies are JSON.

| Method | Path                      | Success | Errors        |
|--------|---------------------------|---------|---------------|
| POST   | `/devices`                | 201     | 400, 409      |
| POST   | `/devices/{id}/heartbeat` | 200     | 400, 404      |
| GET    | `/devices[?status=ONLINE\|OFFLINE]` | 200 | 400 |
| GET    | `/devices/{id}`           | 200     | 404           |
| GET    | `/summary`                | 200     |               |
| GET    | `/health`                 | 200     |               |

### Register a device

```bash
curl -i -X POST http://localhost:3000/devices \
  -H 'content-type: application/json' \
  -d '{"id": "device-01", "name": "Lab Device 01"}'
```

```http
HTTP/1.1 201 Created
Location: /devices/device-01

{
  "id": "device-01",
  "name": "Lab Device 01",
  "status": "OFFLINE",
  "last_heartbeat": null,
  "registered_at": "2026-09-21T10:29:55.000Z",
  "last_report": null
}
```

`id` may contain letters, digits, `.`, `_` and `-`, up to 64 characters. `name` must be 1 to 100 characters.

### Send a heartbeat

```bash
curl -X POST http://localhost:3000/devices/device-01/heartbeat \
  -H 'content-type: application/json' \
  -d '{"timestamp": "2026-09-21T10:30:00Z", "status": "OK", "cpu_usage": 42, "signal_strength": -71}'
```

```json
{
  "id": "device-01",
  "name": "Lab Device 01",
  "status": "ONLINE",
  "last_heartbeat": "2026-09-21T10:30:00.120Z",
  "registered_at": "2026-09-21T10:29:55.000Z",
  "last_report": {
    "timestamp": "2026-09-21T10:30:00.000Z",
    "status": "OK",
    "cpu_usage": 42,
    "signal_strength": -71
  }
}
```

| Field             | Required | Rules                                          |
|-------------------|----------|------------------------------------------------|
| `timestamp`       | yes      | ISO 8601 date-time with a timezone, e.g. `Z`   |
| `status`          | yes      | Non-empty string, up to 32 characters (the device's own health, e.g. `OK`) |
| `cpu_usage`       | no       | Number, 0 to 100 (percent)                     |
| `signal_strength` | no       | Number, -150 to 0 (dBm)                        |

`last_heartbeat` is when the server received the heartbeat. `last_report.timestamp` is the time the device reported.

### List devices

```bash
curl http://localhost:3000/devices
curl "http://localhost:3000/devices?status=OFFLINE"
```

```json
[
  { "id": "device-01", "name": "Lab Device 01", "status": "ONLINE",  "last_heartbeat": "2026-09-21T10:30:00.120Z" },
  { "id": "device-02", "name": "Lab Device 02", "status": "OFFLINE", "last_heartbeat": null }
]
```

Devices are sorted by id. The `status` filter is case-insensitive.

### Get one device

```bash
curl http://localhost:3000/devices/device-01
```

This returns the same shape as the heartbeat response above.

### Fleet summary

```bash
curl http://localhost:3000/summary
```

```json
{ "total": 5, "online": 4, "offline": 1 }
```

### Errors

```bash
curl -X POST http://localhost:3000/devices/device-01/heartbeat \
  -H 'content-type: application/json' -d '{"status": "OK"}'
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request is invalid",
    "details": [{ "field": "timestamp", "message": "Required" }]
  }
}
```

| Code                    | HTTP | When                                          |
|-------------------------|------|-----------------------------------------------|
| `VALIDATION_ERROR`      | 400  | Body or query parameter fails validation      |
| `MALFORMED_JSON`        | 400  | Body is not valid JSON                        |
| `DEVICE_NOT_FOUND`      | 404  | Unknown device id                             |
| `ROUTE_NOT_FOUND`       | 404  | Unknown path or method                        |
| `DEVICE_ALREADY_EXISTS` | 409  | Registering an id that is already taken       |
| `PAYLOAD_TOO_LARGE`     | 413  | Body larger than 10 KB                        |
| `INTERNAL_ERROR`        | 500  | Anything unexpected (logged with a stack trace) |

## Assumptions

- **Exactly 30 seconds counts as ONLINE.** The brief says ONLINE "within the last 30 seconds" and OFFLINE after "more than 30 seconds", so the boundary itself is ONLINE.
- **A registered device that has never sent a heartbeat is OFFLINE.** It has never proven it is alive.
- **The device's `status` field is informational only.** A device reporting `"status": "ERROR"` is still ONLINE, because it is reachable. ONLINE/OFFLINE describes connectivity, not health. The reported value is shown in `last_report.status`.
- **Heartbeats must come from registered devices.** A heartbeat for an unknown id returns 404 rather than registering the device silently, so a typo in an id cannot quietly create a phantom device. The cost is that clients must handle that 404 by re-registering; both simulators do.
- **Device ids are unique and permanent.** Registering the same id twice returns 409 and does not overwrite the name.
- **No authentication.** The service is assumed to run on a trusted internal network.

## Known limitations

- **Data is in memory only.** Restarting the server loses every registration. Both simulators handle this: a heartbeat that comes back `404 DEVICE_NOT_FOUND` triggers one re-registration and a resend, and the event is logged. So a restart costs at most one heartbeat per device rather than leaving the clients stuck. Real devices would need the same retry rule, which is why it is worth stating: **a heartbeat can legitimately be rejected, and the client is expected to re-register.**
- **Single instance only.** State lives in the process, so running two instances behind a load balancer would give each one a different view of the fleet. Scaling out needs a shared store (for example Redis with a TTL per device), and atomic updates in that store.
- **No authentication or rate limiting.** Anyone who can reach the port can register devices or send heartbeats for any device.
- **No way to update or delete a device.**
- **`GET /devices` has no pagination.** This is fine for a small fleet but would not work well for tens of thousands of devices.
- **Status changes are not pushed.** Clients have to poll. Nothing notifies anyone when a device goes OFFLINE.
- **Reported timestamps are not sanity-checked.** A device can report a timestamp far in the future. It does not affect ONLINE/OFFLINE, which uses server time, but it would stop newer reports from replacing `last_report`.

## With one more day

1. **Persistence:** SQLite behind the existing repository methods, so devices survive restarts.
2. **OFFLINE alerts:** a background check that finds ONLINE-to-OFFLINE transitions and sends a webhook or event. Reads would still compute status on the fly, so this adds notifications without affecting correctness.
3. **Device authentication:** a per-device token issued at registration and required on heartbeats, so one device can't send heartbeats for another.
4. **API docs and container:** an OpenAPI spec generated from the zod schemas, a Dockerfile, and CI running the tests on every push.
5. **Browser tests for the dashboard:** the page is currently only covered by a test that it is served. A Playwright test could assert that a stopped device flips to OFFLINE on screen.
6. **Reject implausible timestamps:** reject reported timestamps more than a few minutes in the future.

## AI Usage

<!-- Edit this section so it matches exactly what you did. Reviewers may ask about it. -->

**Tools:** Claude (Anthropic).

**What I used it for:**
- Breaking the brief down into requirements and deliverables before starting.
- Scaffolding the Express app, zod schemas, test files and the dashboard page.
- Reviewing edge cases in the timeout logic and drafting parts of this README.

**What I changed or rejected:**
- The first suggestion was Python/FastAPI. I rejected it and used Node/Express, because that is the stack I work in daily and can defend line by line.
- I did not use a periodic "sweeper" that marks devices OFFLINE. I compute status on read from a server-side `lastSeenAt`. This keeps the status exact at every moment, and lets the tests use an injected clock instead of sleeping for 30 seconds.
- I chose to track liveness using the server's receive time instead of the device's reported `timestamp`, so a device with a wrong clock can't appear ONLINE forever.
- The dashboard's first version wrapped rendering inside the same `try/catch` as the `fetch`, so a rendering bug surfaced as "Cannot reach the server". I split the two: the network call is guarded, the render is not, so the error message can no longer point at the wrong cause.
- Neither simulator handled a server restart. Both registered once at startup, so after a restart every heartbeat logged `404 DEVICE_NOT_FOUND` forever while `/summary` reported an empty fleet. The server was right to reject them; the clients were wrong to give up. I made both re-register once on a 404 and resend, and say so in the log.

**What I verified myself:**
- I ran the server and the simulator, stopped `device-03`, and watched it turn OFFLINE about 30 seconds after its last heartbeat, while the other four stayed ONLINE. `/summary` reported `4 online / 1 offline`.
- I read through the boundary tests (exactly 30s is ONLINE, 30s + 1ms is OFFLINE) and checked that they match the wording of the brief.
- I sent malformed JSON, missing fields and unknown device ids with curl, and checked the status codes (400/404/409).
- I opened the dashboard with an empty fleet and found a real bug: the empty-state row was built with `rows.append(tr).append(cell)`, but `append()` returns `undefined`, so the row was never added and the table silently rendered blank. I fixed it and re-checked the empty state, the filters, the live refresh and the disconnected banner in the browser.
- I killed the server while both simulators were mid-run and confirmed the recovery: each device logs one re-registration and the fleet returns to 5 online, instead of the endless 404s the earlier version produced.
