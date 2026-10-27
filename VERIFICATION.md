# Flowcraft verification — 15 October 2026

Verified against the running Docker stack at http://localhost:3000 and http://localhost:4000 after the live scraping and Apify integration upgrade.

| Check | Result |
| --- | --- |
| TypeScript across API, web, and engine | Passed |
| API, web utilities, and engine unit tests | 81 passed (58 API, 11 web, 12 engine) |
| Browser and backend integration tests | 24 passed; no scenarios skipped |
| Production web and API builds | Passed in Docker; API, web, and engine typechecks passed on host |
| API, worker, web, PostgreSQL, Redis | Running; API, database, and Redis healthy |
| Prisma migrations | All three applied; schema up to date |
| Dependency audit | Zero reported vulnerabilities on host and in the running API container |
| Git whitespace checks | Passed |

## Live scraping and integration coverage

The final full browser suite passed all 24 scenarios against the rebuilt Docker stack. The native research recipe made real public HTTP requests, retrieved 40 book listings across two pages, extracted numeric prices and absolute source links, filtered the budget, and produced its report. CSV contents, search, numeric sorting, source provenance, and zero-match results were verified. Books to Scrape is a practice catalogue with fictional prices; the network requests and extraction were live.

Additional browser checks covered extraction-field additions and removals without duplicate generated names, typing a complete page-count mapping character by character, persistence after reload, rejection of invalid selectors, private destination rejection, and mobile integration setup. The filter's independent preview returned the same shortlist using the last run's upstream context. Workflow import preserved a direct reference to a regenerated trigger ID. An unconnected Apify Actor was skipped while the selected manual workflow completed without credentials.

Apify is implemented using its real Actor-run and dataset endpoints. This environment has no `APIFY_API_TOKEN`, so no live billable Actor was launched. Browser checks verified the authenticated connection-status endpoint, explicit missing-token failure in the actual worker, and the setup modal. Fourteen API tests exercise authenticated requests, polling, result normalization, dataset pagination, bounded responses, provider failures, credential redaction, time/cost options, and remote abort requests through injected provider responses. A configured account is still needed to verify an actual Apify Actor run.

Runtime tests also verify durable progress without premature completion, retained remote-run metadata on failure, cancellation hooks, and single-attempt queue settings for graphs containing an Actor. Web tests cover CSV quoting/formula protection and node-reference remapping during import.

New screenshots: `artifacts/editor-scraping-report.png`, `artifacts/editor-scraping-fields.png`, and `artifacts/editor-integrations.png`.

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

The final Docker stack remains running on the normal ports. Temporary diagnostic browser sessions were closed.

## Scope and operation

This verifies the implemented local workflows and UI journeys. Provider availability, service rate limits, and AI output can vary. The code node evaluates JSONata rather than arbitrary JavaScript. External notifications and OAuth account integrations are not built in; HTTP nodes can call configured public services. New runs retain a graph snapshot, while historical runs created before this upgrade do not have the newly introduced snapshot and input records.

See [SCRAPING_GUIDE.md](SCRAPING_GUIDE.md) for scraping and Apify, [EDITOR_GUIDE.md](EDITOR_GUIDE.md) for the editor, [USAGE.md](USAGE.md) for setup and existing applications, and `npm run test:e2e` to repeat the browser checks.
