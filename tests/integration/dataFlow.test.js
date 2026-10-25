import { jest } from '@jest/globals';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ESM module mocking: register the mock before importing anything that depends on src/api.js
const mockApi = await import('../__mocks__/api.js');
jest.unstable_mockModule('../../src/api.js', () => mockApi);

const { APIClient } = await import('../../src/api.js');
const { TaskManager, DataUnavailableError } = await import('../../src/TaskManager.js');
const { PriorityTask, User } = await import('../../src/models.js');
const { logger } = await import('../../src/logger.js');
const { mockUsers, mockTodos } = mockApi;

const ids = (items) => items.map(({ id }) => id);

let dir;
let snapshotFile;
let api;
let manager;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'task-manager-flow-'));
  snapshotFile = join(dir, 'snapshot.json');
  api = new APIClient();
  manager = new TaskManager({ api, snapshotFile, exportDir: join(dir, 'exports') });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('module mocking', () => {
  test('TaskManager creates the mocked APIClient by default, so no network is used', async () => {
    const defaultManager = new TaskManager({ snapshotFile });
    await expect(defaultManager.load()).resolves.toEqual({ source: 'api', users: 3, tasks: 9 });
  });

  test('refuses to query data before load()', () => {
    expect(() => manager.tasks).toThrow('Data not loaded yet — call load() first');
  });
});

describe('workflow 1: API data → models', () => {
  beforeEach(() => manager.load());

  test('loads every user and task from the API', async () => {
    await expect(manager.load()).resolves.toEqual({ source: 'api', users: 3, tasks: 9 });
    expect(api.fetchAllSettled).toHaveBeenCalled();
  });

  test('turns raw todos into PriorityTasks with derived fields', () => {
    const task = manager.getTask(23);
    expect(task).toBeInstanceOf(PriorityTask);
    expect(task).toMatchObject({ title: 'Prepare release notes', priority: 'high', tags: ['learning', 'personal'] });
    expect(task.dueDate).toBeInstanceOf(Date);
  });

  test('turns raw users into Users with their nested fields flattened', () => {
    const user = manager.getUser(1);
    expect(user).toBeInstanceOf(User);
    expect(user).toMatchObject({ name: 'Leanne Graham', company: 'Romaguera-Crona', city: 'Gwenborough' });
  });

  test("attaches each user's tasks to the user", () => {
    expect(manager.users.map((user) => ids(user.tasks))).toEqual([[1, 2, 3, 23], [4, 5, 6], [7, 8]]);
  });

  test('saves the raw API data as an offline snapshot', async () => {
    expect(JSON.parse(await readFile(snapshotFile, 'utf8'))).toEqual({ users: mockUsers, todos: mockTodos });
  });
});

describe('workflow 2: models → filtered, searched and sorted results', () => {
  beforeEach(() => manager.load());

  test('filters pending tasks and sorts them by priority, then id', () => {
    expect(ids(manager.getTasks({ status: 'pending', sortBy: ['-priority', 'id'] }))).toEqual([5, 23, 1, 3, 6]);
  });

  test('filters by derived status', () => {
    expect(ids(manager.getTasks({ status: 'overdue' }))).toEqual([1, 5]);
    expect(ids(manager.getTasks({ status: 'urgent' }))).toEqual([23]);
  });

  test('combines user, priority and search filters', () => {
    expect(ids(manager.getTasks({ userId: 1, priority: 'high' }))).toEqual([2, 23]);
    expect(ids(manager.getTasks({ userId: 1, query: 'report' }))).toEqual([1]);
  });

  test('groups tasks by user and collects unique tags', () => {
    expect([...manager.groupByUser().keys()]).toEqual([1, 2, 3]);
    expect(manager.getTags()).toBeInstanceOf(Set);
  });

  test('rejects invalid query criteria', () => {
    expect(() => manager.getTasks({ status: 'archived' })).toThrow('Unknown status "archived"');
    expect(() => manager.getTasks({ priority: 'critical' })).toThrow('Unknown priority "critical"');
    expect(() => manager.getTasks({ userId: 99 })).toThrow('User #99 not found');
  });
});

describe('workflow 3: models → report and export', () => {
  beforeEach(() => manager.load());

  test('generates overall statistics from the API data', () => {
    expect(manager.getReport().overall).toMatchObject({
      total: 9,
      completed: 4,
      overdue: 2,
      completionRate: 44,
      byStatus: { overdue: 2, completed: 4, pending: 2, urgent: 1 },
      byPriority: { high: 4, medium: 3, low: 2 },
    });
  });

  test('ranks users by completion rate', () => {
    const ranking = manager.getReport().users.map(({ id, completionRate }) => [id, completionRate]);
    expect(ranking).toEqual([[3, 100], [2, 33], [1, 25]]);
  });

  test('reflects a toggled task in the next report', () => {
    manager.toggleTask(1);
    const { overall, users } = manager.getReport();
    expect(overall).toMatchObject({ completed: 5, overdue: 1 });
    expect(ids(users)).toEqual([3, 1, 2]);
  });

  test('exports the report and users as JSON', async () => {
    const filePath = await manager.exportJSON('report.json');
    const exported = JSON.parse(await readFile(filePath, 'utf8'));

    expect(filePath).toBe(join(dir, 'exports', 'report.json'));
    expect(exported.report.overall.total).toBe(9);
    expect(exported.users).toHaveLength(3);
  });

  test('keeps exports inside the export directory', async () => {
    expect(await manager.exportJSON('../../escape.json')).toBe(join(dir, 'exports', 'escape.json'));
  });

  test('wraps file system failures in a descriptive error', async () => {
    const blocked = new TaskManager({ api, snapshotFile, exportDir: snapshotFile }); // a file, not a directory
    await blocked.load();
    await expect(blocked.exportJSON('report.json')).rejects.toThrow(/^Export to .*report\.json failed/);
  });
});

describe('workflow 4: degraded API → graceful fallbacks', () => {
  test('continues with partial data when one endpoint fails', async () => {
    api.fetchUsers.mockRejectedValueOnce(new Error('Users unavailable'));

    await expect(manager.load()).resolves.toEqual({ source: 'partial', users: 0, tasks: 9 });
    expect(logger.warn).toHaveBeenCalledWith('Users unavailable — continuing with partial data');
    expect(logger.warn).toHaveBeenCalledWith('9 task(s) belong to unknown users');
  });

  test('does not overwrite the snapshot with partial data', async () => {
    api.fetchTodos.mockRejectedValueOnce(new Error('Todos unavailable'));
    await manager.load();
    await expect(access(snapshotFile)).rejects.toThrow();
  });

  test('falls back to the saved snapshot when the API is unreachable', async () => {
    await manager.load();
    const offlineApi = new APIClient();
    offlineApi.fetchAllSettled.mockRejectedValue(new Error('Network down'));

    const offline = new TaskManager({ api: offlineApi, snapshotFile });
    await expect(offline.load()).resolves.toEqual({ source: 'snapshot', users: 3, tasks: 9 });
    expect(logger.warn).toHaveBeenCalledWith('Using offline snapshot — data may be out of date');
  });

  test.each([
    ['missing', null],
    ['corrupt', '{"users": "not a list"}'],
    ['not JSON', 'oops'],
  ])('throws DataUnavailableError when the snapshot is %s', async (_, contents) => {
    if (contents) await writeFile(snapshotFile, contents);
    api.fetchAllSettled.mockRejectedValue(new Error('Network down'));

    await expect(manager.load()).rejects.toThrow(DataUnavailableError);
  });

  test('skips malformed records and keeps the valid ones', async () => {
    api.fetchTodos.mockResolvedValueOnce([...mockTodos, { id: 'bad', title: null }]);

    await expect(manager.load()).resolves.toMatchObject({ tasks: 9 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped record — Malformed task'));
  });

  test('warns when the API returns no tasks', async () => {
    api.fetchTodos.mockResolvedValueOnce([]);

    await expect(manager.load()).resolves.toMatchObject({ users: 3, tasks: 0 });
    expect(logger.warn).toHaveBeenCalledWith('No tasks were returned');
  });

  test('warns but still loads when the snapshot cannot be saved', async () => {
    const unsaved = new TaskManager({ api, snapshotFile: join(snapshotFile, 'nested.json') });
    await writeFile(snapshotFile, ''); // a file where a directory is expected

    await expect(unsaved.load()).resolves.toMatchObject({ source: 'api' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not save offline snapshot'));
  });
});
