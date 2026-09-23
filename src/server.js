import { loadConfig } from './config.js';
import { InMemoryDeviceRepository } from './devices/device-repository.js';
import { FleetService } from './devices/fleet-service.js';
import { createApp } from './http/app.js';
import { createLogger } from './logger.js';

const SHUTDOWN_GRACE_MS = 5000;

function main() {
  const logger = createLogger();
  const config = loadConfig();

  const fleet = new FleetService({
    repository: new InMemoryDeviceRepository(),
    offlineTimeoutMs: config.offlineTimeoutMs,
  });
  const app = createApp({ fleet, logger });

  const server = app.listen(config.port, () => {
    logger.info('fleet monitor listening', {
      port: config.port,
      offline_timeout_seconds: config.offlineTimeoutMs / 1000,
    });
  });

  server.on('error', (err) => {
    logger.error('server failed to start', { error: err.message });
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });

    // Stop accepting new connections and let in-flight requests finish.
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => {
      logger.warn('forcing shutdown after grace period', { grace_ms: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
