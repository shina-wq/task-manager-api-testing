import { APIClient } from './api.js';
import { TaskManager } from './TaskManager.js';
import { CLI } from './cli.js';
import { logger } from './logger.js';

const main = async () => {
  const manager = new TaskManager({ api: new APIClient({ timeout: 8000, retries: 2 }) });

  logger.info('Loading tasks from JSONPlaceholder…');
  const { source, users, tasks } = await manager.load();
  logger.info(`Loaded ${tasks} tasks for ${users} users (source: ${source})`);

  await new CLI(manager).start();
};

main().catch((error) => {
  logger.error(error.message);
  logger.debug(error.stack);
  process.exitCode = 1;
});
