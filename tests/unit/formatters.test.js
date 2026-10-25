import { jest } from '@jest/globals';

// Color support is decided at import time, so disable it before importing for stable output
process.env.NO_COLOR = '1';
const format = await import('../../src/formatters.js');
const { PriorityTask, Task, User } = await import('../../src/models.js');

const task = (overrides = {}) =>
  new PriorityTask({ id: 1, title: 'Write tests', userId: 1, priority: 'high', dueDate: '2100-01-01', ...overrides });

describe('colors', () => {
  test('return plain text when colors are disabled', () => {
    expect(format.colors.red('error')).toBe('error');
    expect(format.colors.bold(42)).toBe('42');
  });

  describe('when the terminal supports color', () => {
    let colorFormat;
    const { isTTY } = process.stdout;

    beforeAll(async () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      jest.resetModules();
      colorFormat = await import('../../src/formatters.js');
    });

    afterAll(() => {
      process.stdout.isTTY = isTTY;
      process.env.NO_COLOR = '1';
    });

    test('wraps text in ANSI codes', () => {
      expect(colorFormat.colors.red('error')).toBe('\x1b[31merror\x1b[0m');
    });

    test.each([
      [70, '\x1b[32m'], // green
      [50, '\x1b[33m'], // yellow
      [10, '\x1b[31m'], // red
    ])('colors a %i%% progress bar by threshold', (percent, code) => {
      expect(colorFormat.progressBar(percent, 10).startsWith(code)).toBe(true);
    });
  });
});

describe('progressBar()', () => {
  test('fills the bar in proportion to the percentage, including the 0% and 100% boundaries', () => {
    expect(format.progressBar(50, 10)).toBe('█████░░░░░ 50%');
    expect(format.progressBar(0, 10)).toBe('░░░░░░░░░░ 0%');
    expect(format.progressBar(100, 10)).toBe('██████████ 100%');
  });

  test('defaults to a 20 character bar', () => {
    expect(format.progressBar(25)).toBe(`${'█'.repeat(5)}${'░'.repeat(15)} 25%`);
  });
});

describe('headings and statuses', () => {
  test('heading() underlines the title to its full length', () => {
    expect(format.heading('Stats')).toBe('\nStats\n─────');
  });

  test('formatStatus() shows an icon for each status, padded to a width', () => {
    expect(['completed', 'pending', 'urgent', 'overdue'].map((status) => format.formatStatus(status)))
      .toEqual(['✔ completed', '○ pending', '‼ urgent', '! overdue']);
    expect(format.formatStatus('pending', 12)).toBe('○ pending   ');
  });

  test('formatStatus() falls back to a question mark for unknown statuses', () => {
    expect(format.formatStatus('archived')).toBe('? archived');
  });
});

describe('formatTable()', () => {
  const columns = [
    { label: 'ID', width: 3, align: 'right', value: ({ id }) => id },
    { label: 'Name', width: 6, value: ({ name }) => name },
  ];

  test('renders a header, a divider and aligned rows', () => {
    expect(format.formatTable([{ id: 7, name: 'Ada' }], columns)).toBe([' ID  Name  ', '───────────', '  7  Ada   '].join('\n'));
  });

  test('truncates long values and styles the padded text', () => {
    expect(format.formatTable([{ id: 1, name: 'Clementine' }], columns)).toContain('Cleme…');
    const styled = [{ ...columns[1], style: (text) => `[${text}]` }];
    expect(format.formatTable([{ name: 'Ada' }], styled).split('\n')[2]).toBe('[Ada   ]');
  });
});

describe('formatTasks()', () => {
  test('shows a message when there are no tasks', () => {
    expect(format.formatTasks([])).toBe('No tasks found.');
  });

  test('shows id, status, priority, due date, user name and title', () => {
    expect(format.formatTasks([task()], { userNames: new Map([[1, 'Ada']]) })).toMatch(/1\s+○ pending\s+high\s+2100-01-01\s+Ada\s+Write tests/);
  });

  test('falls back to the user id and placeholders for missing fields', () => {
    expect(format.formatTasks([new Task({ id: 2, title: 'Plain', userId: 9 })])).toMatch(/2\s+○ pending\s+—\s+—\s+#9\s+Plain/);
  });

  test('limits the rows and says how many were hidden', () => {
    const output = format.formatTasks([1, 2, 3].map((id) => task({ id })), { limit: 2 });
    expect(output.split('\n')).toHaveLength(5); // header, divider, 2 rows, footer
    expect(output).toContain('Showing 2 of 3 tasks');
  });
});

describe('summaries', () => {
  test('formatCounts() lists counts from highest to lowest', () => {
    expect(format.formatCounts({ low: 1, high: 3, medium: 2 })).toBe('high: 3   medium: 2   low: 1');
  });

  test('formatReport() summarizes the statistics, with a dash when there are no tags', () => {
    const report = {
      generatedAt: '2026-01-15T12:00:00.000Z',
      uniqueTags: ['home', 'work'],
      overall: { total: 4, completed: 1, open: 3, completionRate: 25, byStatus: { pending: 3, completed: 1 }, byPriority: { high: 4 } },
    };
    const output = format.formatReport(report);

    expect(output).toContain('Total tasks   4   (1 completed, 3 open)');
    expect(output).toContain('By status     pending: 3   completed: 1');
    expect(output).toContain('Tags          home, work');
    expect(format.formatReport({ ...report, uniqueTags: [] })).toContain('Tags          —');
  });

  test('formatUserRanking() numbers users in order, or says there are none', () => {
    const users = [
      { id: 3, name: 'Grace', total: 2, completed: 2, overdue: 0, completionRate: 100 },
      { id: 1, name: 'Ada', total: 4, completed: 1, overdue: 1, completionRate: 25 },
    ];
    const [, , first, second] = format.formatUserRanking(users).split('\n');

    expect(first).toMatch(/^ 1\s+3\s+Grace/);
    expect(second).toMatch(/^ 2\s+1\s+Ada/);
    expect(format.formatUserRanking([])).toBe('No users found.');
  });

  test('formatUser() shows contact details and task counts by status', () => {
    const user = new User({ id: 1, name: 'Ada', email: 'ada@example.com', company: 'Engines', city: 'London' });
    user.addTask(task({ id: 1, completed: true }), task({ id: 2, dueDate: '2000-01-01' }), task({ id: 3 }));
    const output = format.formatUser(user);

    expect(output).toContain('Ada (#1)');
    expect(output).toContain('Tasks       3   (1 completed, 2 open — 1 overdue, 0 urgent)');
    expect(output).toContain('33%');
  });

  test('formatGroups() previews open tasks per user, falling back to the user id', () => {
    const groups = new Map([
      [1, [task({ id: 1 }), task({ id: 2, completed: true })]],
      [9, [1, 2, 3, 4, 5].map((id) => task({ id, userId: 9 }))],
    ]);
    const output = format.formatGroups(groups, new Map([[1, 'Ada']]));

    expect(output).toContain('Ada — 2 tasks, 1 open');
    expect(output).toContain('User #9 — 5 tasks, 5 open');
    expect(output).toContain('…and 2 more open');
  });
});
