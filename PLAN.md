# Plan — Task Manager API Client

## Decisions
- Node.js 20+ (native `fetch`, `AbortSignal.timeout`, `readline/promises`) — zero dependencies
- JSONPlaceholder todos lack `priority`, `dueDate`, `tags` → derived **deterministically** (priority from `id`, due date offset from `id`, tags from `id` and `userId`)
- Every todo becomes a `PriorityTask`; `Task` remains the base class
- Interactive CLI menu
- Bonuses: caching, sorting, `TaskManager`, rate limiting, JSON export (web UI skipped)

## Structure
```
FEM03-JS-Advanced_task-manager-api/
├── package.json
├── README.md
├── PLAN.md
└── src/
    ├── api.js            # APIClient
    ├── models.js         # Task, PriorityTask, User
    ├── taskProcessor.js  # pure filter/stats/group/search/sort functions
    ├── cache.js          # closure-based memoize with TTL
    ├── rateLimiter.js    # promise-based request spacing
    ├── logger.js         # leveled logger (DEBUG env for debug output)
    ├── TaskManager.js    # controller orchestrating everything
    ├── cli.js            # menu + formatted output
    ├── formatters.js     # pure output formatting (tables, bars, colors)
    └── main.js           # entry point
```
Data flow: **API → raw JSON → validate/map → models → processor → CLI output**

## Checklist

### 0. Setup
- [x] `package.json` (`"type": "module"`, `start` script)
- [x] Folder structure
- [x] README skeleton

### A. API — `api.js`
- [x] `APIClient` with default `baseURL` param, template-literal URLs
- [x] Private `#request(endpoint)`: async/await, try/catch, `AbortSignal.timeout`, `response.ok` check
- [x] Custom `APIError` (`status`, `endpoint`) — distinct messages for network / timeout / HTTP / malformed JSON
- [x] `fetchUsers()`, `fetchTodos()`, `fetchUserTodos(userId)`
- [x] `fetchAll()` using `Promise.all()`
- [x] Promise-chain style (`.then`) in `fetchAll()` and `fetchAllSettled()` (`Promise.allSettled` for partial results)
- [x] Rate limiter (promise-based request spacing)
- [x] Closure cache wrapping fetch methods

### B. Models — `models.js`
- [x] `Task`: `id, title, completed, userId`; `toggle()`, `isOverdue()`, `getStatus()`, `static fromAPI()`
- [x] `PriorityTask extends Task`: `priority, dueDate, tags`; overrides `isOverdue()` and `getStatus()` via `super`
- [x] `User`: `id, name, email, tasks`; `addTask(...tasks)`, `getCompletionRate()`, `getTasksByStatus(status)`
- [x] Optional chaining for nested API fields (`company?.name`, `address?.city`)

### C/D. Processing — `taskProcessor.js`
- [x] `filterByStatus`, `filterByUser`, `filterByPriority`
- [x] `calculateStatistics` via `reduce` (totals, completion rate, by-priority, overdue)
- [x] `groupByUser` → `Map`
- [x] `getUniqueTags` → `Set`
- [x] `searchTasks(tasks, query)` (case-insensitive)
- [x] `sortTasks(tasks, ...criteria)` multi-key comparator
- [x] Pure functions, non-mutating (spread clones)

### 4. Error Handling
- [x] Skip + log malformed records (`toModels`)
- [x] Graceful empty-response output
- [x] Retry → in-memory cache → partial data → on-disk snapshot (`.cache/`) → `DataUnavailableError`

### 5. CLI — `cli.js`
- [x] `readline/promises` menu: list, filter, search, user stats, overall stats, group by user, sort, toggle, export, quit
- [x] Template-literal formatted output (aligned columns, status icons)

### Bonus
- [x] `TaskManager` controller
- [x] JSON export to `exports/` via `fs/promises`

### Finish
- [x] README: setup, run, architecture, ES6+ feature map
- [x] Manual run-through of every menu path (incl. offline)
