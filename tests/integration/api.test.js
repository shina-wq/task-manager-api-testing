import { jest } from '@jest/globals';
import { APIClient, APIError } from '../../src/api.js';
import { logger } from '../../src/logger.js';
import { mockUsers, mockTodos } from '../__mocks__/api.js';

const BASE_URL = 'https://api.test';
const jsonResponse = (body, init) => new Response(JSON.stringify(body), init);
const routeByUrl = (url) => Promise.resolve(jsonResponse(url.endsWith('/users') ? mockUsers : mockTodos));

let fetchMock;
let client;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
  client = new APIClient({ baseURL: BASE_URL, retries: 0, rateLimit: 0, timeout: 1000 });
});

describe('fetching resources', () => {
  test('fetchUsers() calls /users with a timeout signal and resolves with the parsed list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockUsers));
    await expect(client.fetchUsers()).resolves.toEqual(mockUsers);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/users`, { signal: expect.any(AbortSignal) });
  });

  test('uses the JSONPlaceholder base URL by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockUsers));
    await new APIClient({ rateLimit: 0 }).fetchUsers();
    expect(fetchMock).toHaveBeenCalledWith('https://jsonplaceholder.typicode.com/users', expect.any(Object));
  });

  test('fetchTodos() calls /todos and resolves with the parsed list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockTodos));
    await expect(client.fetchTodos()).resolves.toEqual(mockTodos);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/todos`, expect.any(Object));
  });

  test("fetchUserTodos() calls the user's todos endpoint", async () => {
    const userTodos = mockTodos.filter(({ userId }) => userId === 2);
    fetchMock.mockResolvedValue(jsonResponse(userTodos));

    await expect(client.fetchUserTodos(2)).resolves.toEqual(userTodos);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/users/2/todos`, expect.any(Object));
  });

  test.each([0, '2'])('fetchUserTodos() rejects invalid user id %p without calling fetch', async (userId) => {
    await expect(client.fetchUserTodos(userId)).rejects.toThrow(`Invalid userId: ${userId}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fetchTodosForUsers() combines several users into one list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([mockTodos[0]])).mockResolvedValueOnce(jsonResponse([mockTodos[4]]));
    await expect(client.fetchTodosForUsers(1, 2)).resolves.toEqual([mockTodos[0], mockTodos[4]]);
  });

  test('serves repeated calls from the cache until it is cleared', async () => {
    fetchMock.mockImplementation(routeByUrl);
    await client.fetchTodos();
    await client.fetchTodos();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.clearCache();
    await client.fetchTodos();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetching users and todos together', () => {
  test('fetchAll() requests both endpoints', async () => {
    fetchMock.mockImplementation(routeByUrl);
    await expect(client.fetchAll()).resolves.toEqual({ users: mockUsers, todos: mockTodos });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const error = await client.fetchUsers().catch((e) => e);

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ type: 'http', status, endpoint: '/users', message: `HTTP ${status} ${statusText} for /users` });
  });

  test('wraps network failures in a network APIError that keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(cause);
    await expect(client.fetchTodos()).rejects.toMatchObject({ type: 'network', message: `Network error: unable to reach ${BASE_URL}`, cause });
  });

  test('reports timeouts with the configured limit', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    await expect(client.fetchTodos()).rejects.toMatchObject({ type: 'timeout', message: 'Request to /todos timed out after 1000ms' });
  });

  test('rejects malformed JSON and JSON that is not a list with a parse APIError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not json</html>')).mockResolvedValueOnce(jsonResponse({ todos: [] }));
    await expect(client.fetchTodos()).rejects.toMatchObject({ type: 'parse', message: 'Malformed JSON received from /todos' });
    await expect(client.fetchUsers()).rejects.toMatchObject({ type: 'parse', message: 'Expected a list from /users, got object' });
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

  test('retries network failures with growing backoff, logging each attempt in order', async () => {
    const debug = jest.spyOn(logger, 'debug');
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(mockTodos));

    expect((await settle(client.fetchTodos())).value).toEqual(mockTodos);
    expect(debug.mock.calls.map(([message]) => message)).toEqual([
      `GET ${BASE_URL}/todos (attempt 1)`,
      `Network error: unable to reach ${BASE_URL} — retrying in 300ms`,
      `GET ${BASE_URL}/todos (attempt 2)`,
      `Network error: unable to reach ${BASE_URL} — retrying in 600ms`,
      `GET ${BASE_URL}/todos (attempt 3)`,
    ]);
  });

  test('retries 429 and 5xx responses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(mockUsers));
    expect((await settle(client.fetchUsers())).value).toEqual(mockUsers);
  });

  test('gives up after the configured number of retries', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    expect((await settle(client.fetchTodos())).error.type).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('does not retry client errors or malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 404 })).mockResolvedValueOnce(new Response('not json'));
    expect((await settle(client.fetchTodos())).error.status).toBe(404);
    expect((await settle(client.fetchUsers())).error.type).toBe('parse');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
