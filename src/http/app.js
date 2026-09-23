import express from 'express';
import { fileURLToPath } from 'node:url';
import { silentLogger } from '../logger.js';
import { createErrorHandler, notFoundHandler } from './error-handler.js';
import { createRoutes } from './routes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

function requestLogger(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}

/**
 * @param {{ fleet: import('../devices/fleet-service.js').FleetService, logger?: object }} deps
 */
export function createApp({ fleet, logger = silentLogger }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '10kb' }));
  // The dashboard is a single static page that polls the same public API.
  app.use(express.static(PUBLIC_DIR));
  app.use(createRoutes(fleet));
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
