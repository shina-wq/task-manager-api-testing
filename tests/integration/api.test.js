import { jest } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIClient, APIError } from '../../src/api.js';
import { TaskManager } from '../../src/TaskManager.js';
import { mockUsers, mockTodos } from '../__mocks__/api.js';

const BASE_URL = 'https://api.test';
const jsonResponse = (body, init) => new Response(JSON.stringify(body), init);
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

let fetchMock;
let client;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
  client = new APIClient({ baseURL: BASE_URL, retries: 0, rateLimit: 0, timeout: 1000 });
});

describe('fetchUsers()', () => {
  test('resolves with the parsed list of users', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockUsers));
    await expect(client.fetchUsers()).resolves.toEqual(mockUsers);
  });

  test('calls the /users endpoint with a timeout signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockUsers));
    await client.fetchUsers();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/users`, { signal: expect.any(AbortSignal) });
  });

  test('uses the JSONPlaceholder base URL by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockUsers));
    await new APIClient({ rateLimit: 0 }).fetchUsers();
    expect(fetchMock).toHaveBeenCalledWith('https://jsonplaceholder.typicode.com/users', expect.any(Object));
  });
});

describe('fetchTodos()', () => {
  test('resolves with the parsed list of todos from /todos', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockTodos));
    await expect(client.fetchTodos()).resolves.toEqual(mockTodos);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/todos`, expect.any(Object));
  });

  test('resolves with an empty array for an empty response', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await expect(client.fetchTodos()).resolves.toEqual([]);
  });

  test('serves repeated calls from the cache until it is cleared', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(mockTodos)));
    await client.fetchTodos();
    await client.fetchTodos();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.clearCache();
    await client.fetchTodos();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchUserTodos()', () => {
  test("calls the user's todos endpoint", async () => {
    const userTodos = mockTodos.filter(({ userId }) => userId === 2);
    fetchMock.mockResolvedValue(jsonResponse(userTodos));

    await expect(client.fetchUserTodos(2)).resolves.toEqual(userTodos);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/users/2/todos`, expect.any(Object));
  });

  test.each([0, -1, 1.5, '2', null])('rejects invalid user id %p without calling fetch', async (userId) => {
    await expect(client.fetchUserTodos(userId)).rejects.toThrow(`Invalid userId: ${userId}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fetchTodosForUsers() combines several users into one list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([mockTodos[0]]))
      .mockResolvedValueOnce(jsonResponse([mockTodos[4]]));

    await expect(client.fetchTodosForUsers(1, 2)).resolves.toEqual([mockTodos[0], mockTodos[4]]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${BASE_URL}/users/1/todos`, `${BASE_URL}/users/2/todos`]);
  });
});

describe('fetchAll() and fetchAllSettled()', () => {
  const routeByUrl = (url) => Promise.resolve(jsonResponse(url.endsWith('/users') ? mockUsers : mockTodos));

  test('fetchAll() requests users and todos together', async () => {
    fetchMock.mockImplementation(routeByUrl);
    await expect(client.fetchAll()).resolves.toEqual({ users: mockUsers, todos: mockTodos });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('fetchAll() rejects if either request fails', async () => {
    fetchMock.mockImplementation((url) => (url.endsWith('/users') ? Promise.reject(new TypeError('fetch failed')) : routeByUrl(url)));
    await expect(client.fetchAll()).rejects.toBeInstanceOf(APIError);
  });

  test('fetchAllSettled() keeps the successful result when one request fails', async () => {
    fetchMock.mockImplementation((url) => (url.endsWith('/users') ? Promise.resolve(jsonResponse({}, { status: 500 })) : routeByUrl(url)));

    const { users, todos, errors } = await client.fetchAllSettled();
    expect(users).toEqual([]);
    expect(todos).toEqual(mockTodos);
    expect(errors).toEqual([expect.objectContaining({ status: 500, endpoint: '/users' })]);
  });

  test('fetchAllSettled() rejects when both requests fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.fetchAllSettled()).rejects.toMatchObject({ type: 'network' });
  });
});

describe('error handling', () => {
  test.each([
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
  ])('rejects an HTTP %i response with an http APIError', async (status, statusText) => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status, statusText }));
    await expect(client.fetchUsers()).rejects.toMatchObject({
      name: 'APIError',
      type: 'http',
      status,
      endpoint: '/users',
      message: `HTTP ${status} ${statusText} for /users`,
    });
  });

  test('wraps network failures in a network APIError that keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(cause);
    await expect(client.fetchTodos()).rejects.toMatchObject({
      type: 'network',
      message: `Network error: unable to reach ${BASE_URL}`,
      cause,
    });
  });

  test('reports timeouts with the configured limit', async () => {
    fetchMock.mockRejectedValue(timeoutError());
    await expect(client.fetchTodos()).rejects.toMatchObject({
      type: 'timeout',
      message: 'Request to /todos timed out after 1000ms',
    });
  });

  test('rejects malformed JSON with a parse APIError', async () => {
    fetchMock.mockResolvedValue(new Response('<html>not json</html>'));
    await expect(client.fetchTodos()).rejects.toMatchObject({ type: 'parse', message: 'Malformed JSON received from /todos' });
  });

  test('rejects valid JSON that is not a list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ todos: [] }));
    await expect(client.fetchTodos()).rejects.toMatchObject({ type: 'parse', message: 'Expected a list from /todos, got object' });
  });
});

describe('retries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    client = new APIClient({ baseURL: BASE_URL, retries: 2, rateLimit: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Runs the request while fast-forwarding through the backoff delays
  const settle = async (promise) => {
    const result = promise.then((value) => ({ value }), (error) => ({ error }));
    await jest.runAllTimersAsync();
    return result;
  };

  test('retries a network failure and then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(jsonResponse(mockTodos));
    const { value } = await settle(client.fetchTodos());
    expect(value).toEqual(mockTodos);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('retries 429 and 5xx responses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(mockUsers));
    const { value } = await settle(client.fetchUsers());
    expect(value).toEqual(mockUsers);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('gives up after the configured number of retries', async () => {
    fetchMock.mockRejectedValue(timeoutError());
    const { error } = await settle(client.fetchTodos());
    expect(error.type).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test.each([404, 400])('does not retry a %i client error', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status }));
    const { error } = await settle(client.fetchTodos());
    expect(error.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not retry malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json'));
    const { error } = await settle(client.fetchTodos());
    expect(error.type).toBe('parse');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('APIError', () => {
  test.each([
    [{ type: 'network' }, true],
    [{ type: 'timeout' }, true],
    [{ type: 'http', status: 429 }, true],
    [{ type: 'http', status: 503 }, true],
    [{ type: 'http', status: 404 }, false],
    [{ type: 'parse' }, false],
  ])('isRetryable for %p is %p', (options, expected) => {
    expect(new APIError('failed', options).isRetryable).toBe(expected);
  });
});

describe('APIClient with TaskManager', () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-manager-api-'));
    fetchMock.mockImplementation((url) => Promise.resolve(jsonResponse(url.endsWith('/users') ? mockUsers : mockTodos)));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('loads real HTTP responses into models through the full stack', async () => {
    const manager = new TaskManager({ api: client, snapshotFile: join(dir, 'snapshot.json') });

    await expect(manager.load()).resolves.toEqual({ source: 'api', users: 3, tasks: 9 });
    expect(manager.getUser(1).tasks.map(({ id }) => id)).toEqual([1, 2, 3, 23]);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([`${BASE_URL}/todos`, `${BASE_URL}/users`]);
  });
});
