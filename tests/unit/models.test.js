import { Task } from '../../src/models.js';

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
