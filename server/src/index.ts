import logger, { getLogLevel } from './logger.js';
import { createFantasiaServer } from './server.js';
import { shutdown } from './bridge.js';

const log = logger;

const socketPath = process.argv[2] ?? process.env.FANTASIA_SOCKET ?? '/tmp/fantasia.sock';

log.info('Starting server', { logLevel: getLogLevel(), socket: socketPath });

const server = createFantasiaServer(socketPath);

async function gracefulShutdown() {
  log.info('Shutdown initiated');
  await shutdown();
  await server.close();
  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

try {
  await server.listen();
  log.info('Server listening', { socket: socketPath });
} catch (err) {
  log.fatal('Failed to start server', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}
