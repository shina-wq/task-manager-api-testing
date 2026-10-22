import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PRIORITIES, STATUSES } from './models.js';
import { SORT_KEYS } from './taskProcessor.js';
import * as format from './formatters.js';

const { colors } = format;

export class CLI {
  #manager;
  #rl;
  #output;
  #userNames;
  #running = false;
  #closed = false;
  #menu = [
    { key: '1', label: 'List all tasks', run: () => this.#listTasks() },
    { key: '2', label: 'Filter tasks', run: () => this.#filterTasks() },
    { key: '3', label: 'Search tasks', run: () => this.#searchTasks() },
    { key: '4', label: 'Sort tasks', run: () => this.#sortTasks() },
    { key: '5', label: 'User statistics', run: () => this.#userStatistics() },
    { key: '6', label: 'Overall statistics', run: () => this.#overallStatistics() },
    { key: '7', label: 'Tasks grouped by user', run: () => this.#groupedTasks() },
    { key: '8', label: 'Toggle task completion', run: () => this.#toggleTask() },
    { key: '9', label: 'Export to JSON', run: () => this.#exportJSON() },
    { key: '0', label: 'Exit', run: () => this.stop() },
  ];

  constructor(manager, { input = stdin, output = stdout } = {}) {
    this.#manager = manager;
    this.#output = output;
    this.#rl = createInterface({ input, output });
    this.#userNames = new Map(manager.users.map(({ id, name }) => [id, name]));
    this.#rl.on('close', () => {
      this.#closed = true;
      this.#running = false;
    });
  }

  async start() {
    this.#running = true;

    while (this.#running) {
      try {
        this.#print(this.#renderMenu());
        const choice = await this.#ask('Choose an option');
        const item = this.#menu.find(({ key }) => key === choice);

        if (!item) throw new RangeError(`"${choice}" is not a valid option`);
        await item.run();
      } catch (error) {
        if (!this.#running) break; // input closed mid-prompt (Ctrl+C / Ctrl+D)
        this.#print(colors.red(`✖ ${error.message}`));
      }
    }
    this.stop();
  }

  stop() {
    if (this.#closed) return;
    this.#print(colors.dim('Goodbye!'));
    this.#rl.close();
  }

  #print(...lines) {
    this.#output.write(`${lines.join('\n')}\n`);
  }

  #renderMenu() {
    const items = this.#menu.map(({ key, label }) => `  ${colors.cyan(key)}  ${label}`);
    return [format.heading('Task Manager'), ...items].join('\n');
  }

  async #ask(question, fallback = '') {
    const answer = (await this.#rl.question(`${colors.bold('›')} ${question}: `)).trim();
    return answer || fallback;
  }

  // Blank answers mean "any"; anything outside `options` is rejected
  async #choose(question, options) {
    const answer = (await this.#ask(`${question} [${options.join('/')}] (blank for any)`)).toLowerCase();
    if (answer && !options.includes(answer)) throw new RangeError(`"${answer}" is not one of: ${options.join(', ')}`);
    return answer || undefined;
  }

  async #askId(question, { optional = false } = {}) {
    const answer = await this.#ask(question);
    if (!answer && optional) return undefined;

    const id = Number(answer);
    if (!Number.isInteger(id) || id < 1) throw new RangeError(`"${answer}" is not a valid ID`);
    return id;
  }

  #printTasks(title, tasks) {
    this.#print(format.heading(`${title} (${tasks.length})`), format.formatTasks(tasks, { userNames: this.#userNames }));
  }

  #listTasks() {
    this.#printTasks('All tasks', this.#manager.tasks);
  }

  async #filterTasks() {
    const status = await this.#choose('Status', STATUSES);
    const priority = await this.#choose('Priority', PRIORITIES);
    const userId = await this.#askId('User ID (blank for any)', { optional: true });

    const criteria = Object.entries({ status, priority, user: userId && this.#userNames.get(userId) })
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ') || 'no filters';

    this.#printTasks(`Filtered by ${criteria}`, this.#manager.getTasks({ status, priority, userId }));
  }

  async #searchTasks() {
    const query = await this.#ask('Search titles and tags');
    if (!query) throw new RangeError('Search query cannot be empty');
    this.#printTasks(`Results for "${query}"`, this.#manager.getTasks({ query }));
  }

  async #sortTasks() {
    this.#print(colors.dim(`Keys: ${SORT_KEYS.join(', ')} — prefix with "-" for descending`));
    const input = await this.#ask('Sort by (comma-separated)', '-priority, dueDate');
    const sortBy = input.split(',').map((key) => key.trim()).filter(Boolean);
    this.#printTasks(`Sorted by ${sortBy.join(', ')}`, this.#manager.getTasks({ sortBy }));
  }

  async #userStatistics() {
    const { users } = this.#manager.getReport();
    this.#print(format.heading('Users by completion rate'), format.formatUserRanking(users));

    const userId = await this.#askId('User ID for details (blank to skip)', { optional: true });
    if (userId === undefined) return;

    const user = this.#manager.getUser(userId);
    const tasks = this.#manager.getTasks({ userId, sortBy: ['status', '-priority', 'dueDate'] });
    this.#print(format.formatUser(user), '', format.formatTasks(tasks, { userNames: this.#userNames }));
  }

  #overallStatistics() {
    this.#print(format.formatReport(this.#manager.getReport()));
  }

  #groupedTasks() {
    this.#print(format.heading('Tasks grouped by user'), format.formatGroups(this.#manager.groupByUser(), this.#userNames));
  }

  async #toggleTask() {
    const task = this.#manager.toggleTask(await this.#askId('Task ID'));
    this.#print(`${colors.green('✔')} Task #${task.id} is now ${format.formatStatus(task.getStatus())}`);
  }

  async #exportJSON() {
    const filePath = await this.#manager.exportJSON();
    this.#print(`${colors.green('✔')} Exported to ${filePath}`);
  }
}
