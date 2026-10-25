import { jest } from '@jest/globals';
import { PriorityTask, Task } from '../../src/models.js';
import { logger } from '../../src/logger.js';
import {
  toModels,
  filterByStatus,
  filterByUser,
  filterByPriority,
  searchTasks,
  calculateStatistics,
  groupByUser,
  getUniqueTags,
  sortTasks,
  SORT_KEYS,
  generateReport,
} from '../../src/taskProcessor.js';

// Due dates far in the past/future keep statuses deterministic regardless of today's date
const makeTasks = () => [
  new PriorityTask({ id: 1, title: 'Buy groceries', completed: true, userId: 1, priority: 'low', dueDate: '2100-01-01', tags: ['home', 'personal'] }),
  new PriorityTask({ id: 2, title: 'Write report', completed: false, userId: 1, priority: 'high', dueDate: '2100-06-01', tags: ['work'] }),
  new PriorityTask({ id: 3, title: 'Pay bills', completed: false, userId: 2, priority: 'medium', dueDate: '2000-01-01', tags: ['finance', 'home'] }),
  new PriorityTask({ id: 4, title: 'Morning run', completed: true, userId: 2, priority: 'medium', tags: ['health'] }),
];

const ids = (tasks) => tasks.map(({ id }) => id);

let tasks;

beforeEach(() => {
  tasks = makeTasks();
});

describe('filterByStatus()', () => {
  test('returns completed tasks', () => {
    expect(ids(filterByStatus(tasks, 'completed'))).toEqual([1, 4]);
  });

  test('returns all incomplete tasks for pending', () => {
    expect(ids(filterByStatus(tasks, 'pending'))).toEqual([2, 3]);
  });

  test('returns overdue tasks', () => {
    expect(ids(filterByStatus(tasks, 'overdue'))).toEqual([3]);
  });

  test('returns an empty array for an empty input', () => {
    expect(filterByStatus([], 'completed')).toEqual([]);
  });

  test.each(['archived', undefined, null])('returns an empty array for unknown status %p', (status) => {
    expect(filterByStatus(tasks, status)).toEqual([]);
  });

  test.each([null, undefined])('throws a TypeError when tasks is %p', (input) => {
    expect(() => filterByStatus(input, 'completed')).toThrow(TypeError);
  });

  test('does not mutate the original array', () => {
    const result = filterByStatus(tasks, 'completed');
    expect(result).not.toBe(tasks);
    expect(tasks).toHaveLength(4);
  });
});

describe('filterByUser()', () => {
  test("returns only the given user's tasks", () => {
    expect(ids(filterByUser(tasks, 2))).toEqual([3, 4]);
  });

  test('returns an empty array for an unknown user', () => {
    expect(filterByUser(tasks, 99)).toEqual([]);
  });

  test('uses strict equality for user ids', () => {
    expect(filterByUser(tasks, '1')).toEqual([]);
  });
});

describe('filterByPriority()', () => {
  test('returns tasks with the given priority', () => {
    expect(ids(filterByPriority(tasks, 'medium'))).toEqual([3, 4]);
  });

  test('accepts several priorities', () => {
    expect(ids(filterByPriority(tasks, 'low', 'high'))).toEqual([1, 2]);
  });

  test('returns an empty array when no priority is given', () => {
    expect(filterByPriority(tasks)).toEqual([]);
  });
});

describe('calculateStatistics()', () => {
  test('counts totals, completion and overdue tasks', () => {
    expect(calculateStatistics(tasks)).toMatchObject({ total: 4, completed: 2, open: 2, overdue: 1, completionRate: 50 });
  });

  test('groups counts by status, priority and tag', () => {
    const { byStatus, byPriority, byTag } = calculateStatistics(tasks);
    expect(byStatus).toEqual({ completed: 2, pending: 1, overdue: 1 });
    expect(byPriority).toEqual({ low: 1, high: 1, medium: 2 });
    expect(byTag).toEqual({ home: 2, personal: 1, work: 1, finance: 1, health: 1 });
  });

  test('returns zeroed statistics for an empty array without dividing by zero', () => {
    expect(calculateStatistics([])).toEqual({
      total: 0, completed: 0, open: 0, overdue: 0, completionRate: 0, byStatus: {}, byPriority: {}, byTag: {},
    });
  });

  test('defaults to an empty array when called without arguments', () => {
    expect(calculateStatistics()).toMatchObject({ total: 0, completionRate: 0 });
  });

  test('throws a TypeError for null', () => {
    expect(() => calculateStatistics(null)).toThrow(TypeError);
  });

  test('handles plain Tasks without priority or tags', () => {
    const plain = [new Task({ id: 5, title: 'Plain', completed: true, userId: 3 })];
    expect(calculateStatistics(plain)).toMatchObject({ total: 1, completionRate: 100, byPriority: {}, byTag: {} });
  });

  test('rounds the completion rate', () => {
    expect(calculateStatistics(tasks.slice(0, 3)).completionRate).toBe(33);
  });
});

describe('groupByUser()', () => {
  test('returns a Map keyed by user id', () => {
    const groups = groupByUser(tasks);
    expect(groups).toBeInstanceOf(Map);
    expect([...groups.keys()]).toEqual([1, 2]);
  });

  test("keeps each user's tasks in their original order", () => {
    const groups = groupByUser(tasks);
    expect(ids(groups.get(1))).toEqual([1, 2]);
    expect(ids(groups.get(2))).toEqual([3, 4]);
  });

  test('returns an empty Map for an empty array', () => {
    expect(groupByUser([]).size).toBe(0);
  });

  test('returns undefined for a user with no tasks', () => {
    expect(groupByUser(tasks).get(99)).toBeUndefined();
  });

  test.each([null, undefined])('throws a TypeError when tasks is %p', (input) => {
    expect(() => groupByUser(input)).toThrow(TypeError);
  });

  test('does not mutate the original array', () => {
    groupByUser(tasks);
    expect(ids(tasks)).toEqual([1, 2, 3, 4]);
  });
});

describe('searchTasks()', () => {
  test('finds tasks by title', () => {
    expect(ids(searchTasks(tasks, 'bills'))).toEqual([3]);
  });

  test('is case-insensitive', () => {
    expect(ids(searchTasks(tasks, 'WRITE'))).toEqual([2]);
  });

  test('matches tags as well as titles', () => {
    expect(ids(searchTasks(tasks, 'home'))).toEqual([1, 3]);
  });

  test('requires every search term to match', () => {
    expect(ids(searchTasks(tasks, 'home bills'))).toEqual([3]);
  });

  test.each(['', '   ', undefined])('returns all tasks for empty query %p', (query) => {
    expect(searchTasks(tasks, query)).toHaveLength(4);
  });

  test('returns an empty array when nothing matches', () => {
    expect(searchTasks(tasks, 'holiday')).toEqual([]);
  });

  test('searches plain Tasks that have no tags', () => {
    const plain = [new Task({ id: 5, title: 'Read book', userId: 3 })];
    expect(searchTasks(plain, 'book')).toHaveLength(1);
  });

  test('throws a TypeError for a null query', () => {
    expect(() => searchTasks(tasks, null)).toThrow(TypeError);
  });

  test('throws a TypeError for null tasks', () => {
    expect(() => searchTasks(null, 'bills')).toThrow(TypeError);
  });
});

describe('sortTasks()', () => {
  test('sorts ascending by a single key', () => {
    expect(ids(sortTasks(tasks, 'title'))).toEqual([1, 4, 3, 2]);
  });

  test("sorts descending with a '-' prefix", () => {
    expect(ids(sortTasks(tasks, '-id'))).toEqual([4, 3, 2, 1]);
  });

  test('orders priorities from low to high', () => {
    expect(ids(sortTasks(tasks, 'priority'))).toEqual([1, 3, 4, 2]);
  });

  test('puts tasks without a due date last', () => {
    expect(ids(sortTasks(tasks, 'dueDate'))).toEqual([3, 1, 2, 4]);
  });

  test('uses later criteria to break ties', () => {
    expect(ids(sortTasks(tasks, 'status', '-id'))).toEqual([3, 2, 4, 1]);
  });

  test('breaks ties between missing due dates with the next criterion', () => {
    const noDue = [5, 4].map((id) => new PriorityTask({ id, title: `No due ${id}`, userId: 1 }));
    expect(ids(sortTasks(noDue, 'dueDate', 'id'))).toEqual([4, 5]);
  });

  test('supports every advertised sort key', () => {
    SORT_KEYS.forEach((key) => expect(() => sortTasks(tasks, key)).not.toThrow());
  });

  test('returns a copy in the original order when no criteria are given', () => {
    const result = sortTasks(tasks);
    expect(result).not.toBe(tasks);
    expect(ids(result)).toEqual([1, 2, 3, 4]);
  });

  test('does not mutate the original array', () => {
    sortTasks(tasks, '-id');
    expect(ids(tasks)).toEqual([1, 2, 3, 4]);
  });

  test('returns an empty array for an empty input', () => {
    expect(sortTasks([], 'id')).toEqual([]);
  });

  test('throws a RangeError for an unknown sort key', () => {
    expect(() => sortTasks(tasks, '-color')).toThrow('Unknown sort key "color"');
  });

  test('throws a TypeError for null tasks', () => {
    expect(() => sortTasks(null, 'id')).toThrow(TypeError);
  });
});

describe('getUniqueTags()', () => {
  test('returns a Set of unique tags', () => {
    expect(getUniqueTags(tasks)).toEqual(new Set(['home', 'personal', 'work', 'finance', 'health']));
  });

  test('returns an empty Set for tasks without tags', () => {
    expect(getUniqueTags([new Task({ id: 5, title: 'Plain', userId: 3 })]).size).toBe(0);
  });
});

describe('toModels()', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  test('maps valid records through the factory', () => {
    const records = [{ id: 1, title: 'A', completed: false, userId: 1 }];
    expect(toModels(records, Task.fromAPI)).toEqual([new Task(records[0])]);
  });

  test('skips malformed records and logs a warning', () => {
    const records = [{ id: 1, title: 'A', completed: false, userId: 1 }, { id: 'bad' }];
    expect(toModels(records, Task.fromAPI)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped record — Malformed task'));
  });

  test('defaults to an empty array when records are undefined', () => {
    expect(toModels(undefined, Task.fromAPI)).toEqual([]);
  });
});

describe('generateReport()', () => {
  const NOW = new Date('2026-01-15T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('includes a timestamp, overall statistics and sorted unique tags', () => {
    const report = generateReport([], tasks);
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.overall.total).toBe(4);
    expect(report.uniqueTags).toEqual(['finance', 'health', 'home', 'personal', 'work']);
  });

  test('ranks users by completion rate, highest first', () => {
    const users = [
      { id: 1, name: 'Ada', tasks: [tasks[1]] },
      { id: 2, name: 'Grace', tasks: [tasks[0]] },
    ];
    expect(generateReport(users, tasks).users).toEqual([
      { id: 2, name: 'Grace', total: 1, completed: 1, overdue: 0, completionRate: 100 },
      { id: 1, name: 'Ada', total: 1, completed: 0, overdue: 0, completionRate: 0 },
    ]);
  });

  test('returns an empty report when called without arguments', () => {
    expect(generateReport()).toMatchObject({ overall: { total: 0 }, uniqueTags: [], users: [] });
  });
});
