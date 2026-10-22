import { PRIORITIES } from './models.js';
import { logger } from './logger.js';

const percentage = (part, total) => (total ? Math.round((part / total) * 100) : 0);

// Counts items per key; keyFn may return a single key or an array of keys
const countBy = (items, keyFn) => items.reduce((counts, item) => {
  [keyFn(item)].flat().forEach((key) => { counts[key] = (counts[key] ?? 0) + 1; });
  return counts;
}, {});

// Transform raw API records into models, skipping (and logging) malformed ones
export const toModels = (records = [], factory) => records
  .map((record) => {
    try {
      return factory(record);
    } catch (error) {
      logger.warn(`Skipped record — ${error.message}`);
      return null;
    }
  })
  .filter(Boolean);

export const filterByStatus = (tasks, status) => tasks.filter((task) => task.hasStatus(status));

export const filterByUser = (tasks, userId) => tasks.filter((task) => task.userId === userId);

export const filterByPriority = (tasks, ...priorities) => tasks.filter(({ priority }) => priorities.includes(priority));

// Every whitespace-separated term must appear in the title or a tag (case-insensitive)
export const searchTasks = (tasks, query = '') => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter(({ title, tags = [] }) => {
    const haystack = [title, ...tags].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
};

export const calculateStatistics = (tasks = []) => {
  const total = tasks.length;
  const completed = tasks.reduce((sum, { completed }) => sum + Number(completed), 0);
  const byStatus = countBy(tasks, (task) => task.getStatus());

  return {
    total,
    completed,
    open: total - completed,
    overdue: byStatus.overdue ?? 0,
    completionRate: percentage(completed, total),
    byStatus,
    byPriority: countBy(tasks.filter(({ priority }) => priority), ({ priority }) => priority),
    byTag: countBy(tasks, ({ tags = [] }) => tags),
  };
};

export const groupByUser = (tasks) => tasks.reduce((groups, task) => {
  groups.set(task.userId, [...(groups.get(task.userId) ?? []), task]);
  return groups;
}, new Map());

export const getUniqueTags = (tasks) => new Set(tasks.flatMap(({ tags = [] }) => tags));

const comparators = {
  id: (a, b) => a.id - b.id,
  title: (a, b) => a.title.localeCompare(b.title),
  status: (a, b) => Number(a.completed) - Number(b.completed),
  priority: (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority),
  dueDate: (a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity),
  userId: (a, b) => a.userId - b.userId,
};

export const SORT_KEYS = Object.keys(comparators);

// Multi-criteria sort, e.g. sortTasks(tasks, '-priority', 'dueDate') — a leading '-' sorts descending
export const sortTasks = (tasks, ...criteria) => {
  const compareFns = criteria.map((criterion) => {
    const descending = criterion.startsWith('-');
    const key = descending ? criterion.slice(1) : criterion;
    const compare = comparators[key];

    if (!compare) throw new RangeError(`Unknown sort key "${key}". Use one of: ${SORT_KEYS.join(', ')}`);
    return descending ? (a, b) => compare(b, a) : compare;
  });

  // NaN (e.g. Infinity - Infinity) is falsy, so ties fall through to the next criterion
  return [...tasks].sort((a, b) => compareFns.reduce((result, compare) => result || compare(a, b), 0));
};

// Aggregated metrics for the whole dataset, with users ranked by completion rate
export const generateReport = (users = [], tasks = []) => ({
  generatedAt: new Date().toISOString(),
  overall: calculateStatistics(tasks),
  uniqueTags: [...getUniqueTags(tasks)].sort(),
  users: users
    .map(({ id, name, tasks: userTasks }) => {
      const { total, completed, overdue, completionRate } = calculateStatistics(userTasks);
      return { id, name, total, completed, overdue, completionRate };
    })
    .sort((a, b) => b.completionRate - a.completionRate),
});
