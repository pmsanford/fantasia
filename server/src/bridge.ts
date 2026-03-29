import { ConnectError, Code } from '@connectrpc/connect';
import {
  Orchestrator,
  RealSdkAdapter,
  type OrchestratorConfig as CoreOrchestratorConfig,
  type SdkAdapter,
} from '@fantasia/core';
import logger from './logger.js';

const log = logger.child('bridge');

let orchestrator: Orchestrator | null = null;
let eventSequence = 0;

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    log.warn('getOrchestrator called but not initialized');
    throw new ConnectError('Orchestrator not initialized. Call Initialize first.', Code.FailedPrecondition);
  }
  log.trace('getOrchestrator');
  return orchestrator;
}

export function isInitialized(): boolean {
  return orchestrator !== null;
}

export async function initialize(config: CoreOrchestratorConfig, sdk?: SdkAdapter): Promise<void> {
  if (orchestrator) {
    log.warn('Initialize called but orchestrator already exists');
    throw new ConnectError('Orchestrator already initialized. Call Stop first.', Code.AlreadyExists);
  }
  log.info('Orchestrator initializing', { model: config.model, cwd: config.cwd });
  const adapter = sdk ?? new RealSdkAdapter();
  orchestrator = new Orchestrator(adapter, config);
  await orchestrator.start();
  log.info('Orchestrator started');
}

export async function shutdown(): Promise<void> {
  if (orchestrator) {
    log.info('Orchestrator shutting down');
    await orchestrator.stop();
    orchestrator = null;
    log.info('Orchestrator shut down');
  } else {
    log.debug('Shutdown called but orchestrator not initialized');
  }
  eventSequence = 0;
}

export function nextSequence(): number {
  return ++eventSequence;
}

/** For testing only */
export function __setOrchestratorForTesting(orch: Orchestrator | null): void {
  orchestrator = orch;
  eventSequence = 0;
}
