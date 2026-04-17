import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'artifacts', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = path.join(LOG_DIR, `visa-monitor-${new Date().toISOString().slice(0, 10)}.log`);

export const logger = pino(
  { level: process.env['LOG_LEVEL'] ?? 'info' },
  pino.multistream([
    {
      stream: pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      }),
    },
    { stream: pino.destination({ dest: logFile, sync: false }) },
  ])
);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
