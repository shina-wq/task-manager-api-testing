import { jest } from '@jest/globals';
import { PriorityTask } from '../../src/models.js';
import { logger } from '../../src/logger.js';
import { withCache } from '../../src/cache.js';
import { createRateLimiter, delay } from '../../src/rateLimiter.js';
import {
  filterByStatus,
  filterByPriority,
  searchTasks,
  calculateStatistics,
  groupByUser,
  sortTasks,
} from '../../src/taskProcessor.js';

const NOW = new Date('2026-01-15T12:00:00Z');

// Spies on an Array.prototype method only while `fn` runs, so Jest's own array calls aren't counted.
// Calls and contexts are copied before mockRestore(), which also clears them.
const spyOnArrayMethod = (method, fn) => {
  const spy = jest.spyOn(Array.prototype, method);
  const result = fn();
  const calls = spy.mock.calls.length;
  const contexts = [...spy.mock.contexts];
  spy.mockRestore();
  return { result, calls, contexts };
};

describe('array manipulation', () => {
  let tasks;

  beforeEach(() => {
    const todos = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Task ${i + 1}`, completed: i % 4 === 0, userId: (i % 5) + 1 }));
    tasks = Object.freeze(todos.map((todo) => PriorityTask.fromAPI(todo, NOW))); // frozen: any in-place mutation throws
  });

  test.each([
    ['filterByStatus', () => filterByStatus(tasks, 'completed')],
    ['searchTasks', () => searchTasks(tasks, 'task')],
    ['calculateStatistics', () => calculateStatistics(tasks)],
    ['groupByUser', () => groupByUser(tasks)],
    ['sortTasks', () => sortTasks(tasks, '-priority', 'dueDate')],
  ])('%s does not mutate the original array', (_, run) => {
    const before = tasks.map(({ id }) => id);
    expect(run).not.toThrow();
    expect(tasks.map(({ id }) => id)).toEqual(before);
  });

  test('filter: filterByStatus calls filter() once on the input array', () => {
    const { calls, contexts } = spyOnArrayMethod('filter', () => filterByStatus(tasks, 'pending'));
    expect(calls).toBe(1);
    expect(contexts[0]).toBe(tasks);
  });

  test('sort: sortTasks sorts a copy, never the input array', () => {
    const { result, calls, contexts } = spyOnArrayMethod('sort', () => sortTasks(tasks, 'title'));
    expect(calls).toBe(1);
    expect(contexts[0]).toBe(result);
    expect(contexts[0]).not.toBe(tasks);
  });

  test('reduce: calculateStatistics aggregates the input with reduce()', () => {
    const { contexts } = spyOnArrayMethod('reduce', () => calculateStatistics(tasks));
    expect(contexts).toContain(tasks);
  });

  test('map: filter → sort → map chains produce the expected values', () => {
    const titles = sortTasks(filterByPriority(tasks, 'high'), '-id').map(({ title }) => title);
    expect(titles).toEqual(['Task 20', 'Task 17', 'Task 14', 'Task 11', 'Task 8', 'Task 5', 'Task 2']);
  });
});

describe('withCache()', () => {
  let fn;
  let cached;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    fn = jest.fn().mockResolvedValue('fresh');
    cached = withCache(fn, { ttl: 1000 });
  });

  test('serves repeated requests from the cache and logs the hit', async () => {
    const debug = jest.spyOn(logger, 'debug');
    await expect(cached('/todos')).resolves.toBe('fresh');
    await cached('/todos');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('/todos');
    expect(debug).toHaveBeenCalledWith('cache hit: ["/todos"]');
  });

  test('caches each argument list separately', async () => {
    await cached('/todos');
    await cached('/users');
    expect(fn.mock.calls).toEqual([['/todos'], ['/users']]);
  });

  test('refetches once the TTL has expired, or after clear()', async () => {
    await cached('/todos');
    Date.now.mockReturnValue(1001);
    await cached('/todos');
    cached.clear();
    await cached('/todos');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('shares one in-flight promise between concurrent calls', () => {
    expect(cached('/todos')).toBe(cached('/todos'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('falls back to stale data and warns when a refetch fails', async () => {
    await cached('/todos');
    Date.now.mockReturnValue(2000);
    fn.mockRejectedValueOnce(new Error('offline'));

    await expect(cached('/todos')).resolves.toBe('fresh');
    expect(logger.warn).toHaveBeenCalledWith('offline — using cached data');
  });

  test('rejects without caching the failure when nothing is cached', async () => {
    fn.mockRejectedValueOnce(new Error('offline'));
    await expect(cached('/todos')).rejects.toThrow('offline');
    await expect(cached('/todos')).resolves.toBe('fresh');
  });
});

describe('rateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('delay() resolves only after the given time', async () => {
    const done = jest.fn();
    delay(500).then(done);

    await jest.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  test('spaces out a burst of tasks by the interval, starting immediately', async () => {
    const limit = createRateLimiter({ interval: 100 });
    const task = jest.fn().mockReturnValue('done');
    const [first] = [1, 2, 3].map(() => limit(task));

    await jest.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe('done');
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(3);
  });

  test('does not delay tasks after the limiter has been idle', async () => {
    const limit = createRateLimiter();
    const task = jest.fn();
    limit(task);
    await jest.advanceTimersByTimeAsync(500);

    limit(task);
    await jest.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('logger', () => {
  let spies;

  beforeEach(() => {
    spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    Object.values(spies).forEach((spy) => spy.mockRestore());
  });

  test.each([
    ['info', 'log', 'ℹ'],
    ['warn', 'warn', '⚠'],
    ['error', 'error', '✖'],
  ])('%s() writes only to console.%s with its icon', (level, method, icon) => {
    logger[level]('Loaded', 200);
    expect(spies[method]).toHaveBeenCalledWith(icon, 'Loaded', 200);
    expect(Object.values(spies).filter((spy) => spy.mock.calls.length)).toHaveLength(1);
  });

  test('debug() stays silent unless DEBUG is set', async () => {
    logger.debug('hidden');
    expect(spies.debug).not.toHaveBeenCalled();

    process.env.DEBUG = '1';
    jest.resetModules();
    const { logger: debugLogger } = await import('../../src/logger.js');
    debugLogger.debug('visible');
    delete process.env.DEBUG;

    expect(spies.debug).toHaveBeenCalledWith('[debug]', 'visible');
  });
});
