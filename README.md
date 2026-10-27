# Flowcraft

**Flowcraft Studio** is the visual workflow workspace at http://localhost:3000/. Build with 16 configurable block types, JSONata code, live web scraping, Apify cloud Actors and datasets, real HTTP requests and Groq AI. Inspect live step progress, saved graph snapshots, searchable datasets, CSV exports, and finished reports. Start with **Live price research** for a working scrape without an API key, or connect Apify in **Integrations**. See [EDITOR_GUIDE.md](EDITOR_GUIDE.md) and [SCRAPING_GUIDE.md](SCRAPING_GUIDE.md).

Flowcraft is a production-style academic workflow automation platform: a React Flow editor, generic TypeScript node registry, DAG validation/execution engine, NestJS API, Prisma/PostgreSQL persistence, Redis-ready queue boundary, and Docker deployment.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev:demo
```

Open `http://localhost:3000/demos` and create an account. The API health endpoint is at `http://localhost:4000/health` and Swagger is at `http://localhost:4000/docs`.

The easiest local demo command is `npm run dev:demo`; it starts both apps and forces demo mode, so PostgreSQL and Redis are not required. For local demo mode, set `DEMO_MODE=true` in `.env`; this disables PostgreSQL and Redis even if their connection variables are present.

Authentication is available through `POST /auth/register`, `POST /auth/login`, and protected `GET /auth/me`. Send the returned token as `Authorization: Bearer <token>`.

## Docker setup

1. Copy `.env.example` to `.env` and replace `JWT_SECRET` with a long random value.
2. Start the database and queue: `docker compose up -d postgres redis`.
3. Apply the schema: `npm run db:generate && npm run db:deploy`.
4. Seed the demo operator and starter workflow: `DEMO_USER_PASSWORD='choose-a-password-of-at-least-12-characters' npm run db:seed`.
5. Start the complete stack: `docker compose up --build -d`.

Open the app at `http://localhost:3000`. The demo account is `demo@workflow.local` with the password supplied to the seed command. It is for local academic demos only; choose a different password for any shared environment. The initial migration is checked in under `prisma/migrations`.

The Compose stack runs PostgreSQL, Redis, the NestJS API, a BullMQ worker, and the Next.js web app. The worker consumes the `workflow-execution` queue and retries failed jobs with exponential backoff (workflows containing Apify Actor use one attempt to reduce duplicate billed runs); the editor and history view receive account-scoped live events over authenticated WebSockets, bridged from the worker through Redis.

PostgreSQL uses the named `postgres_data` volume. `docker compose down` keeps database contents; `docker compose down -v` deletes them. Back up the database before intentionally removing volumes.

If restarting only PostgreSQL, also restart API and worker to refresh their database connections: `docker compose restart postgres`, then `docker compose restart api worker`. A full `docker compose down` followed by `docker compose up -d` starts dependent services after PostgreSQL's health check.

## Architecture

`packages/workflow-core` owns the extensible `NodeRegistry`, node execution contract, cycle detection, branching, and dependency-aware DAG runner. `apps/api` owns HTTP boundaries, authentication, persistence orchestration, and queue integration. `apps/web` owns the editor and UI state. The Prisma schema stores users, workflows, graph nodes/edges, executions, and node execution records.

## Adding a node

Implement `WorkflowNodeExecutor` with a unique `type`, `validate`, and async `execute` method, then register it in `NodeService`. The engine resolves executors from the registry; it contains no per-node type conditionals.

## Verification

```bash
npm run typecheck
npm run build
npm run test
npm run test:e2e
```

The MVP includes manual, webhook, and interval-scheduled execution; node library/editor interactions; cycle and branch validation; JWT authentication; Swagger; Prisma persistence; live execution events; workflow and execution management; and Docker deployment. Cron schedules, OAuth credentials, and team-based access control are future enhancements.

## Real web scraping and Apify

Open http://localhost:3000/?recipe=scrape and select **Run workflow**. The six-node recipe fetches two pages from Books to Scrape, extracts 40 live listings, filters your budget, and builds a shortlist with CSV/JSON exports. This public practice catalogue uses fictional prices; the network requests and extraction are real. Edit the run input to change the budget or page count.

For cloud scrapers, set `APIFY_API_TOKEN` in the ignored `.env`, then run `docker compose up -d --force-recreate api worker`. Open **Integrations**, test the account connection, and load the Apify research recipe. Actor starts have a timeout and cost limit, with a separate Dataset node for results. Missing credentials fail explicitly; results are never simulated. Full instructions: [SCRAPING_GUIDE.md](SCRAPING_GUIDE.md).

## Groq AI Support Triage node

Set `GROQ_API_KEY` in the ignored local `.env` file. The API and worker receive this server-side secret; it is never sent to the browser or stored in a workflow. In Docker mode, recreate the API and worker after changing the key with `docker compose up -d --force-recreate api worker`.

Add **AI Support Triage** after a webhook or other input node. It sends the preceding node's JSON to Groq using the configured model and returns a JSON analysis suitable for a Condition or Logger node. The default instructions produce category, urgency, sentiment, summary, suggested reply, human-review flag, and evidence fields. AI output can be wrong; review suggested replies before sending them to customers. Provider usage may incur charges.

## Live webhook trigger

Add a **Webhook Trigger** as a root node, connect downstream actions, and save the workflow. Select the trigger to see its full endpoint URL in the node configuration (the editor selects a webhook trigger automatically when opening a workflow that has one). Activate the workflow before sending a request. If the workflow is still a draft, select the trigger and choose **Save workflow to generate URL** first. Send JSON to the displayed endpoint; the API queues the event and the worker runs the graph asynchronously:

```bash
curl -X POST http://localhost:4000/webhooks/WORKFLOW_ID/TRIGGER_NODE_ID \
	-H 'content-type: application/json' \
	-d '{"event":"invoice.paid","invoiceId":"inv-123","amount":1250}'
```

The response contains an execution ID and `QUEUED` status. Inspect node inputs/outputs and final status in `/executions`. Webhooks are accepted only for active workflows and valid root webhook trigger nodes.

## End-to-end demo applications

The authenticated workflow-template API provides five ready-to-run examples:

| Template ID | Demo | AI required |
| --- | --- | --- |
| `support-ticket-triage` | Categorize a support ticket, draft a grounded first reply, and flag human review. | Yes |
| `lead-qualification` | Score a sales enquiry and route priority leads separately from standard follow-up. | Yes |
| `feedback-insights` | Summarize review sentiment and themes, and flag feedback for follow-up. | Yes |
| `order-intake-validation` | Check order ID, positive total, and payment status; route each review case separately. | No |
| `it-incident-prioritization` | Classify an incident and route critical reports to urgent human review. | Yes |

Each template starts at a webhook and ends with inspectable workflow output. AI nodes require `GROQ_API_KEY`; order validation does not. These example flows record outcomes in Flowcraft and do not claim to send emails or notify external teams.

The application frontend is available at **http://localhost:3000/demos**. It provides all five forms, progress polling, friendly results, node-output details, and links to each workflow editor. Sign-in opens this gallery. See [USAGE.md](USAGE.md) for a complete walkthrough.

The frontend discovers and instantiates templates using the API:

1. `GET /workflow-templates` with the user's bearer token returns template descriptions, field-level input schemas, sample inputs, expected output fields, and AI requirements.
2. `POST /workflow-templates/:templateId/instantiate` creates an inactive, user-owned workflow with fresh node and edge IDs. The returned workflow contains the webhook trigger node ID.
3. The frontend presents the sample input (or its own form), then sends it to `POST /webhooks/:workflowId/:triggerNodeId`. Activate the workflow first.
4. The webhook response includes an execution ID. Poll `GET /executions/:executionId` with the user's bearer token until it reaches a terminal status; the response includes node events and outputs.

Executions started by a webhook run only the branch rooted at that specific trigger, so separate webhook, manual, or schedule entry points do not accidentally run together.