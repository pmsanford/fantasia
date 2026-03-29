import { createServer, type Server } from 'node:http';
import { unlink } from 'node:fs/promises';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import type { ConnectRouter } from '@connectrpc/connect';

import { OrchestratorService } from './gen/fantasia/v1/orchestrator_pb.js';
import { TaskService } from './gen/fantasia/v1/task_pb.js';
import { MemoryService } from './gen/fantasia/v1/memory_pb.js';
import { EventService } from './gen/fantasia/v1/events_pb.js';

import { orchestratorServiceImpl } from './services/orchestrator.js';
import { taskServiceImpl } from './services/task.js';
import { memoryServiceImpl } from './services/memory.js';
import { eventServiceImpl } from './services/events.js';
import logger from './logger.js';

const log = logger.child('http');

export function registerRoutes(router: ConnectRouter): void {
  log.debug('Registering routes');
  router.service(OrchestratorService, orchestratorServiceImpl);
  router.service(TaskService, taskServiceImpl);
  router.service(MemoryService, memoryServiceImpl);
  router.service(EventService, eventServiceImpl);
}

export interface FantasiaServer {
  listen(): Promise<void>;
  close(): Promise<void>;
  readonly socketPath: string;
}

export function createFantasiaServer(socketPath: string): FantasiaServer {
  const handler = connectNodeAdapter({
    routes: registerRoutes,
  });
  const server: Server = createServer(handler);

  return {
    socketPath,

    async listen() {
      // Remove stale socket file if it exists
      log.debug('Removing stale socket if present', { socket: socketPath });
      await unlink(socketPath).catch(() => {});

      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(socketPath, () => {
          server.removeListener('error', reject);
          log.info('Server bound to socket', { socket: socketPath });
          resolve();
        });
      });
    },

    async close() {
      log.info('Server closing');
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await unlink(socketPath).catch(() => {});
      log.info('Server closed');
    },
  };
}
