# Flowcraft verification — 15 October 2026

Verified against the running Docker stack at http://localhost:3000 and http://localhost:4000 after the Flowcraft Studio upgrade.

| Check | Result |
| --- | --- |
| TypeScript across API, web, and engine | Passed |
| API and engine unit tests | 32 passed |
| Browser and backend integration tests | 18 passed; no scenarios skipped |
| Production web and API builds | Passed locally and in Docker |
| API, worker, web, PostgreSQL, Redis | Running; API, database, and Redis healthy |
| Prisma migrations | All three applied; schema up to date |
| Dependency audit | Zero reported vulnerabilities on host and in the running API container |
| Git whitespace checks | Passed |

## Editor coverage

The editor tests exercised these complete journeys:

- Run the eight-node revenue workflow through expression code, filtering, aggregation, conditional routing, and a report. The example produces three paid orders totaling 533 USD.
- Build a workflow from scratch, configure code, preview a node, duplicate and delete nodes, undo and redo, and execute the saved graph.
- Delete and recreate connections using both the inspector and mouse-drawn handles. Cycle-producing links are excluded.
- Make a real GitHub API request and transform its response into a repository report.
- Import and export workflow JSON, search blocks, validate a graph, arrange the canvas, recover an unsaved draft, and inspect run history.
- Check the editor at a mobile viewport without horizontal overflow.
- Run single-order and zero-paid-order batches through the standard branch.
- Generate a customer-voice report with a real Groq request.
- Activate a webhook, submit a real event, inspect its saved execution in the editor, and deactivate it.

Unit tests additionally cover preserved execution snapshots, actual node inputs, template mappings with native JSON types, nested field conditions, filter array shape, expression time limits, blocked private HTTP destinations, independent schedules, graph branching, cancellation, owner isolation, and queue failures.

## Existing application coverage

All five original demo applications still pass from form submission through webhook, Redis, separate worker, PostgreSQL results, editor validation, and restoration of the same result. The four AI applications made real Groq calls. Additional checks cover history preservation after saving, account-scoped HTTP and WebSocket access, cancellation across processes, and mobile layouts.

Screenshots are under `artifacts/`, including `editor-studio.png`, `editor-revenue-report.png`, `editor-step-inspector.png`, `editor-live-api.png`, and `editor-mobile.png`.

The temporary development preview used during implementation was stopped. The final Docker stack remains running on the normal ports.

## Scope and operation

This verifies the implemented local workflows and UI journeys. Provider availability, service rate limits, and AI output can vary. The code node evaluates JSONata rather than arbitrary JavaScript. External notifications and OAuth account integrations are not built in; HTTP nodes can call configured public services. New runs retain a graph snapshot, while historical runs created before this upgrade do not have the newly introduced snapshot and input records.

See [EDITOR_GUIDE.md](EDITOR_GUIDE.md) for the new editor, [USAGE.md](USAGE.md) for setup and existing applications, and `npm run test:e2e` to repeat the browser checks.
