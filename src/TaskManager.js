import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APIClient } from './api.js';
import { PriorityTask, User, PRIORITIES, STATUSES } from './models.js';
import * as processor from './taskProcessor.js';
import { logger } from './logger.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export class DataUnavailableError extends Error {
  constructor(cause) {
    super(`Unable to load task data (${cause.message}). Check your internet connection and try again.`, { cause });
    this.name = 'DataUnavailableError';
  }
}

export class TaskManager {
  #api;
  #snapshotFile;
  #exportDir;
  #users = [];
  #tasks = [];
  #loaded = false;

  constructor({
    api = new APIClient(),
    snapshotFile = join(ROOT, '.cache', 'snapshot.json'),
    exportDir = join(ROOT, 'exports'),
  } = {}) {
    this.#api = api;
    this.#snapshotFile = snapshotFile;
    this.#exportDir = exportDir;
  }

  /**
   * Loads data from the API (cached + retried by APIClient).
   * Keeps partial results when one endpoint fails, and falls back to
   * the last saved snapshot when the API is unreachable.
   */
  async load() {
    let data;
    let source = 'api';

    try {
      const { errors, ...result } = await this.#api.fetchAllSettled();
      data = result;

      if (errors.length) {
        errors.forEach(({ message }) => logger.warn(`${message} — continuing with partial data`));
        source = 'partial'; // don't overwrite a complete snapshot with partial data
      } else {
        await this.#saveSnapshot(data);
      }
    } catch (apiError) {
      logger.warn(`${apiError.message} — trying offline snapshot`);
      data = await this.#readSnapshot().catch(() => {
        throw new DataUnavailableError(apiError);
      });
      source = 'snapshot';
    }

    this.#hydrate(data);
    return { source, users: this.#users.length, tasks: this.#tasks.length };
  }

  get users() {
    return [...this.#ensureLoaded().#users];
  }

  get tasks() {
    return [...this.#ensureLoaded().#tasks];
  }

  getUser(id) {
    const user = this.#ensureLoaded().#users.find((candidate) => candidate.id === id);
    if (!user) throw new RangeError(`User #${id} not found`);
    return user;
  }

  getTask(id) {
    const task = this.#ensureLoaded().#tasks.find((candidate) => candidate.id === id);
    if (!task) throw new RangeError(`Task #${id} not found`);
    return task;
  }

  // Combines filters, search and sorting in one call; every criterion is optional
  getTasks({ status, userId, priority, query, sortBy = [] } = {}) {
    let result = this.tasks;

    if (status) {
      if (!STATUSES.includes(status)) throw new RangeError(`Unknown status "${status}". Use one of: ${STATUSES.join(', ')}`);
      result = processor.filterByStatus(result, status);
    }
    if (userId !== undefined) result = processor.filterByUser(result, this.getUser(userId).id);
    if (priority) {
      if (!PRIORITIES.includes(priority)) throw new RangeError(`Unknown priority "${priority}". Use one of: ${PRIORITIES.join(', ')}`);
      result = processor.filterByPriority(result, priority);
    }
    if (query) result = processor.searchTasks(result, query);

    return sortBy.length ? processor.sortTasks(result, ...sortBy) : result;
  }

  groupByUser() {
    return processor.groupByUser(this.tasks);
  }

  getTags() {
    return processor.getUniqueTags(this.tasks);
  }

  getReport() {
    return processor.generateReport(this.users, this.tasks);
  }

  // Local only — JSONPlaceholder does not persist changes
  toggleTask(id) {
    return this.getTask(id).toggle();
  }

  async exportJSON(fileName = `tasks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) {
    const filePath = join(this.#exportDir, basename(fileName)); // basename blocks path traversal

    try {
      await mkdir(this.#exportDir, { recursive: true });
      await writeFile(filePath, JSON.stringify({ report: this.getReport(), users: this.users }, null, 2));
      return filePath;
    } catch (error) {
      throw new Error(`Export to ${filePath} failed: ${error.message}`, { cause: error });
    }
  }

  #hydrate({ users = [], todos = [] } = {}) {
    if (!todos.length) logger.warn('No tasks were returned');

    const tasks = processor.toModels(todos, (todo) => PriorityTask.fromAPI(todo));
    const groups = processor.groupByUser(tasks);
    const userList = processor.toModels(users, (raw) => User.fromAPI(raw));
    userList.forEach((user) => user.addTask(...(groups.get(user.id) ?? [])));

    const userIds = new Set(userList.map(({ id }) => id));
    const orphans = tasks.filter(({ userId }) => !userIds.has(userId)).length;
    if (orphans) logger.warn(`${orphans} task(s) belong to unknown users`);

    this.#users = userList;
    this.#tasks = tasks;
    this.#loaded = true;
  }

  #ensureLoaded() {
    if (!this.#loaded) throw new Error('Data not loaded yet — call load() first');
    return this;
  }

  async #saveSnapshot(data) {
    try {
      await mkdir(dirname(this.#snapshotFile), { recursive: true });
      await writeFile(this.#snapshotFile, JSON.stringify(data));
    } catch (error) {
      logger.warn(`Could not save offline snapshot: ${error.message}`);
    }
  }

  async #readSnapshot() {
    const data = JSON.parse(await readFile(this.#snapshotFile, 'utf8'));
    if (!Array.isArray(data?.users) || !Array.isArray(data?.todos)) throw new TypeError('Corrupt snapshot');
    logger.warn('Using offline snapshot — data may be out of date');
    return data;
  }
}
