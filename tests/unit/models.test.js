import { Task, PriorityTask, User, PRIORITIES } from '../../src/models.js';

describe('Task', () => {
  let task;

  beforeEach(() => {
    task = new Task({ id: 1, title: 'Write tests', completed: false, userId: 10 });
  });

  describe('constructor', () => {
    test('initializes all properties', () => {
      expect(task).toEqual({ id: 1, title: 'Write tests', completed: false, userId: 10 });
    });

    test('defaults completed to false', () => {
      expect(new Task({ id: 2, title: 'Default', userId: 10 }).completed).toBe(false);
    });

    test('keeps null and undefined properties as given', () => {
      const empty = new Task({ id: null, title: undefined, userId: null });
      expect(empty).toEqual({ id: null, title: undefined, completed: false, userId: null });
    });

    test('throws when called without arguments', () => {
      expect(() => new Task()).toThrow(TypeError);
    });
  });

  describe('toggle()', () => {
    test('marks a pending task as completed', () => {
      task.toggle();
      expect(task.completed).toBe(true);
    });

    test('toggles back to pending when called twice', () => {
      task.toggle().toggle();
      expect(task.completed).toBe(false);
    });

    test('returns the task for chaining', () => {
      expect(task.toggle()).toBe(task);
    });
  });

  describe('getStatus()', () => {
    test("returns 'pending' for an incomplete task", () => {
      expect(task.getStatus()).toBe('pending');
    });

    test("returns 'completed' after toggling", () => {
      expect(task.toggle().getStatus()).toBe('completed');
    });
  });

  describe('isOverdue()', () => {
    test('returns false for a pending task', () => {
      expect(task.isOverdue()).toBe(false);
    });

    test('returns false for a completed task', () => {
      expect(task.toggle().isOverdue()).toBe(false);
    });

    test('ignores due dates, even ones in the past', () => {
      const past = new Task({ id: 3, title: 'Old', userId: 10, dueDate: '2000-01-01' });
      expect(past.isOverdue(new Date('2030-01-01'))).toBe(false);
    });
  });

  describe('hasStatus()', () => {
    test('matches the current status', () => {
      expect(task.hasStatus('pending')).toBe(true);
    });

    test('rejects a different status', () => {
      expect(task.hasStatus('completed')).toBe(false);
    });
  });

  describe('serialization', () => {
    test('toString() shows completion mark, id and title', () => {
      expect(`${task}`).toBe('[ ] #1 Write tests');
      expect(`${task.toggle()}`).toBe('[✔] #1 Write tests');
    });

    test('toJSON() includes the derived status', () => {
      expect(JSON.parse(JSON.stringify(task))).toEqual({ id: 1, title: 'Write tests', completed: false, userId: 10, status: 'pending' });
    });
  });

  describe('fromAPI()', () => {
    const raw = { id: 5, title: '  Buy milk  ', completed: true, userId: 2 };

    test('creates a Task from valid API data', () => {
      expect(Task.fromAPI(raw)).toBeInstanceOf(Task);
    });

    test('trims the title and drops unknown fields', () => {
      expect(Task.fromAPI({ ...raw, extra: 'ignored' })).toEqual({ id: 5, title: 'Buy milk', completed: true, userId: 2 });
    });

    test('accepts an empty title', () => {
      expect(Task.fromAPI({ ...raw, title: '   ' }).title).toBe('');
    });

    test.each([
      ['null', null],
      ['undefined', undefined],
      ['a non-integer id', { ...raw, id: '5' }],
      ['a missing userId', { id: 5, title: 'x', completed: true }],
      ['a non-string title', { ...raw, title: 42 }],
      ['a null title', { ...raw, title: null }],
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
  // Fixed clock keeps every date comparison deterministic
  const NOW = new Date('2026-01-15T12:00:00Z');
  let task;

  beforeEach(() => {
    task = new PriorityTask({ id: 2, title: 'Ship release', userId: 10, priority: 'high', dueDate: '2026-01-20', tags: ['work'] });
  });

  describe('inheritance', () => {
    test('is an instance of both PriorityTask and Task', () => {
      expect(task).toBeInstanceOf(PriorityTask);
      expect(task).toBeInstanceOf(Task);
    });

    test('initializes the inherited Task properties', () => {
      expect(task).toMatchObject({ id: 2, title: 'Ship release', completed: false, userId: 10 });
    });

    test('uses the inherited toggle()', () => {
      expect(task.toggle().completed).toBe(true);
    });

    test('uses the inherited hasStatus() with overridden statuses', () => {
      const old = new PriorityTask({ id: 4, title: 'Old', userId: 10, dueDate: '2000-01-01' });
      expect(old.hasStatus('overdue')).toBe(true);
      expect(old.hasStatus('pending')).toBe(true); // 'pending' matches any incomplete task
    });
  });

  describe('priority-specific properties', () => {
    test('stores priority, due date and tags', () => {
      expect(task.priority).toBe('high');
      expect(task.dueDate).toEqual(new Date('2026-01-20'));
      expect(task.tags).toEqual(['work']);
    });

    test('defaults to medium priority, no due date and no tags', () => {
      const plain = new PriorityTask({ id: 3, title: 'Plain', userId: 10 });
      expect(plain).toMatchObject({ priority: 'medium', dueDate: null, tags: [] });
    });

    test('converts a due date string into a Date', () => {
      expect(task.dueDate).toBeInstanceOf(Date);
    });

    test('removes duplicate tags', () => {
      const tagged = new PriorityTask({ id: 3, title: 'Tags', userId: 10, tags: ['work', 'home', 'work'] });
      expect(tagged.tags).toEqual(['work', 'home']);
    });
  });

  describe('priority validation', () => {
    test.each(PRIORITIES)("accepts '%s'", (priority) => {
      expect(new PriorityTask({ id: 3, title: 'Valid', userId: 10, priority }).priority).toBe(priority);
    });

    test.each(['urgent', '', null, 3])('throws a RangeError for %p', (priority) => {
      expect(() => new PriorityTask({ id: 3, title: 'Invalid', userId: 10, priority })).toThrow(RangeError);
    });

    test('names the invalid priority in the error message', () => {
      expect(() => new PriorityTask({ id: 3, title: 'Invalid', userId: 10, priority: 'critical' }))
        .toThrow('Invalid priority: critical');
    });
  });

  describe('isOverdue()', () => {
    test('returns false before the due date', () => {
      expect(task.isOverdue(NOW)).toBe(false);
    });

    test('returns false until the very end of the due day (UTC)', () => {
      expect(task.isOverdue(new Date('2026-01-20T23:59:59.999Z'))).toBe(false);
    });

    test('returns true once the due day has passed', () => {
      expect(task.isOverdue(new Date('2026-01-21T00:00:00Z'))).toBe(true);
    });

    test('returns false for a completed task past its due date', () => {
      expect(task.toggle().isOverdue(new Date('2026-02-01'))).toBe(false);
    });

    test('returns false when there is no due date', () => {
      task.dueDate = null;
      expect(task.isOverdue(NOW)).toBe(false);
    });
  });

  describe('isUrgent()', () => {
    test('returns true for a high priority task due within 3 days', () => {
      expect(task.isUrgent(new Date('2026-01-17T00:00:00Z'))).toBe(true);
    });

    test('returns false when the due date is more than 3 days away', () => {
      expect(task.isUrgent(NOW)).toBe(false);
    });

    test('returns false for non-high priorities', () => {
      task.priority = 'medium';
      expect(task.isUrgent(new Date('2026-01-19'))).toBe(false);
    });

    test('returns false for completed tasks or tasks without a due date', () => {
      const noDue = new PriorityTask({ id: 3, title: 'No due', userId: 10, priority: 'high' });
      expect(task.toggle().isUrgent(new Date('2026-01-19'))).toBe(false);
      expect(noDue.isUrgent(NOW)).toBe(false);
    });
  });

  describe('getStatus()', () => {
    test("returns 'pending' when on time and not urgent", () => {
      expect(task.getStatus(NOW)).toBe('pending');
    });

    test("returns 'urgent' when high priority and due soon", () => {
      expect(task.getStatus(new Date('2026-01-18'))).toBe('urgent');
    });

    test("returns 'overdue' ahead of 'urgent' once past due", () => {
      expect(task.getStatus(new Date('2026-01-25'))).toBe('overdue');
    });

    test("falls back to the parent's 'completed' status", () => {
      expect(task.toggle().getStatus(new Date('2026-01-25'))).toBe('completed');
    });
  });

  describe('toString()', () => {
    test('extends the parent output with priority and due date', () => {
      expect(`${task}`).toBe('[ ] #2 Ship release (high, due 2026-01-20)');
    });

    test('shows a placeholder when there is no due date', () => {
      const plain = new PriorityTask({ id: 3, title: 'Plain', userId: 10 });
      expect(`${plain}`).toBe('[ ] #3 Plain (medium, no due date)');
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

    test('keeps derived due dates within -10 to +19 days of today', () => {
      const today = new Date('2026-01-15T00:00:00Z');
      const offsets = Array.from({ length: 30 }, (_, id) =>
        (PriorityTask.derive({ id, userId: 1 }, NOW).dueDate - today) / 86_400_000);
      expect(Math.min(...offsets)).toBe(-10);
      expect(Math.max(...offsets)).toBe(19);
    });

    test('creates a PriorityTask with derived fields from API data', () => {
      const created = PriorityTask.fromAPI(raw, NOW);
      expect(created).toBeInstanceOf(PriorityTask);
      expect(created).toMatchObject({ id: 1, title: 'From API', priority: 'medium', tags: ['personal', 'home'] });
    });

    test('rejects malformed API data via Task.parse()', () => {
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

  describe('constructor', () => {
    test('initializes properties with defaults and no tasks', () => {
      expect(user).toEqual({ id: 1, name: 'Ada Lovelace', email: 'ada@example.com', company: 'N/A', city: 'Unknown', tasks: [] });
    });

    test('adds tasks passed to the constructor', () => {
      const withTasks = new User({ id: 1, name: 'Ada', email: 'a@b.c', tasks: [makeTask(1), makeTask(2)] });
      expect(withTasks.tasks).toHaveLength(2);
    });
  });

  describe('fromAPI()', () => {
    const raw = { id: 1, name: 'Ada', email: 'a@b.c', company: { name: 'Analytical' }, address: { city: 'London' } };

    test('reads nested company and city fields', () => {
      expect(User.fromAPI(raw)).toMatchObject({ company: 'Analytical', city: 'London' });
    });

    test('falls back to defaults when nested fields are missing', () => {
      expect(User.fromAPI({ id: 1, name: 'Ada', email: 'a@b.c' })).toMatchObject({ company: 'N/A', city: 'Unknown' });
    });

    test.each([
      ['null', null],
      ['a non-integer id', { ...raw, id: '1' }],
      ['a missing name', { id: 1, email: 'a@b.c' }],
      ['a non-string email', { ...raw, email: 42 }],
    ])('throws a TypeError for %s', (_, input) => {
      expect(() => User.fromAPI(input)).toThrow(TypeError);
    });
  });

  describe('addTask()', () => {
    test('adds a single task', () => {
      user.addTask(makeTask(1));
      expect(user.tasks).toEqual([makeTask(1)]);
    });

    test('adds multiple tasks at once', () => {
      user.addTask(makeTask(1), makeTask(2), makeTask(3));
      expect(user.tasks.map(({ id }) => id)).toEqual([1, 2, 3]);
    });

    test('accepts PriorityTask instances', () => {
      user.addTask(new PriorityTask({ id: 4, title: 'Priority', userId: 1 }));
      expect(user.tasks[0]).toBeInstanceOf(PriorityTask);
    });

    test('returns the user for chaining', () => {
      expect(user.addTask(makeTask(1))).toBe(user);
    });

    test('does nothing when called with no tasks', () => {
      user.addTask();
      expect(user.tasks).toEqual([]);
    });

    test.each([null, undefined, { id: 1, userId: 1 }, 'task'])('throws a TypeError for %p', (input) => {
      expect(() => user.addTask(input)).toThrow(TypeError);
    });

    test("throws a RangeError for another user's task", () => {
      const foreign = new Task({ id: 9, title: 'Foreign', userId: 2 });
      expect(() => user.addTask(foreign)).toThrow('Task #9 does not belong to user #1');
    });

    test('adds nothing if any task in the batch is invalid', () => {
      expect(() => user.addTask(makeTask(1), null)).toThrow();
      expect(user.tasks).toEqual([]);
    });
  });

  describe('getCompletionRate()', () => {
    test('returns 0 with no tasks instead of dividing by zero', () => {
      expect(user.getCompletionRate()).toBe(0);
    });

    test('returns 0 when no tasks are completed', () => {
      user.addTask(makeTask(1), makeTask(2));
      expect(user.getCompletionRate()).toBe(0);
    });

    test('returns 100 when all tasks are completed', () => {
      user.addTask(makeTask(1, true), makeTask(2, true));
      expect(user.getCompletionRate()).toBe(100);
    });

    test.each([
      [[true, false], 50],
      [[true, false, false], 33],
      [[true, true, false], 67],
    ])('rounds mixed completion %p to %i%%', (states, expected) => {
      user.addTask(...states.map((completed, i) => makeTask(i + 1, completed)));
      expect(user.getCompletionRate()).toBe(expected);
    });

    test('updates when a task is toggled', () => {
      const task = makeTask(1);
      user.addTask(task);
      task.toggle();
      expect(user.getCompletionRate()).toBe(100);
    });
  });

  describe('getTasksByStatus()', () => {
    const overdue = () => new PriorityTask({ id: 3, title: 'Late', userId: 1, dueDate: '2000-01-01' });

    beforeEach(() => {
      user.addTask(makeTask(1, true), makeTask(2), overdue());
    });

    test('returns completed tasks', () => {
      expect(user.getTasksByStatus('completed').map(({ id }) => id)).toEqual([1]);
    });

    test('returns every incomplete task for pending, including overdue ones', () => {
      expect(user.getTasksByStatus('pending').map(({ id }) => id)).toEqual([2, 3]);
    });

    test('returns tasks with a priority-specific status', () => {
      expect(user.getTasksByStatus('overdue').map(({ id }) => id)).toEqual([3]);
    });

    test.each(['archived', undefined, null])('returns an empty array for unknown status %p', (status) => {
      expect(user.getTasksByStatus(status)).toEqual([]);
    });

    test('returns an empty array for a user with no tasks', () => {
      expect(new User({ id: 2, name: 'Empty', email: 'e@x.y' }).getTasksByStatus('pending')).toEqual([]);
    });
  });

  describe('toJSON()', () => {
    test('includes the completion rate', () => {
      user.addTask(makeTask(1, true), makeTask(2));
      expect(user.toJSON()).toMatchObject({ id: 1, completionRate: 50 });
    });
  });
});
