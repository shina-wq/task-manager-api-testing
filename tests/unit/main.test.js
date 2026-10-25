import { jest } from '@jest/globals';

// main.js runs on import, so each test mocks its dependencies and imports a fresh copy
const runMain = async (load) => {
  jest.resetModules();
  const manager = { load };
  const start = jest.fn().mockResolvedValue();
  const mocks = {
    APIClient: jest.fn(),
    TaskManager: jest.fn(() => manager),
    CLI: jest.fn(() => ({ start })),
  };
  jest.unstable_mockModule('../../src/api.js', () => ({ APIClient: mocks.APIClient }));
  jest.unstable_mockModule('../../src/TaskManager.js', () => ({ TaskManager: mocks.TaskManager }));
  jest.unstable_mockModule('../../src/cli.js', () => ({ CLI: mocks.CLI }));

  await import('../../src/main.js');
  await new Promise(setImmediate); // let main()'s promise chain settle
  return { ...mocks, manager, start };
};

describe('main', () => {
  let log;
  let error;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = undefined; // a failing run sets it; don't fail the Jest process
  });

  describe('successful start', () => {
    let result;

    beforeEach(async () => {
      result = await runMain(jest.fn().mockResolvedValue({ source: 'api', users: 10, tasks: 200 }));
    });

    test('wires an API client with a longer timeout into the TaskManager', () => {
      expect(result.APIClient).toHaveBeenCalledWith({ timeout: 8000, retries: 2 });
      expect(result.TaskManager).toHaveBeenCalledWith({ api: result.APIClient.mock.instances[0] });
    });

    test('logs progress messages in order, without errors', () => {
      expect(log.mock.calls).toEqual([
        ['ℹ', 'Loading tasks from JSONPlaceholder…'],
        ['ℹ', 'Loaded 200 tasks for 10 users (source: api)'],
      ]);
      expect(error).not.toHaveBeenCalled();
    });

    test('loads data before starting the CLI with the manager', () => {
      expect(result.CLI).toHaveBeenCalledWith(result.manager);
      expect(result.manager.load.mock.invocationCallOrder[0]).toBeLessThan(result.start.mock.invocationCallOrder[0]);
    });
  });

  describe('failed start', () => {
    let result;

    beforeEach(async () => {
      result = await runMain(jest.fn().mockRejectedValue(new Error('Unable to load task data')));
    });

    test('logs the error and sets exit code 1', () => {
      expect(error).toHaveBeenCalledWith('✖', 'Unable to load task data');
      expect(process.exitCode).toBe(1);
    });

    test('never starts the CLI', () => {
      expect(result.CLI).not.toHaveBeenCalled();
    });
  });
});
