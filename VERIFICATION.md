# Flowcraft verification — 12 October 2026

Verified against the running local Docker stack at http://localhost:3000 and http://localhost:4000.

| Check | Result |
| --- | --- |
| TypeScript checks across API, web, and engine | Passed |
| API and engine unit tests | 23 passed |
| Browser and backend integration tests | 9 passed; no scenarios skipped |
| Production Next.js and API builds | Passed locally and in Docker |
| API, worker, web, PostgreSQL, Redis startup | Running; API, database, and Redis healthy |
| Prisma migrations | Both applied; schema up to date |
| Dependency audit | Zero reported vulnerabilities on host and in API container |

The browser suite exercised all five applications from example-filled form through webhook submission, Redis queue, separate worker execution, PostgreSQL results, visual editor validation, and restoration of the same result. All four AI applications made live calls to the configured Groq service.

Additional checks covered unpaid and zero-total order routes, retention of earlier node outputs after editing a workflow, preservation of executor types when saving named template nodes, absence of mobile viewport overflow, cancellation across API and worker processes, and account isolation for HTTP reads and WebSocket events. Unit tests also cover missing/blank order IDs, graph cycles, branch selection, disconnected actions, unknown executors, and failed queue submissions.

Browser screenshots are in `artifacts/`. Tests are in `tests/`, `apps/api/src/*.test.ts`, and `packages/workflow-core/src/index.test.ts`.

## Scope

This verifies the supplied local demonstration requirements. AI outputs can vary, and provider/network failures can still occur; failed runs and interrupted polling have recovery paths. The workflows record outcomes and routes rather than sending external email or team notifications. Demo mappings are remembered per account in the current browser. Persistent workflow and execution data lives in PostgreSQL; in-memory demo mode resets when its API restarts.

See [USAGE.md](USAGE.md) for setup, operation, presentation steps, and rerunning the checks.
