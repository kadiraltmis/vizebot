import 'dotenv/config';
import { loadConfig } from './config/loader.js';
import { getDb, closeDb } from './db/database.js';
import { Scheduler } from './core/scheduler.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('visa-monitor starting up');

  const config = loadConfig();
  logger.info({ providers: config.providers.filter((p) => p.enabled).map((p) => p.id) }, 'Config loaded');

  // Open the database (runs migrations, creates tables)
  getDb();

  const scheduler = new Scheduler(config);
  scheduler.start(config);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    scheduler.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive (scheduler timers are unref'd to allow clean exit when stopped)
  await new Promise<void>((resolve) => {
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
