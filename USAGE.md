# Using Flowcraft

## Open the running system

- Application gallery: http://localhost:3000/demos
- Sign in / create account: http://localhost:3000/login
- Visual workflow editor: http://localhost:3000/
- Saved workflows: http://localhost:3000/workflows
- Execution history: http://localhost:3000/executions
- API documentation: http://localhost:4000/docs

Create an account with your name, email, and a password of at least eight characters, or sign in with your existing account. Sign-in opens the application gallery.

## Run an application

1. Select one of the five applications. The form starts with an example, so you can demonstrate it immediately.
2. Change the fields as needed. Asterisks identify required fields. Numeric fields submit actual JSON numbers.
3. Select the application’s submit button. On its first run, Flowcraft creates and activates your personal workflow from the template. Later submissions use the same workflow.
4. Watch the progress panel. The backend queues the run in Redis; the worker processes the graph and stores each node’s output in PostgreSQL.
5. Review the final outcome and fields. Open **Inspect steps and underlying outputs** for the complete node timeline.
6. Choose **Reveal workflow** to show the graph in the editor. Choose **Back to application** to return to the saved result and submitted values.

The browser remembers each application’s workflow ID, last execution ID, and submitted form values separately for each account. Refreshing or returning from the editor restores the last run. Clearing browser storage or switching browsers starts a separate demo workflow. Saved workflows and execution history remain in PostgreSQL. Deleting a workflow also deletes its executions; editing a workflow preserves past node outputs.

If a progress request is interrupted, use **Resume checking**. If a run fails, its error appears in the result panel; correct the configuration or input and submit again. **Cancel run** stops further workflow steps. A request already sent to an external service may finish before cancellation is observed. Failed queue jobs may be retried by the worker.

## What each application returns

| Application | Information to submit | Result |
| --- | --- | --- |
| Customer Support Triage | Customer message; optional ticket and order context | Category, urgency, summary, suggested reply, evidence, human-review flag |
| Lead Qualification | Customer need; optional company, budget, timeline, contact | Fit score, summary, needs, next step, priority or standard route |
| Customer Feedback Insights | Review or survey comment; optional product and rating | Sentiment, theme, summary, improvement suggestion, follow-up flag |
| Order Intake Validation | Order ID, total, payment status; optional email and currency | Order Ready or a specific review route |
| IT Incident Prioritization | Affected service, incident description, impact | Category, urgency, summary, recommended action, urgent or standard review route |

For order validation, use `paid` for payment status and a total greater than zero to get **Order Ready**. Try `pending` for **Review Payment Status** or `0` for **Review Invalid Total**. A webhook payload with a missing or blank order ID routes to **Review Missing Order ID**; the application form requires an ID before submission.

The four AI applications use the server-side Groq key. They produce suggestions for review. The workflows record results and routes; they do not send real email, Slack messages, or notifications.

## Run live web scraping

Open http://localhost:3000/?recipe=scrape and click **Run workflow**. Flowcraft fetches a real public practice catalogue, follows the next page, extracts book titles/prices/links, filters books at or below your budget, and shows a buying shortlist. Search or sort its records and use **CSV** or **Download** for exports. Change `maxPrice` or `maxPages` in **Run input** and rerun.

Select **Collect live book listings** to edit CSS selectors, add extraction fields, and control pagination. The native scraper reads HTML; JavaScript-rendered sites need a browser Actor. Open **Integrations** to check Apify setup and load its cloud scraping recipe. Apify requires a server-side `APIFY_API_TOKEN` in `.env` and may consume credits. See [SCRAPING_GUIDE.md](SCRAPING_GUIDE.md) for setup and limits.

## Start or restart the complete stack

Docker Desktop must be running. From the project folder:

```bash
cp .env.example .env
```

Do this only on a fresh setup; keep your existing `.env` when restarting. Set `JWT_SECRET` to a long random secret, and set `GROQ_API_KEY` for the AI applications. Keep `.env` private.

```bash
docker compose up --build -d
```

The API automatically applies checked-in database migrations on startup. PostgreSQL retains data in its named volume. The stack starts PostgreSQL, Redis, API, worker, and web services. Create an account in the browser; seeding is optional.

After changing the AI key or other environment settings:

```bash
docker compose up -d --force-recreate api worker
```

To inspect service status and logs:

```bash
docker compose ps
docker compose logs --tail=50 api worker
```

To stop services while retaining data:

```bash
docker compose down
```

Avoid adding `-v` unless you intend to delete the database volume.

## Develop locally with persistence

Use Node.js 22.19 or later. Stop the Docker API, worker, and web to release ports 3000 and 4000, while retaining PostgreSQL and Redis:

```bash
docker compose stop api worker web
docker compose up -d postgres redis
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

In a second terminal:

```bash
npm run worker
```

Set `DEMO_MODE=false` in the root `.env`; the API and worker read this file. The defaults connect to PostgreSQL on port 5432 and Redis on port 6379. The Next.js browser API URL defaults to localhost:4000.

For an in-memory demonstration without PostgreSQL or Redis:

```bash
npm run dev:demo
```

This mode uses the same forms and engine with an in-process queue. Accounts, workflows, and runs disappear when the API restarts. The AI applications still need a Groq key. Order validation works without one.

## Edit and extend workflows

The editor has been upgraded to Flowcraft Studio, with code editing, data mappings, node previews, live execution inspection, undo/redo, import/export, and five working recipes, including live web scraping and Apify. See [EDITOR_GUIDE.md](EDITOR_GUIDE.md) for the complete walkthrough.

Open **Workflows**, then open a saved workflow. Click a node to inspect its configuration. Add blocks from the library, connect their handles, and configure each action. Condition nodes have separate TRUE and FALSE outputs. Comparison values support numbers, booleans, and plain text. Use the validation button before saving. Activate the workflow to accept webhooks or schedules; deactivate it to stop new trigger events.

A webhook’s URL appears when you select its trigger after saving. The API accepts JSON only for active workflows and root webhook triggers. Treat webhook URLs as private integration endpoints; possession of an active URL allows submitting an event.

Schedule triggers support an interval in milliseconds of at least 1000. Active schedules restore when the API restarts. Run a single API instance when using interval schedules. Multi-instance scheduling, cron expressions, OAuth integrations, and team access are outside this local demonstration.

## Verify changes

```bash
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Browser tests use installed Google Chrome and a running Docker stack at localhost:3000/4000. They create temporary QA accounts and remove their test workflows after execution. With a Groq key, the tests make real AI calls; without it the AI browser scenarios skip. Screenshots are written to `artifacts/`.
