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
const makeTasks = (count) => Array.from({ length: count }, (_, i) =>
  PriorityTask.fromAPI({ id: i + 1, title: `Task ${i + 1}`, completed: i % 4 === 0, userId: (i % 10) + 1 }, NOW));

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
    tasks = Object.freeze(makeTasks(20)); // frozen: any in-place mutation throws in strict mode
  });

  describe('immutability', () => {
    test.each([
      ['filterByStatus', () => filterByStatus(tasks, 'completed')],
      ['filterByPriority', () => filterByPriority(tasks, 'high')],
      ['searchTasks', () => searchTasks(tasks, 'task')],
      ['calculateStatistics', () => calculateStatistics(tasks)],
      ['groupByUser', () => groupByUser(tasks)],
      ['sortTasks', () => sortTasks(tasks, '-priority', 'dueDate')],
    ])('%s works on a frozen array without mutating it', (_, run) => {
      const before = tasks.map(({ id }) => id);
      expect(run).not.toThrow();
      expect(tasks.map(({ id }) => id)).toEqual(before);
    });

    test('filtered results contain the same task references, not copies', () => {
      const [first] = filterByStatus(tasks, 'completed');
      expect(tasks).toContain(first);
    });
  });

  describe('array method usage', () => {
    test('filterByStatus calls filter() once on the input array', () => {
      const { calls, contexts } = spyOnArrayMethod('filter', () => filterByStatus(tasks, 'pending'));
      expect(calls).toBe(1);
      expect(contexts[0]).toBe(tasks);
    });

    test('sortTasks sorts a copy, never the input array', () => {
      const { result, calls, contexts } = spyOnArrayMethod('sort', () => sortTasks(tasks, 'title'));
      expect(calls).toBe(1);
      expect(contexts[0]).toBe(result);
      expect(contexts[0]).not.toBe(tasks);
    });

    test('calculateStatistics aggregates the input with reduce()', () => {
      const { contexts } = spyOnArrayMethod('reduce', () => calculateStatistics(tasks));
      expect(contexts).toContain(tasks);
    });

    test('groupByUser builds its Map with a single reduce() pass', () => {
      const { calls } = spyOnArrayMethod('reduce', () => groupByUser(tasks));
      expect(calls).toBe(1);
    });
  });

  describe('chained operations', () => {
    test('filter → sort → map produces the expected values', () => {
      const titles = sortTasks(filterByPriority(tasks, 'high'), '-id').map(({ title }) => title);
      expect(titles).toEqual(['Task 20', 'Task 17', 'Task 14', 'Task 11', 'Task 8', 'Task 5', 'Task 2']);
    });

    test('statistics of a filtered subset match the subset size', () => {
      const pending = filterByStatus(tasks, 'pending');
      expect(calculateStatistics(pending)).toMatchObject({ total: pending.length, completed: 0, completionRate: 0 });
    });
  });

  // Optional per the brief: generous limits so the tests stay deterministic on slow machines
  describe('large datasets', () => {
    const LARGE = 10_000;
    let large;

    beforeAll(() => {
      large = makeTasks(LARGE);
    });

    const timed = (fn) => {
      const start = performance.now();
      const result = fn();
      return { result, ms: performance.now() - start };
    };

    test('calculates statistics for 10,000 tasks correctly and quickly', () => {
      const { result, ms } = timed(() => calculateStatistics(large));
      expect(result).toMatchObject({ total: LARGE, completed: LARGE / 4 });
      expect(ms).toBeLessThan(500);
    });

    test('sorts 10,000 tasks by multiple criteria in order', () => {
      const { result, ms } = timed(() => sortTasks(large, '-priority', 'id'));
      const ranks = result.map(({ priority }) => ['low', 'medium', 'high'].indexOf(priority));
      expect(ranks.every((rank, i) => i === 0 || rank <= ranks[i - 1])).toBe(true);
      expect(ms).toBeLessThan(500);
    });

    test('searches 10,000 tasks quickly', () => {
      const { result, ms } = timed(() => searchTasks(large, 'task 999'));
      // Terms match as substrings: 999, 1999…8999 and 9990…9999
      expect(result).toHaveLength(19);
      expect(result.every(({ title }) => title.includes('999'))).toBe(true);
      expect(ms).toBeLessThan(500);
    });

    test('groups 10,000 tasks into one bucket per user', () => {
      const groups = groupByUser(large);
      expect(groups.size).toBe(10);
      expect([...groups.values()].every((group) => group.length === LARGE / 10)).toBe(true);
    });
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

  test('calls the wrapped function on the first request', async () => {
    await expect(cached('/todos')).resolves.toBe('fresh');
    expect(fn).toHaveBeenCalledWith('/todos');
  });

  test('serves repeated requests from the cache within the TTL', async () => {
    await cached('/todos');
    await cached('/todos');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('caches each argument list separately', async () => {
    await cached('/todos');
    await cached('/users');
    expect(fn.mock.calls).toEqual([['/todos'], ['/users']]);
  });

  test('refetches once the TTL has expired', async () => {
    await cached('/todos');
    Date.now.mockReturnValue(1001);
    await cached('/todos');
    expect(fn).toHaveBeenCalledTimes(2);
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

  test('rejects when the call fails and nothing is cached', async () => {
    fn.mockRejectedValueOnce(new Error('offline'));
    await expect(cached('/todos')).rejects.toThrow('offline');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('retries after a failed request instead of caching the failure', async () => {
    fn.mockRejectedValueOnce(new Error('offline'));
    await cached('/todos').catch(() => {});
    await expect(cached('/todos')).resolves.toBe('fresh');
  });

  test('clear() empties the cache', async () => {
    await cached('/todos');
    cached.clear();
    await cached('/todos');
    expect(fn).toHaveBeenCalledTimes(2);
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

  test('runs the first task immediately', async () => {
    const task = jest.fn();
    createRateLimiter({ interval: 100 })(task);
    await jest.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('spaces out a burst of tasks by the interval', async () => {
    const limit = createRateLimiter({ interval: 100 });
    const task = jest.fn();
    [1, 2, 3].forEach(() => limit(task));

    await jest.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(3);
  });

  test("resolves with the task's result", async () => {
    const result = createRateLimiter()(() => 'done');
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe('done');
  });

  test('does not delay tasks after the limiter has been idle', async () => {
    const limit = createRateLimiter({ interval: 100 });
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
    spies = Object.fromEntries(['log', 'warn', 'error', 'debug']
      .map((method) => [method, jest.spyOn(console, method).mockImplementation(() => {})]));
  });

  afterEach(() => {
    Object.values(spies).forEach((spy) => spy.mockRestore());
  });

  test('info() writes to console.log with an info icon', () => {
    logger.info('Loaded', 200, 'tasks');
    expect(spies.log).toHaveBeenCalledWith('ℹ', 'Loaded', 200, 'tasks');
  });

  test('warn() writes to console.warn', () => {
    logger.warn('Partial data');
    expect(spies.warn).toHaveBeenCalledWith('⚠', 'Partial data');
  });

  test('error() writes to console.error', () => {
    logger.error('Failed');
    expect(spies.error).toHaveBeenCalledWith('✖', 'Failed');
  });

  test('debug() stays silent when DEBUG is not set', () => {
    logger.debug('hidden');
    expect(spies.debug).not.toHaveBeenCalled();
  });

  test('each level writes only to its own console method', () => {
    logger.warn('only warn');
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  test('debug() writes to console.debug when DEBUG is set', async () => {
    const original = process.env.DEBUG;
    process.env.DEBUG = '1';
    jest.resetModules();

    const { logger: debugLogger } = await import('../../src/logger.js');
    debugLogger.debug('visible');
    expect(spies.debug).toHaveBeenCalledWith('[debug]', 'visible');

    if (original === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = original;
  });
});
