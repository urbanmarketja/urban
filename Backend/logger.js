const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'backend.log');

function write(level, message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details
  };

  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'error') {
    console.error(line.trim());
  } else {
    console.log(line.trim());
  }

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // Console logging remains available if the filesystem is read-only.
  }
}

function info(message, details) {
  write('info', message, details);
}

function warn(message, details) {
  write('warn', message, details);
}

function error(message, details) {
  write('error', message, details);
}

module.exports = {
  error,
  info,
  warn
};
