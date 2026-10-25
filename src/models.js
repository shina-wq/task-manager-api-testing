export const PRIORITIES = ['low', 'medium', 'high'];
export const STATUSES = ['pending', 'completed', 'overdue', 'urgent'];
export const TAGS = ['work', 'personal', 'home', 'health', 'finance', 'learning'];

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_WINDOW_DAYS = 3;

const invalid = (kind, raw) => new TypeError(`Malformed ${kind}: ${JSON.stringify(raw)}`);

export class Task {
  constructor({ id, title, completed = false, userId }) {
    this.id = id;
    this.title = title;
    this.completed = completed;
    this.userId = userId;
  }

  // Validates raw API data and returns only the fields a Task needs
  static parse(raw) {
    const { id, title, completed, userId } = raw ?? {};
    const isValid = Number.isInteger(id) && Number.isInteger(userId)
      && typeof title === 'string' && typeof completed === 'boolean';

    if (!isValid) throw invalid('task', raw);
    return { id, title: title.trim(), completed, userId };
  }

  static fromAPI(raw) {
    return new Task(Task.parse(raw));
  }

  toggle() {
    this.completed = !this.completed;
    return this;
  }

  // Base tasks have no due date, so they can never be overdue
  isOverdue() {
    return false;
  }

  getStatus() {
    return this.completed ? 'completed' : 'pending';
  }

  // 'pending' matches any incomplete task; other statuses match exactly
  hasStatus(status) {
    return status === 'pending' ? !this.completed : this.getStatus() === status;
  }

  toString() {
    return `[${this.completed ? '✔' : ' '}] #${this.id} ${this.title}`;
  }

  toJSON() {
    return { ...this, status: this.getStatus() };
  }
}

export class PriorityTask extends Task {
  constructor({ priority = 'medium', dueDate = null, tags = [], ...task }) {
    super(task);
    if (!PRIORITIES.includes(priority)) throw new RangeError(`Invalid priority: ${priority}`);
    if (!Array.isArray(tags)) throw new TypeError(`Tags must be an array: ${JSON.stringify(tags)}`);

    this.priority = priority;
    this.dueDate = dueDate ? new Date(dueDate) : null;
    if (Number.isNaN(this.dueDate?.getTime())) throw new RangeError(`Invalid due date: ${dueDate}`);
    this.tags = [...new Set(tags)];
  }

  // JSONPlaceholder has no priority/dueDate/tags, so derive them deterministically from the ids
  static derive({ id, userId }, now = new Date()) {
    const today = new Date(now).setUTCHours(0, 0, 0, 0);
    return {
      priority: PRIORITIES[id % PRIORITIES.length],
      dueDate: new Date(today + (((id * 7) % 30) - 10) * DAY_MS), // -10 to +19 days from today
      tags: [TAGS[id % TAGS.length], TAGS[userId % TAGS.length]],
    };
  }

  static fromAPI(raw, now = new Date()) {
    const task = Task.parse(raw);
    return new PriorityTask({ ...task, ...PriorityTask.derive(task, now) });
  }

  // A task stays on time until the end of its due day (UTC)
  isOverdue(now = new Date()) {
    if (this.completed || !this.dueDate) return false;
    return new Date(this.dueDate).setUTCHours(23, 59, 59, 999) < now;
  }

  isUrgent(now = new Date()) {
    if (this.completed || this.priority !== 'high' || !this.dueDate) return false;
    return this.dueDate - now <= URGENT_WINDOW_DAYS * DAY_MS;
  }

  getStatus(now = new Date()) {
    if (this.isOverdue(now)) return 'overdue';
    if (this.isUrgent(now)) return 'urgent';
    return super.getStatus();
  }

  toString() {
    const due = this.dueDate ? `due ${this.dueDate.toISOString().slice(0, 10)}` : 'no due date';
    return `${super.toString()} (${this.priority}, ${due})`;
  }
}

export class User {
  constructor({ id, name, email, company = 'N/A', city = 'Unknown', tasks = [] }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.company = company;
    this.city = city;
    this.tasks = [];
    this.addTask(...tasks);
  }

  static fromAPI(raw) {
    const { id, name, email, company, address } = raw ?? {};
    if (!Number.isInteger(id) || typeof name !== 'string' || typeof email !== 'string') {
      throw invalid('user', raw);
    }
    return new User({ id, name, email, company: company?.name, city: address?.city });
  }

  addTask(...tasks) {
    tasks.forEach((task) => {
      if (!(task instanceof Task)) throw new TypeError(`Not a Task: ${JSON.stringify(task)}`);
      if (task.userId !== this.id) throw new RangeError(`Task #${task.id} does not belong to user #${this.id}`);
    });
    this.tasks.push(...tasks);
    return this;
  }

  getCompletionRate() {
    if (!this.tasks.length) return 0;
    const done = this.tasks.filter(({ completed }) => completed).length;
    return Math.round((done / this.tasks.length) * 100);
  }

  getTasksByStatus(status) {
    return this.tasks.filter((task) => task.hasStatus(status));
  }

  toJSON() {
    return { ...this, completionRate: this.getCompletionRate() };
  }
}
