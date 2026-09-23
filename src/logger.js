// One JSON object per line, so the output can be piped straight into jq or a log shipper.
export function createLogger() {
  const write = (level, message, fields = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  };

  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
