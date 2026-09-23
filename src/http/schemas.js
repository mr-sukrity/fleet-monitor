import { z } from 'zod';
import { DEVICE_STATUSES } from '../devices/types.js';

// Ids end up in URLs, so keep them to URL-safe characters.
export const deviceIdSchema = z
  .string()
  .min(1, 'id is required')
  .max(64, 'id must be at most 64 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'id may only contain letters, digits, ".", "_" and "-"');

export const registerDeviceSchema = z.object({
  id: deviceIdSchema,
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be at most 100 characters'),
});

export const heartbeatSchema = z.object({
  timestamp: z
    .string()
    .datetime({ offset: true, message: 'timestamp must be an ISO 8601 date-time, e.g. 2026-09-21T10:30:00Z' })
    .transform((value) => new Date(value)),
  status: z.string().trim().min(1, 'status is required').max(32, 'status must be at most 32 characters'),
  cpu_usage: z.number().min(0).max(100).optional(),
  signal_strength: z.number().min(-150).max(0).optional(),
});

export const listDevicesQuerySchema = z.object({
  status: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(DEVICE_STATUSES))
    .optional(),
});
