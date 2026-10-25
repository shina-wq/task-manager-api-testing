# Task Manager API Client — Testing

This project adds a full **Jest test suite** to my Task Manager API Client from the previous lab. The app code is the same as before (apart from three bugs the tests helped me find and fix). The focus of this lab is testing: unit tests, integration tests, mocks, spies and code coverage.

**191 tests, all passing · 100% statements · 92.7% branches · 100% functions · 100% lines**

## The App in Short

The app is a command-line tool that fetches users and todos from the [JSONPlaceholder](https://jsonplaceholder.typicode.com) API. It turns them into `Task`, `PriorityTask` and `User` objects and lets you list, filter, search, sort, toggle and export tasks from a menu. JSONPlaceholder todos don't have a priority, due date or tags, so the app works these out from each todo's id. If the API is down, it falls back to cached data or a saved snapshot.

```
JSONPlaceholder ──► APIClient ──► TaskManager ──► CLI
                    retry, cache,  models +        menu +
                    rate limit     processing      formatters
```

![Task list](docs/screenshots/task-list.png)

## Getting Started

Requires Node.js 20 or newer.

```bash
npm install            # installs Jest (the only dependency, used for testing)
npm start              # run the app
```

## Running the Tests

```bash
npm test               # run all tests
npm run test:watch     # re-run tests when a file changes
npm run test:coverage  # run tests with a coverage report
```

The coverage report is printed in the terminal and saved as a web page in `coverage/index.html`. The command fails if coverage drops below the targets (80% statements, 75% branches, 85% functions, 80% lines).

## Test Structure

```
tests/
├── setup.test.js             # checks that Jest is set up correctly
├── unit/                     # one module at a time
│   ├── models.test.js        # Task, PriorityTask, User
│   ├── taskProcessor.test.js # filter, statistics, group, search, sort
│   ├── utils.test.js         # array behavior, cache, rate limiter, logger (spies)
│   ├── formatters.test.js    # terminal output
│   ├── cli.test.js           # the menu, with keyboard input faked
│   └── main.test.js          # app startup and error messages
├── integration/              # modules working together, network faked
│   ├── api.test.js           # APIClient with a fake fetch
│   └── dataFlow.test.js      # full workflows: API → models → results → report → export
└── __mocks__/
    └── api.js                # fake APIClient with sample users and todos
```

| Type | Tests | What they check |
|---|---|---|
| Unit | 152 | Each class and function on its own, including edge cases and bad input |
| Integration | 39 | The API client with a fake `fetch`, and 4 complete workflows through `TaskManager` |

## What's Tested

- **Models:** constructors, `toggle()`, statuses, overdue and urgent date logic, inheritance, input validation and completion rates.
- **Processing functions:** each one is tested with normal data, empty arrays, `null` input and bad parameters. They are also checked not to change the original array.
- **API client:** correct URLs, reading responses, caching, HTTP 404/500, network errors, timeouts, broken JSON and retries.
- **Workflows:** loading data into models, searching and sorting, building reports, exporting to JSON, and falling back when the API fails.
- **Mocks and spies:** `fetch`, the API module, keyboard input and the clock are faked, so the tests never use the internet. Spies check method calls, array methods and console messages.

All tests give the same result on any day and any computer. They use fixed dates and fake timers, and they only write files to temporary folders.

## Coverage

![Coverage summary](docs/screenshots/coverage.png)

| Metric | Target | Result |
|---|---|---|
| Statements | 80% | 100% |
| Branches | 75% | 92.7% |
| Functions | 85% | 100% |
| Lines | 80% | 100% |

## Bugs Found by the Tests

1. `PriorityTask.toString()` printed *"due no due date"* for tasks without a due date.
2. An invalid due date was saved as `Invalid Date` and crashed the app later. It now throws a `RangeError` straight away.
3. Tags given as a string (`'work'`) were split into letters. They now throw a `TypeError`.

## Documentation

My testing strategy, mocking decisions, coverage analysis, challenges and what I learned are explained in **[TESTING_DOCUMENTATION.md](TESTING_DOCUMENTATION.md)**.

## Tech

- JavaScript (ES modules), Node.js 20+
- Jest 29, run with Node's `--experimental-vm-modules` option for ES module support
