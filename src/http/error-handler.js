import { ZodError } from 'zod';
import { DeviceAlreadyExistsError, DeviceNotFoundError } from '../devices/errors.js';

function body(code, message, details) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function notFoundHandler(req, res) {
  res.status(404).json(body('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

// Errors raised by express.json() carry an http status and a `type` field.
function isBodyParserError(err) {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

// Translates domain and parser errors into HTTP status codes. Anything unrecognised
// is logged with its stack trace and reported as a generic 500.
export function createErrorHandler(logger) {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({
        field: issue.path.join('.') || null,
        message: issue.message,
      }));
      res.status(400).json(body('VALIDATION_ERROR', 'Request is invalid', details));
      return;
    }
    if (err instanceof DeviceNotFoundError) {
      res.status(404).json(body('DEVICE_NOT_FOUND', err.message));
      return;
    }
    if (err instanceof DeviceAlreadyExistsError) {
      res.status(409).json(body('DEVICE_ALREADY_EXISTS', err.message));
      return;
    }
    if (isBodyParserError(err)) {
      if (err.type === 'entity.parse.failed') {
        res.status(400).json(body('MALFORMED_JSON', 'Request body is not valid JSON'));
        return;
      }
      if (err.type === 'entity.too.large') {
        res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body is too large'));
        return;
      }
    }

    logger.error('unhandled error', {
      method: req.method,
      path: req.path,
      error: err instanceof Error ? err.stack : String(err),
    });
    res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
  };
}
