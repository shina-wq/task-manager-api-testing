import { jest } from '@jest/globals';
import { Task } from '../src/models.js';

describe('Jest setup', () => {
  test('runs assertions', () => {
    expect(1 + 1).toBe(2);
  });

  test('imports ES modules from src', () => {
    expect(new Task({ id: 1, title: 'Setup', userId: 1 })).toBeInstanceOf(Task);
  });

  test('supports jest mock functions', () => {
    const fn = jest.fn().mockReturnValue('ok');
    expect(fn()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
