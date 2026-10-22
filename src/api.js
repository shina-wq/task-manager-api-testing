import { withCache } from './cache.js';
import { createRateLimiter, delay } from './rateLimiter.js';
import { logger } from './logger.js';

const BASE_URL = 'https://jsonplaceholder.typicode.com';

export class APIError extends Error {
  /** @param {'network'|'timeout'|'http'|'parse'} type */
  constructor(message, { type, endpoint, status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'APIError';
    this.type = type;
    this.endpoint = endpoint;
    this.status = status;
  }

  get isRetryable() {
    return ['network', 'timeout'].includes(this.type) || this.status === 429 || this.status >= 500;
  }
}

export class APIClient {
  #baseURL;
  #timeout;
  #retries;
  #limit;
  #get;

  constructor({ baseURL = BASE_URL, timeout = 5000, retries = 2, rateLimit = 100, cacheTTL = 60_000 } = {}) {
    this.#baseURL = baseURL;
    this.#timeout = timeout;
    this.#retries = retries;
    this.#limit = createRateLimiter({ interval: rateLimit });
    this.#get = withCache((endpoint) => this.#request(endpoint), { ttl: cacheTTL });
  }

  async fetchUsers() {
    return this.#getList('/users');
  }

  async fetchTodos() {
    return this.#getList('/todos');
  }

  async fetchUserTodos(userId) {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new TypeError(`Invalid userId: ${userId}`);
    }
    return this.#getList(`/users/${userId}/todos`);
  }

  // Promise-chain style: fetch users and todos concurrently
  fetchAll() {
    return Promise.all([this.fetchUsers(), this.fetchTodos()])
      .then(([users, todos]) => ({ users, todos }));
  }

  // Promise-chain style with partial results: one failed resource doesn't discard the other
  fetchAllSettled() {
    return Promise.allSettled([this.fetchUsers(), this.fetchTodos()])
      .then(([users, todos]) => {
        const errors = [users, todos].filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
        if (errors.length === 2) throw errors[0];
        return { users: users.value ?? [], todos: todos.value ?? [], errors };
      });
  }

  // Rest parameter: fetch todos for any number of users concurrently
  async fetchTodosForUsers(...userIds) {
    const results = await Promise.all(userIds.map((id) => this.fetchUserTodos(id)));
    return results.flat();
  }

  clearCache() {
    this.#get.clear();
  }

  async #getList(endpoint) {
    const data = await this.#get(endpoint);
    if (!Array.isArray(data)) {
      throw new APIError(`Expected a list from ${endpoint}, got ${typeof data}`, { type: 'parse', endpoint });
    }
    return data;
  }

  async #request(endpoint, attempt = 0) {
    const url = `${this.#baseURL}${endpoint}`;

    try {
      logger.debug(`GET ${url} (attempt ${attempt + 1})`);
      const response = await this.#limit(() => fetch(url, { signal: AbortSignal.timeout(this.#timeout) }));

      if (!response.ok) {
        throw new APIError(`HTTP ${response.status} ${response.statusText} for ${endpoint}`, {
          type: 'http',
          endpoint,
          status: response.status,
        });
      }
      return await response.json();
    } catch (error) {
      const apiError = this.#normalize(error, endpoint);

      if (apiError.isRetryable && attempt < this.#retries) {
        const backoff = 2 ** attempt * 300;
        logger.debug(`${apiError.message} — retrying in ${backoff}ms`);
        await delay(backoff);
        return this.#request(endpoint, attempt + 1);
      }
      throw apiError;
    }
  }

  #normalize(error, endpoint) {
    if (error instanceof APIError) return error;

    const options = { endpoint, cause: error };
    switch (error?.name) {
      case 'TimeoutError':
        return new APIError(`Request to ${endpoint} timed out after ${this.#timeout}ms`, { ...options, type: 'timeout' });
      case 'SyntaxError':
        return new APIError(`Malformed JSON received from ${endpoint}`, { ...options, type: 'parse' });
      default:
        return new APIError(`Network error: unable to reach ${this.#baseURL}`, { ...options, type: 'network' });
    }
  }
}
