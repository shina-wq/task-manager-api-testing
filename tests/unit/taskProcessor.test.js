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

  test('returns all incomplete tasks for pending, and only late ones for overdue', () => {
    expect(ids(filterByStatus(tasks, 'pending'))).toEqual([2, 3]);
    expect(ids(filterByStatus(tasks, 'overdue'))).toEqual([3]);
  });

  test('returns an empty array for an empty input', () => {
    expect(filterByStatus([], 'completed')).toEqual([]);
  });

  test('returns an empty array for an unknown or missing status', () => {
    expect(filterByStatus(tasks, 'archived')).toEqual([]);
    expect(filterByStatus(tasks, undefined)).toEqual([]);
  });

  test('throws a TypeError for null tasks or plain objects', () => {
    expect(() => filterByStatus(null, 'completed')).toThrow(TypeError);
    expect(() => filterByStatus([{ id: 1, completed: false }], 'pending')).toThrow(TypeError);
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

  test('returns zeroed statistics for an empty or missing array without dividing by zero', () => {
    expect(calculateStatistics([])).toEqual({
      total: 0, completed: 0, open: 0, overdue: 0, completionRate: 0, byStatus: {}, byPriority: {}, byTag: {},
    });
    expect(calculateStatistics()).toMatchObject({ total: 0 });
  });

  test('throws a TypeError for null', () => {
    expect(() => calculateStatistics(null)).toThrow(TypeError);
  });

  test('handles plain Tasks without priority or tags, rounding the rate', () => {
    const plain = [1, 2, 3].map((id) => new Task({ id, title: `T${id}`, completed: id === 1, userId: 3 }));
    expect(calculateStatistics(plain)).toMatchObject({ completionRate: 33, byPriority: {}, byTag: {} });
  });
});

describe('groupByUser()', () => {
  test('returns a Map keyed by user id', () => {
    const groups = groupByUser(tasks);
    expect(groups).toBeInstanceOf(Map);
    expect([...groups.keys()]).toEqual([1, 2]);
  });

  test("keeps each user's tasks in their original order", () => {
    expect(ids(groupByUser(tasks).get(2))).toEqual([3, 4]);
  });

  test('returns an empty Map for an empty array', () => {
    expect(groupByUser([]).size).toBe(0);
  });

  test('returns undefined for a user with no tasks', () => {
    expect(groupByUser(tasks).get(99)).toBeUndefined();
  });

  test('throws a TypeError for null or undefined', () => {
    expect(() => groupByUser(null)).toThrow(TypeError);
    expect(() => groupByUser(undefined)).toThrow(TypeError);
  });
});

// The brief's searchByProperty(): searches title and tags
describe('searchTasks()', () => {
  test('finds tasks by title, ignoring case', () => {
    expect(ids(searchTasks(tasks, 'WRITE'))).toEqual([2]);
  });

  test('matches tags as well as titles', () => {
    expect(ids(searchTasks(tasks, 'home'))).toEqual([1, 3]);
    expect(searchTasks([new Task({ id: 5, title: 'Read book', userId: 3 })], 'book')).toHaveLength(1); // no tags
  });

  test('requires every search term to match', () => {
    expect(ids(searchTasks(tasks, 'home bills'))).toEqual([3]);
  });

  test('returns all tasks for an empty or missing query', () => {
    expect(searchTasks(tasks, '   ')).toHaveLength(4);
    expect(searchTasks(tasks)).toHaveLength(4);
  });

  test('returns an empty array when nothing matches or there are no tasks', () => {
    expect(searchTasks(tasks, 'holiday')).toEqual([]);
    expect(searchTasks([], 'bills')).toEqual([]);
  });

  test('throws a TypeError for null tasks or a non-string query', () => {
    expect(() => searchTasks(null, 'bills')).toThrow(TypeError);
    expect(() => searchTasks(tasks, 42)).toThrow(TypeError);
  });
});

// The brief's sortBy(): a leading '-' sorts descending
describe('sortTasks()', () => {
  test('sorts ascending by a single key', () => {
    expect(ids(sortTasks(tasks, 'title'))).toEqual([1, 4, 3, 2]);
  });

  test("sorts descending with a '-' prefix", () => {
    expect(ids(sortTasks(tasks, '-id'))).toEqual([4, 3, 2, 1]);
  });

  test('orders priorities from low to high and puts missing due dates last', () => {
    expect(ids(sortTasks(tasks, 'priority'))).toEqual([1, 3, 4, 2]);
    expect(ids(sortTasks(tasks, 'dueDate'))).toEqual([3, 1, 2, 4]);
  });

  test('uses later criteria to break ties', () => {
    expect(ids(sortTasks(tasks, 'status', '-id'))).toEqual([3, 2, 4, 1]);
    expect(ids(sortTasks(tasks, '-userId', 'id'))).toEqual([3, 4, 1, 2]);
  });

  test('breaks ties between missing due dates with the next criterion', () => {
    const noDue = [5, 4].map((id) => new PriorityTask({ id, title: `No due ${id}`, userId: 1 }));
    expect(ids(sortTasks(noDue, 'dueDate', 'id'))).toEqual([4, 5]);
  });

  test('returns a copy in the original order for no criteria or an empty array', () => {
    expect(sortTasks(tasks)).not.toBe(tasks);
    expect(ids(sortTasks(tasks))).toEqual([1, 2, 3, 4]);
    expect(sortTasks([], 'id')).toEqual([]);
  });

  test('throws a RangeError listing the valid keys for an unknown key', () => {
    expect(() => sortTasks(tasks, '-color')).toThrow(`Unknown sort key "color". Use one of: ${SORT_KEYS.join(', ')}`);
  });

  test('throws a TypeError for null tasks', () => {
    expect(() => sortTasks(null, 'id')).toThrow(TypeError);
  });
});

describe('other processing functions', () => {
  test('filterByUser() uses strict id equality', () => {
    expect(ids(filterByUser(tasks, 2))).toEqual([3, 4]);
    expect(filterByUser(tasks, '2')).toEqual([]);
  });

  test('filterByPriority() accepts several priorities', () => {
    expect(ids(filterByPriority(tasks, 'low', 'high'))).toEqual([1, 2]);
  });

  test('getUniqueTags() returns a Set without duplicates', () => {
    expect(getUniqueTags(tasks)).toEqual(new Set(['home', 'personal', 'work', 'finance', 'health']));
    expect(getUniqueTags([new Task({ id: 5, title: 'Plain', userId: 3 })]).size).toBe(0);
  });

  test('toModels() maps valid records and skips malformed ones with a warning', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const records = [{ id: 1, title: 'A', completed: false, userId: 1 }, { id: 'bad' }];

    expect(toModels(records, Task.fromAPI)).toEqual([new Task(records[0])]);
    expect(toModels(undefined, Task.fromAPI)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped record — Malformed task'));
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
      expect(report).toMatchObject({ generatedAt: NOW.toISOString(), overall: { total: 4 } });
      expect(report.uniqueTags).toEqual(['finance', 'health', 'home', 'personal', 'work']);
      expect(generateReport()).toMatchObject({ uniqueTags: [], users: [] });
    });

    test('ranks users by completion rate, highest first', () => {
      const users = [{ id: 1, name: 'Ada', tasks: [tasks[1]] }, { id: 2, name: 'Grace', tasks: [tasks[0]] }];
      expect(generateReport(users, tasks).users).toEqual([
        { id: 2, name: 'Grace', total: 1, completed: 1, overdue: 0, completionRate: 100 },
        { id: 1, name: 'Ada', total: 1, completed: 0, overdue: 0, completionRate: 0 },
      ]);
    });
  });
});
