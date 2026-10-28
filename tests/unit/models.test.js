import { jest } from '@jest/globals';
import { Task, PriorityTask, User } from '../../src/models.js';

// Fixed clock keeps every date comparison deterministic
const NOW = new Date('2026-01-15T12:00:00Z');

describe('Task', () => {
  let task;

  beforeEach(() => {
    task = new Task({ id: 1, title: 'Write tests', completed: false, userId: 10 });
  });

  describe('constructor', () => {
    test('initializes all properties, defaulting completed to false', () => {
      expect(task).toEqual({ id: 1, title: 'Write tests', completed: false, userId: 10 });
      expect(new Task({ id: 2, title: 'Default', userId: 10 }).completed).toBe(false);
    });

    test('keeps null and undefined properties as given', () => {
      expect(new Task({ id: null, title: undefined, userId: null })).toEqual({ id: null, title: undefined, completed: false, userId: null });
    });
  });

  describe('methods', () => {
    test('toggle() flips completion and returns the task for chaining', () => {
      expect(task.toggle()).toBe(task);
      expect(task.completed).toBe(true);
      expect(task.toggle().completed).toBe(false);
    });

    test("getStatus() returns 'pending' or 'completed'", () => {
      expect(task.getStatus()).toBe('pending');
      expect(task.toggle().getStatus()).toBe('completed');
    });

    test('isOverdue() is always false because base tasks have no due date', () => {
      const withPastDate = new Task({ id: 3, title: 'Old', userId: 10, dueDate: '2000-01-01' });
      expect(task.isOverdue()).toBe(false);
      expect(task.toggle().isOverdue()).toBe(false);
      expect(withPastDate.isOverdue(NOW)).toBe(false);
    });

    test('hasStatus() matches the current status only', () => {
      expect(task.hasStatus('pending')).toBe(true);
      expect(task.hasStatus('completed')).toBe(false);
    });

    test('toString() and toJSON() describe the task', () => {
      expect(`${task}`).toBe('[ ] #1 Write tests');
      expect(task.toJSON()).toEqual({ id: 1, title: 'Write tests', completed: false, userId: 10, status: 'pending' });
      expect(`${task.toggle()}`).toBe('[✔] #1 Write tests');
    });
  });

  describe('fromAPI()', () => {
    const raw = { id: 5, title: '  Buy milk  ', completed: true, userId: 2 };

    test('creates a Task, trimming the title and dropping unknown fields', () => {
      const created = Task.fromAPI({ ...raw, extra: 'ignored' });
      expect(created).toBeInstanceOf(Task);
      expect(created).toEqual({ id: 5, title: 'Buy milk', completed: true, userId: 2 });
    });

    test('accepts an empty title', () => {
      expect(Task.fromAPI({ ...raw, title: '   ' }).title).toBe('');
    });

    test.each([
      ['null', null],
      ['a non-integer id', { ...raw, id: 1.5 }],
      ['a non-string title', { ...raw, title: 42 }],
      ['a non-boolean completed', { ...raw, completed: 'yes' }],
    ])('throws a TypeError for %s', (_, input) => {
      expect(() => Task.fromAPI(input)).toThrow(TypeError);
    });

    test('includes the raw data in the error message', () => {
      expect(() => Task.fromAPI({ id: 'x' })).toThrow('Malformed task: {"id":"x"}');
    });
  });
});

describe('PriorityTask', () => {
  let task;

  beforeEach(() => {
    task = new PriorityTask({ id: 2, title: 'Ship release', userId: 10, priority: 'high', dueDate: '2026-01-20', tags: ['work'] });
  });

  describe('inheritance', () => {
    test('is a Task with the inherited properties', () => {
      expect(task).toBeInstanceOf(Task);
      expect(task).toMatchObject({ id: 2, title: 'Ship release', completed: false, userId: 10 });
    });

    test("inherited methods work with the subclass's statuses", () => {
      const late = new PriorityTask({ id: 4, title: 'Late', userId: 10, dueDate: '2000-01-01' });
      expect(late.hasStatus('overdue')).toBe(true);
      expect(late.hasStatus('pending')).toBe(true); // 'pending' matches any incomplete task
      expect(late.toggle().getStatus()).toBe('completed');
    });
  });

  describe('priority-specific properties', () => {
    test('stores priority, due date as a Date, and tags', () => {
      expect(task).toMatchObject({ priority: 'high', dueDate: new Date('2026-01-20'), tags: ['work'] });
    });

    test('defaults to medium priority, no due date and no tags', () => {
      expect(new PriorityTask({ id: 3, title: 'Plain', userId: 10 })).toMatchObject({ priority: 'medium', dueDate: null, tags: [] });
    });

    test('removes duplicate tags', () => {
      expect(new PriorityTask({ id: 3, title: 'Tags', userId: 10, tags: ['work', 'home', 'work'] }).tags).toEqual(['work', 'home']);
    });

    test.each(['urgent', 'HIGH'])('rejects invalid priority %p', (priority) => {
      expect(() => new PriorityTask({ id: 3, title: 'Invalid', userId: 10, priority })).toThrow(new RangeError(`Invalid priority: ${priority}`));
    });
  });

  describe('date logic', () => {
    test('isOverdue() stays false until the end of the due day (UTC)', () => {
      expect(task.isOverdue(NOW)).toBe(false);
      expect(task.isOverdue(new Date('2026-01-20T23:59:59.999Z'))).toBe(false);
      expect(task.isOverdue(new Date('2026-01-21T00:00:00Z'))).toBe(true);
    });

    test('isOverdue() is false for completed tasks and tasks without a due date', () => {
      const noDue = new PriorityTask({ id: 3, title: 'No due', userId: 10 });
      expect(noDue.isOverdue(NOW)).toBe(false);
      expect(task.toggle().isOverdue(new Date('2026-02-01'))).toBe(false);
    });

    test('isUrgent() is true only for incomplete high priority tasks due within 3 days', () => {
      const soon = new Date('2026-01-17T00:00:00Z');
      expect(task.isUrgent(soon)).toBe(true);
      expect(task.isUrgent(NOW)).toBe(false); // 4.5 days away
      expect(new PriorityTask({ id: 3, title: 'Medium', userId: 10, dueDate: '2026-01-18' }).isUrgent(soon)).toBe(false);
      expect(new PriorityTask({ id: 4, title: 'No due', userId: 10, priority: 'high' }).isUrgent(soon)).toBe(false);
      expect(task.toggle().isUrgent(soon)).toBe(false);
    });

    test("getStatus() returns 'pending', 'urgent' or 'overdue' depending on the date", () => {
      expect(task.getStatus(NOW)).toBe('pending');
      expect(task.getStatus(new Date('2026-01-18'))).toBe('urgent');
      expect(task.getStatus(new Date('2026-01-25'))).toBe('overdue'); // overdue wins over urgent
    });
  });

  describe('overridden toString()', () => {
    test('adds priority and due date to the parent output', () => {
      expect(`${task}`).toBe('[ ] #2 Ship release (high, due 2026-01-20)');
      expect(`${new PriorityTask({ id: 3, title: 'Plain', userId: 10 })}`).toBe('[ ] #3 Plain (medium, no due date)');
    });
  });

  describe('derive() and fromAPI()', () => {
    const raw = { id: 1, title: 'From API', completed: false, userId: 2 };

    test('derives priority, due date and tags deterministically from the ids', () => {
      expect(PriorityTask.derive(raw, NOW)).toEqual({
        priority: 'medium', // PRIORITIES[1 % 3]
        dueDate: new Date('2026-01-12T00:00:00Z'), // (1 * 7 % 30) - 10 = 3 days before today
        tags: ['personal', 'home'],
      });
    });

    test('creates a PriorityTask from API data with the derived fields', () => {
      const created = PriorityTask.fromAPI(raw, NOW);
      expect(created).toBeInstanceOf(PriorityTask);
      expect(created).toMatchObject({ id: 1, title: 'From API', priority: 'medium' });
      expect(() => PriorityTask.fromAPI({ id: 1 }, NOW)).toThrow('Malformed task');
    });
  });
});

describe('User', () => {
  let user;
  const makeTask = (id, completed = false) => new Task({ id, title: `Task ${id}`, completed, userId: 1 });

  beforeEach(() => {
    user = new User({ id: 1, name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  test('constructor sets defaults and adds initial tasks', () => {
    expect(user).toEqual({ id: 1, name: 'Ada Lovelace', email: 'ada@example.com', company: 'N/A', city: 'Unknown', tasks: [] });
    expect(new User({ id: 1, name: 'Ada', email: 'a@b.c', tasks: [makeTask(1)] }).tasks).toHaveLength(1);
  });

  describe('fromAPI()', () => {
    test('flattens nested company and city, with defaults when missing', () => {
      const raw = { id: 1, name: 'Ada', email: 'a@b.c', company: { name: 'Analytical' }, address: { city: 'London' } };
      expect(User.fromAPI(raw)).toMatchObject({ company: 'Analytical', city: 'London' });
      expect(User.fromAPI({ id: 1, name: 'Ada', email: 'a@b.c' })).toMatchObject({ company: 'N/A', city: 'Unknown' });
    });

    test('throws a TypeError for malformed users', () => {
      expect(() => User.fromAPI(null)).toThrow(TypeError);
      expect(() => User.fromAPI({ id: 1, email: 'a@b.c' })).toThrow('Malformed user');
    });
  });

  describe('addTask()', () => {
    test('adds one or more tasks and returns the user for chaining', () => {
      expect(user.addTask(makeTask(1), makeTask(2))).toBe(user);
      expect(user.tasks.map(({ id }) => id)).toEqual([1, 2]);
    });

    test('rejects null tasks and plain objects', () => {
      expect(() => user.addTask(null)).toThrow(TypeError);
      expect(() => user.addTask({ id: 1, title: 'Fake', completed: false, userId: 1 })).toThrow('Not a Task');
    });

    test("rejects another user's task", () => {
      expect(() => user.addTask(new Task({ id: 9, title: 'Foreign', userId: 2 }))).toThrow(new RangeError('Task #9 does not belong to user #1'));
    });

    test('adds nothing if any task in the batch is invalid', () => {
      expect(() => user.addTask(makeTask(1), null)).toThrow();
      expect(user.tasks).toEqual([]);
    });
  });

  describe('getCompletionRate()', () => {
    test('returns 0 for no tasks instead of dividing by zero', () => {
      expect(user.getCompletionRate()).toBe(0);
    });

    test.each([
      [[false, false], 0],
      [[true, false, false], 33],
      [[true, true, false], 67],
      [[true, true], 100],
    ])('rounds completion %p to %i%%', (states, expected) => {
      user.addTask(...states.map((completed, i) => makeTask(i + 1, completed)));
      expect(user.getCompletionRate()).toBe(expected);
    });
  });

  describe('getTasksByStatus()', () => {
    test('filters completed, pending (including overdue) and overdue tasks', () => {
      user.addTask(makeTask(1, true), makeTask(2), new PriorityTask({ id: 3, title: 'Late', userId: 1, dueDate: '2000-01-01' }));
      const ids = (status) => user.getTasksByStatus(status).map(({ id }) => id);

      expect(ids('completed')).toEqual([1]);
      expect(ids('pending')).toEqual([2, 3]);
      expect(ids('overdue')).toEqual([3]);
    });

    test('returns an empty array for no tasks or an unknown status', () => {
      expect(user.getTasksByStatus('pending')).toEqual([]);
      expect(user.addTask(makeTask(1)).getTasksByStatus('archived')).toEqual([]);
    });
  });

  test('toJSON() includes the completion rate', () => {
    user.addTask(makeTask(1, true), makeTask(2));
    expect(user.toJSON()).toMatchObject({ id: 1, completionRate: 50 });
  });
});

describe('method interactions (spies)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('PriorityTask.getStatus() checks isOverdue() before isUrgent(), passing the same date', () => {
    const task = new PriorityTask({ id: 1, title: 'Due soon', userId: 1, priority: 'high', dueDate: '2026-01-16' });
    const isOverdue = jest.spyOn(task, 'isOverdue');
    const isUrgent = jest.spyOn(task, 'isUrgent');

    expect(task.getStatus(NOW)).toBe('urgent');
    expect(isOverdue).toHaveBeenCalledWith(NOW);
    expect(isUrgent).toHaveBeenCalledWith(NOW);
    expect(isOverdue.mock.invocationCallOrder[0]).toBeLessThan(isUrgent.mock.invocationCallOrder[0]);
  });

  test('PriorityTask.getStatus() stops at isOverdue() for overdue tasks', () => {
    const task = new PriorityTask({ id: 1, title: 'Late', userId: 1, priority: 'high', dueDate: '2026-01-01' });
    const isUrgent = jest.spyOn(task, 'isUrgent');
    const parentGetStatus = jest.spyOn(Task.prototype, 'getStatus');

    expect(task.getStatus(NOW)).toBe('overdue');
    expect(isUrgent).not.toHaveBeenCalled();
    expect(parentGetStatus).not.toHaveBeenCalled();
  });

  test('PriorityTask.getStatus() delegates to Task.prototype.getStatus() via super', () => {
    const parentGetStatus = jest.spyOn(Task.prototype, 'getStatus');
    new PriorityTask({ id: 1, title: 'On time', userId: 1, dueDate: '2026-02-01' }).getStatus(NOW);
    expect(parentGetStatus).toHaveBeenCalledTimes(1);
  });

  test('fromAPI() validates through Task.parse() and derives fields through derive()', () => {
    const raw = { id: 1, title: 'From API', completed: false, userId: 2 };
    const parse = jest.spyOn(Task, 'parse');
    const derive = jest.spyOn(PriorityTask, 'derive');

    PriorityTask.fromAPI(raw, NOW);
    expect(parse).toHaveBeenCalledWith(raw);
    expect(derive).toHaveBeenCalledWith(raw, NOW);
  });

  test('the User constructor adds initial tasks through addTask()', () => {
    const tasks = [new Task({ id: 1, title: 'A', userId: 1 }), new Task({ id: 2, title: 'B', userId: 1 })];
    const addTask = jest.spyOn(User.prototype, 'addTask');

    new User({ id: 1, name: 'Ada', email: 'a@b.c', tasks });
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith(...tasks);
  });

  test('getTasksByStatus() asks every task for its status', () => {
    const tasks = [1, 2, 3].map((id) => new Task({ id, title: `T${id}`, userId: 1 }));
    const user = new User({ id: 1, name: 'Ada', email: 'a@b.c', tasks });
    const hasStatus = jest.spyOn(Task.prototype, 'hasStatus');

    user.getTasksByStatus('completed');
    expect(hasStatus).toHaveBeenCalledTimes(3);
    expect(hasStatus).toHaveBeenCalledWith('completed');
  });
});

describe('error handling', () => {
  test('constructors throw a TypeError without a properties object', () => {
    expect(() => new Task(null)).toThrow(TypeError);
    expect(() => new PriorityTask()).toThrow(TypeError);
    expect(() => new User()).toThrow(TypeError);
  });

  test('rejects a due date that cannot be parsed', () => {
    expect(() => new PriorityTask({ id: 1, title: 'Bad date', userId: 1, dueDate: 'not-a-date' }))
      .toThrow(new RangeError('Invalid due date: not-a-date'));
  });

  test('rejects tags that are not an array', () => {
    expect(() => new PriorityTask({ id: 1, title: 'Bad tags', userId: 1, tags: 'work' }))
      .toThrow(new TypeError('Tags must be an array: "work"'));
  });

  test('accepts due dates as a Date or timestamp, and treats an empty string as none', () => {
    const create = (dueDate) => new PriorityTask({ id: 1, title: 'Date', userId: 1, dueDate }).dueDate;
    expect(create(new Date('2026-03-01'))).toEqual(new Date('2026-03-01'));
    expect(create(Date.UTC(2026, 2, 1))).toEqual(new Date('2026-03-01'));
    expect(create('')).toBeNull();
  });

  test("addTask rejects a task whose userId is the user's id as a string", () => {
    const task = new Task({ id: 1, title: 'String id', userId: '1' });
    expect(() => new User({ id: 1, name: 'Ada', email: 'a@b.c' }).addTask(task)).toThrow(RangeError);
  });
});
