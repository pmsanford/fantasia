import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import logger, { setLogLevel, getLogLevel, type LogLevel } from '../src/logger.js';

describe('logger', () => {
  let originalLevel: LogLevel;
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    originalLevel = getLogLevel();
    spy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setLogLevel(originalLevel);
    spy.mockRestore();
  });

  it('should respect log level filtering', () => {
    setLogLevel('warn');
    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should appear');
    logger.error('should appear');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should emit all levels at trace', () => {
    setLogLevel('trace');
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('should emit nothing above fatal', () => {
    setLogLevel('fatal');
    logger.trace('no');
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('no');
    expect(spy).toHaveBeenCalledTimes(0);
    logger.fatal('yes');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should output valid JSON with expected fields', () => {
    setLogLevel('info');
    logger.info('test message', { key: 'value' });
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ts).toBeString();
    expect(parsed.level).toBe('info');
    expect(parsed.name).toBe('server');
    expect(parsed.msg).toBe('test message');
    expect(parsed.key).toBe('value');
  });

  it('should include ISO timestamp', () => {
    setLogLevel('info');
    logger.info('ts test');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    // Verify it's a valid ISO date
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it('should create child loggers with dotted names', () => {
    setLogLevel('info');
    const child = logger.child('orchestrator');
    child.info('child message');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('server.orchestrator');
  });

  it('should support nested child loggers', () => {
    setLogLevel('info');
    const child = logger.child('service').child('rpc');
    child.info('nested');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('server.service.rpc');
  });

  it('should round-trip setLogLevel/getLogLevel', () => {
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
    setLogLevel('error');
    expect(getLogLevel()).toBe('error');
    setLogLevel('trace');
    expect(getLogLevel()).toBe('trace');
  });

  it('should work without context parameter', () => {
    setLogLevel('info');
    logger.info('no context');
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.msg).toBe('no context');
    // Should only have ts, level, name, msg
    expect(Object.keys(parsed)).toEqual(['ts', 'level', 'name', 'msg']);
  });

  it('should spread multiple context keys', () => {
    setLogLevel('info');
    logger.info('multi', { a: 1, b: 'two', c: true });
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe('two');
    expect(parsed.c).toBe(true);
  });
});
