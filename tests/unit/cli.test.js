import { jest } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fake readline: question() answers from a script; when the script runs out it
// behaves like Ctrl+D (closes the interface and rejects the pending prompt)
const rl = {
  answers: [],
  question: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
};
const createInterface = jest.fn(() => rl);
jest.unstable_mockModule('node:readline/promises', () => ({ createInterface }));

process.env.NO_COLOR = '1';
const { CLI } = await import('../../src/cli.js');
const { TaskManager } = await import('../../src/TaskManager.js');
const { APIClient } = await import('../__mocks__/api.js');
const { logger } = await import('../../src/logger.js');

let dir;
let manager;
let output;

const printed = () => output.write.mock.calls.map(([text]) => text).join('');

// Runs the CLI with scripted answers; most scripts end with '0' (Exit)
const run = async (...answers) => {
  rl.answers = answers;
  const cli = new CLI(manager, { input: 'stdin', output });
  await cli.start();
  return cli;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'task-manager-cli-'));
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  manager = new TaskManager({ api: new APIClient(), snapshotFile: join(dir, 'snapshot.json'), exportDir: join(dir, 'exports') });
  await manager.load();

  output = { write: jest.fn() };
  let onClose;
  rl.on.mockImplementation((event, handler) => { onClose = handler; });
  rl.close.mockImplementation(() => onClose());
  rl.question.mockImplementation(async () => {
    if (rl.answers.length) return rl.answers.shift();
    rl.close();
    throw new Error('readline was closed');
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CLI menu', () => {
  test('shows the menu, uses the given streams and says goodbye on exit', async () => {
    await run('  0  '); // answers are trimmed
    expect(createInterface).toHaveBeenCalledWith({ input: 'stdin', output });
    expect(printed()).toContain('Task Manager');
    expect(printed()).toContain('Goodbye!');
  });

  test('reports an invalid option and shows the menu again', async () => {
    await run('42', '0');
    expect(printed()).toContain('✖ "42" is not a valid option');
    expect(printed().match(/Task Manager/g)).toHaveLength(2);
  });

  test('exits quietly when input closes mid-prompt (Ctrl+D)', async () => {
    const cli = await run();
    cli.stop();
    expect(printed()).not.toContain('✖');
    expect(printed()).not.toContain('Goodbye!');
    expect(rl.close).toHaveBeenCalledTimes(1);
  });
});

describe('CLI actions', () => {
  test('1 lists all tasks with user names', async () => {
    await run('1', '0');
    expect(printed()).toContain('All tasks (9)');
    expect(printed()).toContain('Leanne Graham');
  });

  test('2 filters by status, priority and user, with blank answers meaning "any"', async () => {
    await run('2', 'pending', 'high', '1', '2', '', '', '', '0');
    expect(printed()).toContain('Filtered by status: pending, priority: high, user: Leanne Graham (1)');
    expect(printed()).toContain('Filtered by no filters (9)');
  });

  test('2 rejects an unknown status or an invalid user id', async () => {
    await run('2', 'archived', '2', '', '', 'abc', '0');
    expect(printed()).toContain('✖ "archived" is not one of: pending, completed, overdue, urgent');
    expect(printed()).toContain('✖ "abc" is not a valid ID');
  });

  test('3 searches titles and tags, rejecting an empty query', async () => {
    await run('3', 'report', '3', '   ', '0');
    expect(printed()).toContain('Results for "report" (1)');
    expect(printed()).toContain('✖ Search query cannot be empty');
  });

  test('4 sorts by the default keys, rejecting unknown ones', async () => {
    await run('4', '', '4', 'id, color', '0');
    expect(printed()).toContain('Sorted by -priority, dueDate (9)');
    expect(printed()).toContain('✖ Unknown sort key "color"');
  });

  test('5 shows the user ranking with optional details', async () => {
    await run('5', '', '5', '1', '0');
    expect(printed()).toContain('Users by completion rate');
    expect(printed().match(/Leanne Graham \(#1\)/g)).toHaveLength(1);
  });

  test('6 and 7 show the overall statistics and tasks grouped by user', async () => {
    await run('6', '7', '0');
    expect(printed()).toContain('Total tasks   9   (4 completed, 5 open)');
    expect(printed()).toContain('Leanne Graham — 4 tasks, 3 open');
  });

  test('8 toggles a task, reporting unknown ids', async () => {
    await run('8', '2', '8', '999', '0');
    expect(printed()).toContain('✔ Task #2 is now ○ pending');
    expect(printed()).toContain('✖ Task #999 not found');
    expect(manager.getTask(2).completed).toBe(false);
  });

  test('9 exports the data to a JSON file', async () => {
    await run('9', '0');
    expect(printed()).toMatch(/✔ Exported to .*exports.*tasks-.*\.json/);
  });
});
