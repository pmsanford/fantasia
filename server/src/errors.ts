import { ConnectError, Code } from '@connectrpc/connect';
import {
  FantasiaError,
  AgentError,
  TaskError,
  OrchestratorError,
  BudgetExceededError,
  MaxRetriesError,
} from '@fantasia/core';
import logger from './logger.js';

const log = logger.child('errors');

export function toConnectError(err: unknown): ConnectError {
  if (err instanceof ConnectError) {
    return err;
  }

  if (!(err instanceof Error)) {
    log.error('Non-Error thrown', { value: String(err) });
    return new ConnectError(String(err), Code.Internal);
  }

  let code: Code;
  if (err instanceof BudgetExceededError) {
    code = Code.ResourceExhausted;
  } else if (err instanceof MaxRetriesError) {
    code = Code.ResourceExhausted;
  } else if (err instanceof OrchestratorError) {
    code = err.message.includes('already') ? Code.AlreadyExists : Code.FailedPrecondition;
  } else if (err instanceof TaskError) {
    code = Code.NotFound;
  } else if (err instanceof AgentError) {
    code = Code.Internal;
  } else if (err instanceof FantasiaError) {
    code = Code.Internal;
  } else {
    code = Code.Internal;
  }

  log.error('Mapping error to ConnectError', {
    type: err.constructor.name,
    code,
    message: err.message,
  });

  return new ConnectError(err.message, code);
}

export async function withErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toConnectError(err);
  }
}
