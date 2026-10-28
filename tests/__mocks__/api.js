// Mock implementation of src/api.js with JSONPlaceholder-shaped sample data.
// Todo ids are chosen so the derived fields (see PriorityTask.derive) give stable statuses on any date:
//   #1 medium, due -3 days → overdue    #5  high, due -5 days → overdue
//   #23 high, due +1 day   → urgent     #3, #6 low → pending    #2, #4, #7, #8 → completed
import { jest } from '@jest/globals';

export const mockUsers = [
  {
    id: 1,
    name: 'Leanne Graham',
    username: 'Bret',
    email: 'Sincere@april.biz',
    address: { street: 'Kulas Light', city: 'Gwenborough' },
    company: { name: 'Romaguera-Crona' },
  },
  {
    id: 2,
    name: 'Ervin Howell',
    username: 'Antonette',
    email: 'Shanna@melissa.tv',
    address: { street: 'Victor Plains', city: 'Wisokyburgh' },
    company: { name: 'Deckow-Crist' },
  },
  {
    id: 3,
    name: 'Clementine Bauch',
    username: 'Samantha',
    email: 'Nathan@yesenia.net',
    address: { street: 'Douglas Extension', city: 'McKenziehaven' },
    company: { name: 'Romaguera-Jacobson' },
  },
];

export const mockTodos = [
  { userId: 1, id: 1, title: 'Write project report', completed: false },
  { userId: 1, id: 2, title: 'Review pull requests', completed: true },
  { userId: 1, id: 3, title: 'Update README', completed: false },
  { userId: 1, id: 23, title: 'Prepare release notes', completed: false },
  { userId: 2, id: 4, title: 'Buy groceries', completed: true },
  { userId: 2, id: 5, title: 'Pay electricity bill', completed: false },
  { userId: 2, id: 6, title: 'Book dentist appointment', completed: false },
  { userId: 3, id: 7, title: 'Morning run', completed: true },
  { userId: 3, id: 8, title: 'Read testing book', completed: true },
];

// Every call gets a fresh copy, so tests can't leak changes into each other
const clone = (data) => structuredClone(data);

export class APIError extends Error {
  constructor(message, { type, endpoint, status = null } = {}) {
    super(message);
    this.name = 'APIError';
    this.type = type;
    this.endpoint = endpoint;
    this.status = status;
  }
}

export class APIClient {
  constructor(options = {}) {
    this.options = options;
    this.fetchUsers = jest.fn(() => Promise.resolve(clone(mockUsers)));
    this.fetchTodos = jest.fn(() => Promise.resolve(clone(mockTodos)));
    this.fetchUserTodos = jest.fn((userId) => Promise.resolve(clone(mockTodos.filter((todo) => todo.userId === userId))));
    this.fetchTodosForUsers = jest.fn((...userIds) =>
      Promise.all(userIds.map((id) => this.fetchUserTodos(id))).then((results) => results.flat()));
    this.fetchAll = jest.fn(() =>
      Promise.all([this.fetchUsers(), this.fetchTodos()]).then(([users, todos]) => ({ users, todos })));
    // Mirrors the real partial-results contract, so failing fetchUsers/fetchTodos drives partial loads
    this.fetchAllSettled = jest.fn(() =>
      Promise.allSettled([this.fetchUsers(), this.fetchTodos()]).then(([users, todos]) => {
        const errors = [users, todos].filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
        if (errors.length === 2) throw errors[0];
        return { users: users.value ?? [], todos: todos.value ?? [], errors };
      }));
    this.clearCache = jest.fn();
  }
}
