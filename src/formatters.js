// Pure string formatters for CLI output — no I/O here
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const colors = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

const STATUS_STYLES = {
  completed: ['✔', colors.green],
  pending: ['○', colors.cyan],
  urgent: ['‼', colors.yellow],
  overdue: ['!', colors.red],
};

const PRIORITY_STYLES = { high: colors.red, medium: colors.yellow, low: colors.dim };

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const pad = (text, width, align = 'left') => (align === 'right' ? text.padStart(width) : text.padEnd(width));
const formatDate = (date) => date?.toISOString().slice(0, 10) ?? '—';

export const progressBar = (percent, width = 20) => {
  const filled = Math.round((percent / 100) * width);
  const style = percent >= 60 ? colors.green : percent >= 40 ? colors.yellow : colors.red;
  return `${style('█'.repeat(filled))}${colors.dim('░'.repeat(width - filled))} ${percent}%`;
};

export const heading = (title) => `\n${colors.bold(title)}\n${colors.dim('─'.repeat(title.length))}`;

const statusLabel = (status) => `${STATUS_STYLES[status]?.[0] ?? '?'} ${status}`;
const statusStyle = (status) => STATUS_STYLES[status]?.[1] ?? String;

export const formatStatus = (status, width = 0) => statusStyle(status)(statusLabel(status).padEnd(width));

// Columns: { label, width, value: (row) => text, align?, style?: (text, row) => text }
// Text is padded before styling so ANSI codes never break alignment
export const formatTable = (rows, columns) => {
  const header = columns.map(({ label, width, align }) => pad(label, width, align)).join('  ');
  const lines = rows.map((row) => columns
    .map(({ value, width, align, style = (text) => text }) => style(pad(truncate(String(value(row)), width), width, align), row))
    .join('  '));

  return [colors.bold(header), colors.dim('─'.repeat(header.length)), ...lines].join('\n');
};

export const formatTasks = (tasks, { userNames = new Map(), limit = 20 } = {}) => {
  if (!tasks.length) return colors.dim('No tasks found.');

  const table = formatTable(tasks.slice(0, limit), [
    { label: 'ID', width: 4, align: 'right', value: ({ id }) => id },
    { label: 'Status', width: 11, value: (task) => statusLabel(task.getStatus()), style: (text, task) => statusStyle(task.getStatus())(text) },
    { label: 'Priority', width: 8, value: ({ priority = '—' }) => priority, style: (text, { priority }) => (PRIORITY_STYLES[priority] ?? String)(text) },
    { label: 'Due', width: 10, value: ({ dueDate }) => formatDate(dueDate) },
    { label: 'User', width: 18, value: ({ userId }) => userNames.get(userId) ?? `#${userId}` },
    { label: 'Title', width: 40, value: ({ title }) => title },
  ]);

  const footer = tasks.length > limit ? `\n${colors.dim(`Showing ${limit} of ${tasks.length} tasks`)}` : '';
  return `${table}${footer}`;
};

export const formatCounts = (counts) => Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .map(([key, count]) => `${key}: ${colors.bold(count)}`)
  .join('   ');

export const formatReport = ({ overall, uniqueTags, generatedAt }) => {
  const { total, completed, open, completionRate, byStatus, byPriority } = overall;
  return [
    heading('Overall Statistics'),
    `Total tasks   ${colors.bold(total)}   (${completed} completed, ${open} open)`,
    `Completion    ${progressBar(completionRate)}`,
    `By status     ${formatCounts(byStatus)}`,
    `By priority   ${formatCounts(byPriority)}`,
    `Tags          ${uniqueTags.join(', ') || '—'}`,
    colors.dim(`Generated ${generatedAt}`),
  ].join('\n');
};

export const formatUserRanking = (users) => {
  if (!users.length) return colors.dim('No users found.');

  return formatTable(users.map((user, index) => ({ rank: index + 1, ...user })), [
    { label: '#', width: 2, align: 'right', value: ({ rank }) => rank },
    { label: 'ID', width: 3, align: 'right', value: ({ id }) => id },
    { label: 'Name', width: 24, value: ({ name }) => name },
    { label: 'Tasks', width: 5, align: 'right', value: ({ total }) => total },
    { label: 'Done', width: 4, align: 'right', value: ({ completed }) => completed },
    { label: 'Overdue', width: 7, align: 'right', value: ({ overdue }) => overdue },
    { label: 'Completion', width: 10, value: ({ completionRate }) => `${completionRate}%`, style: (_, { completionRate }) => progressBar(completionRate, 15) },
  ]);
};

export const formatUser = (user) => {
  const { id, name, email, company, city, tasks } = user;
  const [completed, open, overdue, urgent] = ['completed', 'pending', 'overdue', 'urgent']
    .map((status) => user.getTasksByStatus(status).length);

  return [
    heading(`${name} (#${id})`),
    `Email       ${email}`,
    `Company     ${company}`,
    `City        ${city}`,
    `Tasks       ${tasks.length}   (${completed} completed, ${open} open — ${overdue} overdue, ${urgent} urgent)`,
    `Completion  ${progressBar(user.getCompletionRate())}`,
  ].join('\n');
};

export const formatGroups = (groups, userNames = new Map(), preview = 3) => [...groups]
  .map(([userId, tasks]) => {
    const open = tasks.filter(({ completed }) => !completed);
    const lines = open.slice(0, preview).map((task) => `   ${formatStatus(task.getStatus(), 11)}  ${truncate(task.title, 50)}`);
    const more = open.length > preview ? [colors.dim(`   …and ${open.length - preview} more open`)] : [];
    return [`${colors.bold(userNames.get(userId) ?? `User #${userId}`)} — ${tasks.length} tasks, ${open.length} open`, ...lines, ...more].join('\n');
  })
  .join('\n\n');
