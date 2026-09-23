// The API speaks snake_case; the domain model stays idiomatic camelCase.

/** @param {import('../devices/types.js').DeviceWithStatus} device */
export function toDeviceSummaryJson(device) {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    last_heartbeat: device.lastSeenAt?.toISOString() ?? null,
  };
}

/** @param {import('../devices/types.js').DeviceWithStatus} device */
export function toDeviceDetailJson(device) {
  const report = device.lastReport;
  return {
    ...toDeviceSummaryJson(device),
    registered_at: device.registeredAt.toISOString(),
    last_report: report
      ? {
          timestamp: report.timestamp.toISOString(),
          status: report.status,
          cpu_usage: report.cpuUsage ?? null,
          signal_strength: report.signalStrength ?? null,
        }
      : null,
  };
}
