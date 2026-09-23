# Fleet Monitor

A Node.js service that tracks heartbeats from a fleet of devices and reports which ones are currently reachable.

Devices register once and then send a heartbeat every few seconds. A device counts as ONLINE if its last heartbeat arrived within the last 30 seconds, and OFFLINE if it did not. An operator can list the fleet, look up a single device, or ask for a summary, either over the JSON API or from the dashboard at `http://localhost:3000`.

The repo also ships a simulator so you can run a fake fleet, stop one device, and watch it drop offline.

## Contents

- [Design](#design)
- [Prerequisites](#prerequisites)
- [Build and run](#build-and-run)
- [Run the simulator](#run-the-simulator)
- [Dashboard](#dashboard)
- [Run the tests](#run-the-tests)
- [Example API requests](#example-api-requests)
- [Assumptions](#assumptions)
- [Known limitations](#known-limitations)
- [What I would do with one more day](#what-i-would-do-with-one-more-day)
- [AI Usage](#ai-usage)

## Design

```
src/
├── server.js                  entry point: config, wiring, graceful shutdown
├── config.js                  reads PORT and OFFLINE_TIMEOUT_SECONDS
├── logger.js                  JSON lines logger
├── devices/                   domain logic, no Express in here
│   ├── types.js               JSDoc typedefs and the status constants
│   ├── status.js              computeStatus(), the ONLINE/OFFLINE rule
│   ├── fleet-service.js       register, heartbeat, list, summary
│   ├── device-repository.js   in-memory store
│   └── errors.js
└── http/                      the Express layer
    ├── app.js                 builds the app, used by the server and the tests
    ├── routes.js
    ├── schemas.js             request validation with zod
    ├── presenters.js          domain objects to snake_case JSON
    └── error-handler.js       maps errors to status codes
public/index.html              dashboard, one static file
simulator/simulator.js         command line fake fleet
tests/                         unit and API tests
```

A request passes through three layers. The HTTP layer validates the body with zod, calls the service, and shapes the response. It holds no business rules. `FleetService` holds the rules: registering a device, recording a heartbeat, working out status. `InMemoryDeviceRepository` stores the devices. Everything goes through four methods on it (`insert`, `save`, `findById`, `findAll`), so swapping in a database later means writing one new class and nothing else.

### The timeout

Status is worked out when it is read. It is never stored anywhere. Each heartbeat writes down the server time it arrived at (`lastSeenAt`), and every time a device is returned, `computeStatus(lastSeenAt, now, timeout)` decides ONLINE or OFFLINE.

The alternative would be a background job that sweeps the fleet every few seconds and flips stale devices to OFFLINE. I went with computing on read for three reasons.

1. It is always right. A sweeper running every N seconds can report a dead device as ONLINE for up to N extra seconds.
2. There is no timer to manage. Nothing to start, stop, or clean up on shutdown, and no race between the sweeper and an incoming heartbeat.
3. It is easy to test. The service takes a clock function, so the tests hand it a fake clock and jump time forward instead of sleeping. The whole suite runs in about a second.

The cost is one subtraction per device per read, which is nothing at this scale.

### Other decisions worth explaining

**Liveness uses the server clock, not the device's timestamp.** Device clocks drift. If I trusted the timestamp in the heartbeat body, a device whose clock is set a day ahead would look ONLINE forever. The reported timestamp is still stored and returned under `last_report`, it just does not decide status.

**A late heartbeat still counts.** Heartbeats can arrive out of order after a retry. Any heartbeat proves the device is alive, so it always updates `lastSeenAt`. It only replaces `last_report` if its own timestamp is newer, so a delayed packet cannot overwrite fresher metrics.

**No locks.** Node handles requests on one thread and every store operation here is synchronous, so each read, modify, write finishes before the next request is touched. A shared database would change that, which is why it is listed under limitations.

**One error shape.** Every failure comes back as `{ "error": { "code", "message", "details?" } }`, so a client only has to parse one thing.

## Prerequisites

Node.js 20 or newer, and npm. Check with `node --version`. Built and tested on Node 22.

Nothing else is needed. No database, no Docker, no services to start.

## Build and run

```bash
git clone <repo-url> fleet-monitor
cd fleet-monitor
npm install
```

There is no build step. This is plain JavaScript using ES modules, so Node runs `src/` as it is. `npm install` is the whole setup.

Start the server:

```bash
npm start
```

Or in development, which restarts on file changes:

```bash
npm run dev
```

It listens on `http://localhost:3000`.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `OFFLINE_TIMEOUT_SECONDS` | `30` | Seconds of silence before a device is OFFLINE |

```bash
PORT=8080 OFFLINE_TIMEOUT_SECONDS=10 npm start
```

Or copy `.env.example` to `.env` and run `node --env-file=.env src/server.js`.

Bad values are rejected at startup rather than ignored. `OFFLINE_TIMEOUT_SECONDS=abc` exits with a message instead of silently falling back to 30.

Logs go to stdout, one JSON object per line, so you can pipe them into `jq`. Ctrl+C or SIGTERM shuts down gracefully: it stops taking new connections, lets in flight requests finish, and force exits after 5 seconds if something hangs.

## Run the simulator

Start the server in one terminal, then in another:

```bash
npm run simulate
```

That registers `device-01` through `device-05` and sends a heartbeat from each one every 5 seconds, with random cpu and signal values. Every 10 seconds it prints a summary line.

To watch a device go offline, type this into the running simulator:

```
stop device-03
```

About 30 seconds later the summary line shows it:

```
[18:50:35] fleet: total=5 online=4 offline=1  [offline: device-03]
```

`start device-03` brings it back. The commands are `stop <id>`, `start <id>`, `status` and `quit`.

If you would rather not type anything, schedule the stop up front:

```bash
npm run simulate -- --stop-after device-03=10
```

| Flag | Default | What it does |
|---|---|---|
| `--url` | `http://localhost:3000` | Server URL, or set `FLEET_URL` |
| `--devices` | `5` | How many devices |
| `--interval` | `5` | Seconds between heartbeats |
| `--report-every` | `10` | Seconds between summary lines |
| `--stop-after` | none | `<id>=<seconds>`, can be repeated |

You can restart the simulator against a server that is already running. Devices that already exist are reused rather than treated as an error.

## Dashboard

With the server running, open `http://localhost:3000`. You do not need the command line simulator for this; the page can drive everything on its own.

It shows the summary as three tiles and a table of every device with the time since its last heartbeat, refreshed every 2 seconds. The controls are:

| Control | What it does |
|---|---|
| Add 5 devices | Registers `device-01` to `device-05` and starts beating them |
| Register | Registers one device with the id and name you type |
| Start and Stop per row | Turns heartbeats for that device on or off |
| Start all, Stop all | The same for everything in the table |
| Heartbeat every n seconds | Retimes the devices that are already running |

To see the 30 second rule, click Add 5 devices and then Stop on any row. Its last heartbeat column counts up and the row turns OFFLINE once it passes 30 seconds, while the rest stay ONLINE and the tiles move to 4 and 1. An activity log at the bottom records every register, start and stop.

A few things about how it is put together:

The page is one static file served by `express.static`. No framework and no build step, and it loads nothing from the internet, so it works offline and will still run in a year.

It is just another API client. It registers devices and sends heartbeats through the same endpoints `curl` would use. I did not add a simulator-only route to the API, because then the API would no longer be the real interface.

It can only start and stop the devices it is beating itself. If `npm run simulate` is running, or the dashboard is open in a second tab, those devices belong to that client. The table marks them with "not from this page" so an ONLINE row with a Start button next to it does not look broken. Its own heartbeats stop when the tab is closed.

Status is never shown by colour alone. Every row has a coloured dot and the word ONLINE or OFFLINE, so it reads fine in greyscale or with colour blindness. Light and dark both follow the system setting.

The "x seconds ago" column is calculated against the server's clock, taken from the response `Date` header, so it stays correct even if the browser clock is off.

If you set the heartbeat interval to something at or above the server's timeout, the page warns you, because every device would then drop offline between heartbeats. It reads the actual configured timeout from `GET /health` rather than assuming 30.

## Run the tests

```bash
npm test            # run once
npm run test:watch  # rerun on change
```

55 tests across 4 files.

| File | What it covers |
|---|---|
| `tests/status.test.js` | The ONLINE/OFFLINE rule, the exact 30 second boundary, and a device that has never reported |
| `tests/fleet-service.test.js` | Registration, duplicate ids, heartbeats, timeout transitions, recovery, out of order heartbeats, filtering, summary |
| `tests/api.test.js` | Every endpoint over HTTP: status codes, validation failures, malformed JSON, 404 and 409, the timeout end to end, and that the dashboard is served |
| `tests/config.test.js` | Environment variable parsing and rejection of bad values |

None of the timeout tests sleep. They move a fake clock instead, so testing a 30 second rule takes milliseconds.

## Example API requests

| Method | Path | Success | Failures |
|---|---|---|---|
| POST | `/devices` | 201 | 400, 409 |
| POST | `/devices/{id}/heartbeat` | 200 | 400, 404 |
| GET | `/devices` and `/devices?status=ONLINE\|OFFLINE` | 200 | 400 |
| GET | `/devices/{id}` | 200 | 404 |
| GET | `/summary` | 200 | |
| GET | `/health` | 200 | |

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

A new device starts OFFLINE because it has not proven anything yet. `id` allows letters, digits, `.`, `_` and `-`, up to 64 characters. `name` is 1 to 100 characters.

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

| Field | Required | Rules |
|---|---|---|
| `timestamp` | yes | ISO 8601 with a timezone, for example `2026-09-21T10:30:00Z` |
| `status` | yes | Non empty string up to 32 characters, the device's own health |
| `cpu_usage` | no | Number from 0 to 100 |
| `signal_strength` | no | Number from -150 to 0, in dBm |

`last_heartbeat` is when the server received it. `last_report.timestamp` is when the device says it sent it.

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

Sorted by id. The filter is case insensitive.

### One device, and the summary

```bash
curl http://localhost:3000/devices/device-01
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

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A body or query parameter failed validation |
| `MALFORMED_JSON` | 400 | The body is not valid JSON |
| `DEVICE_NOT_FOUND` | 404 | No device with that id |
| `ROUTE_NOT_FOUND` | 404 | No such path or method |
| `DEVICE_ALREADY_EXISTS` | 409 | That id is already registered |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 10 KB |
| `INTERNAL_ERROR` | 500 | Anything unexpected, logged with a stack trace |

If you are on Windows, note that `cmd` and PowerShell do not handle the single quotes above. In `cmd` use double quotes and escape the inner ones, all on one line:

```
curl -X POST localhost:3000/devices -H "content-type: application/json" -d "{\"id\":\"device-01\",\"name\":\"Lab Device 01\"}"
```

## Assumptions

Exactly 30 seconds counts as ONLINE. The brief says ONLINE "within the last 30 seconds" and OFFLINE after "more than 30 seconds", so the boundary itself belongs to ONLINE. There is a test for this either side of the line.

A device that has registered but never sent a heartbeat is OFFLINE. It has not shown it is alive yet.

The `status` field inside a heartbeat is informational. A device reporting `"status": "ERROR"` is still ONLINE, because ONLINE and OFFLINE describe whether we can hear from it, not whether it is healthy. Its own reported value shows up in `last_report.status`.

Heartbeats have to come from a registered device. An unknown id gets a 404 instead of being registered on the spot, so a typo cannot quietly create a phantom device. The tradeoff is that clients have to handle that 404 by registering again, which both simulators do.

Device ids are unique and permanent. Registering the same id twice returns 409 and leaves the original name alone.

There is no authentication. The service is assumed to sit on a trusted internal network.

## Known limitations

Everything is in memory, so restarting the server wipes the registrations. Both simulators cope with this: a heartbeat that comes back as 404 triggers one re-registration and a resend, and the event goes in the log. A restart therefore costs one heartbeat per device rather than leaving the clients stuck. Real devices would need the same retry rule.

One instance only. The state lives in the process, so two instances behind a load balancer would each see a different fleet. Scaling out needs a shared store such as Redis with a TTL per device, and atomic updates in it.

No authentication and no rate limiting. Anyone who can reach the port can register a device or send heartbeats as any device.

No way to rename or delete a device.

`GET /devices` returns everything with no pagination. Fine for a lab fleet, not for tens of thousands.

Nothing is pushed. Clients poll, and nothing tells anyone when a device goes offline.

Reported timestamps are not sanity checked. A device can claim a timestamp far in the future. It does not affect status, which uses server time, but it would stop later reports from replacing `last_report`.

The dashboard's own heartbeats die with the tab, since they run on browser timers.

## What I would do with one more day

Put SQLite behind the repository so registrations survive a restart. The four methods are already the only way anything reaches storage, so nothing else has to change.

Add offline alerts. A background check that spots ONLINE to OFFLINE transitions and fires a webhook. Reads would still compute status on the fly, so this adds notifications without putting correctness back in the hands of a timer.

Give each device a token at registration and require it on heartbeats, so one device cannot report on behalf of another.

Generate an OpenAPI spec from the zod schemas, add a Dockerfile, and run the tests in CI on every push.

Add a browser test for the dashboard. Right now there is only a test that the page is served. A Playwright test could click Stop and assert the row turns OFFLINE.

Reject reported timestamps more than a few minutes in the future.

## AI Usage

I used **Claude** (Anthropic).

**What I used it for.** Breaking the brief into a checklist before I started. Scaffolding the Express app, the zod schemas, the test files and the dashboard. Talking through edge cases in the timeout logic. Drafting parts of this README.

**What I changed or rejected.**

The first suggestion was Python with FastAPI. I rejected it and used Node with Express, because that is what I work in and what I can defend line by line.

It proposed a background sweeper that would periodically mark devices OFFLINE. I did not use it. Computing status on read from a server side `lastSeenAt` is exact at every instant, and it let the tests inject a clock instead of sleeping for 30 seconds.

The dashboard originally wrapped its rendering inside the same `try/catch` as the `fetch`, so a rendering bug got reported to the user as "Cannot reach the server". I split them. The network call is guarded, the render is not, so the message can no longer blame the wrong thing.

Neither simulator handled the server restarting. Both registered once at startup, so after a restart every heartbeat logged a 404 forever while the summary showed an empty fleet. The server was right to reject them, the clients were wrong to give up, so I made both re-register once on a 404 and resend.

**What I verified myself.**

I ran the server and the simulator, stopped `device-03`, and watched it turn OFFLINE about 30 seconds after its last heartbeat while the other four stayed ONLINE and the summary read 4 online, 1 offline.

I opened the dashboard with an empty fleet and found a real bug. The empty state row was built with `rows.append(tr).append(cell)`, but `append()` returns undefined, so the row was never added and the table just rendered blank. Fixed it and rechecked the empty state, the filters, the live refresh and the disconnected banner.

I killed the server while both simulators were mid run and confirmed the recovery: one re-registration line per device in the log, and the fleet back to 5 online.

I set the dashboard's heartbeat interval above the 30 second timeout and watched the whole fleet flicker offline and back every cycle. The input allowed it and said nothing. That is why `GET /health` now reports the configured timeout and the page warns instead of guessing.

I read through the boundary tests and checked they match the wording of the brief, and I sent malformed JSON, missing fields and unknown ids with curl to confirm the 400, 404 and 409 responses.
