# Flowcraft Studio

Open **http://localhost:3000/** after signing in. The demo applications remain at `/demos`.

## A first run worth presenting

The editor opens the **Revenue operations** recipe. Its example contains four customer orders with line items and payment states.

1. Open **Run input** to inspect or edit the starting JSON.
2. Click **Run workflow**. Flowcraft saves the graph, queues the run in Redis, and executes it in the background worker.
3. The Code / Expression node calculates each order total. Filter Items keeps paid orders, Summarize Items calculates metrics, and the Condition chooses priority or standard fulfillment.
4. The example produces **three paid orders totaling 533 USD**, routed to **Priority fulfillment**. The final report includes metrics and an order table.
5. Click a step in the execution panel to compare its actual input and output. Click a canvas node and open **Input & output** for the same data beside its parameters.
6. Change the input to a single paid order worth 50 USD and run again. It follows **Standard fulfillment**. An empty paid-order list is handled as a zero-total batch.

These are calculated results. Editing the quantities, prices, payment statuses, expressions, or condition threshold changes the result.

## Build your own workflow

Click **Recipes** and choose **Start from a blank canvas**, or use the blank-workflow button in Workflow details.

- Click a block in the library to add it. When a node is selected, a new action is connected after it automatically.
- Drag a block from the library to the canvas to place it independently.
- Connect an output handle to another node’s input handle. Conditions expose separate **true** and **false** outputs.
- You can also use **Connect next step** in the inspector. Links that would create a cycle, duplicate a connection, or connect into a trigger are excluded.
- Click a connection to delete it, or select a node and use **Duplicate** or **Delete**.
- Use **Undo**, **Redo**, **Auto layout**, **Fit canvas**, zoom controls, and the minimap to organize the graph.
- Use **Toggle inspector** or **Blocks** to give the canvas more room.
- Use **Validate** before running. Errors appear with the relevant node name.

Unsaved graph and code drafts are stored in the current browser per account and workflow. A saved workflow lives in PostgreSQL. Avoid clearing browser storage if you need an unsaved draft. Switching to another recipe after making changes asks before replacing the current draft.

## Available blocks

| Block | What it does |
| --- | --- |
| Manual Trigger | Starts with the JSON supplied in Run input |
| Webhook Trigger | Accepts JSON POST events when the workflow is active |
| Schedule Trigger | Starts at a configured interval, at least 1000 ms, when active |
| Set Fields | Preserves incoming fields and adds or replaces configured values |
| Code / Expression | Evaluates JSONata transformation code against the incoming data |
| Filter Items | Keeps array items matching a JSONata predicate |
| Summarize Items | Produces count, sum, average, minimum, maximum, and original items |
| Condition | Routes based on a field, including nested paths such as `customer.tier` |
| Delay | Pauses for 0–5000 ms |
| HTTP Request | Makes real public HTTP(S) requests with configurable method, headers, body, and timeout |
| Web Scraper | Extracts typed records and links from public HTML, with CSS selectors and pagination |
| Apify Actor | Runs a real cloud Actor, reports progress, and waits for success |
| Apify Dataset | Reads a bounded page of records from an existing or newly created dataset |
| AI Analysis | Calls the server’s configured Groq service and parses a JSON result |
| Workflow Result | Presents a report title, summary, metrics, and underlying data |
| Logger | Records the preceding output and a message |

## Expression code

The code editor provides highlighting, indentation, bracket matching, line numbers, and search. The expression language is **JSONata**, rather than arbitrary JavaScript. `$json` is the incoming data; ordinary JSONata paths also work.

For input `{ "customer": "Maya", "subtotal": 125 }`:

```text
{
  "customer": $json.customer,
  "subtotal": $json.subtotal,
  "tax": $round($json.subtotal * 0.1, 2),
  "total": $round($json.subtotal * 1.1, 2)
}
```

Result:

```json
{
  "customer": "Maya",
  "subtotal": 125,
  "tax": 12.5,
  "total": 137.5
}
```

Use an explicit array constructor when a transformation must keep its array shape for zero, one, or many items:

```text
[$map($json.orders, function($order) {
  { "id": $order.orderId, "total": $sum($order.items.(quantity * unitPrice)) }
})]
```

For Filter Items, choose the array field path, or leave it blank if the incoming data is already an array. A predicate such as `$item.paymentStatus = "paid"` is evaluated for each item. Filter Items always returns an array.

**Test this node independently** accepts editable JSON input and returns real preview output. **Use last input** loads that node’s input from the current execution. Previews support data, condition, logger, and result nodes; external services run through **Run workflow**.

Expressions run in a separate worker thread, with a three-second execution limit, bounded memory, and a 1 MB output limit. They cannot access server environment variables or arbitrary host functions. Expression code is limited to 20,000 characters.

Full syntax and examples: [JSONata documentation](https://docs.jsonata.org/overview.html).

## Map fields without a code node

Set Fields, HTTP parameters, report summaries, and log messages accept expressions in double braces:

```json
{
  "customerEmail": "{{ $json.customer.email }}",
  "amount": "{{ $json.total }}",
  "message": "Received order {{ $json.orderId }}"
}
```

An entire expression preserves its JSON type: `amount` is a number when `total` is a number. Expressions embedded in surrounding text become strings. `$nodes` provides earlier outputs keyed by node ID for advanced mappings; IDs are included in exported workflow JSON.

## Two more real workflows

**Live repository intelligence** calls the GitHub API, using `owner` and `repository` from Run input. It produces repository name, stars, forks, open issues, primary language, and a community signal. No API key is required for the example; GitHub’s unauthenticated rate limits still apply.

**Customer voice analyst** sends the supplied feedback to the real Groq service, then presents findings and recommendations. It requires the server-side `GROQ_API_KEY`. Outputs are suggestions for human review.

HTTP nodes parse JSON response bodies into `body`. Non-JSON responses remain text. Non-2xx responses fail the step unless **Continue on non-2xx response** is selected. HTTP requests use public addresses; private-network addresses, embedded URL credentials, and redirects are rejected. Timeouts are at most 30 seconds. Request headers are saved in the workflow and included in exports; the dedicated Groq key stays in server environment configuration.

## Observe and operate

- The canvas receives authenticated live status events from the worker through Redis. Polling retrieves durable results and provides a fallback when the stream disconnects.
- **Run history** lists this workflow’s saved runs. Open a run to restore its input and inspect the saved execution.
- Each new execution captures its workflow graph. Later edits cannot change which graph that run executes or its recorded inputs and outputs.
- **Cancel run** prevents further steps. An external request already in progress may finish before the worker observes cancellation.
- **Import** accepts a Flowcraft JSON file or pasted JSON and creates an independent draft with fresh node and edge IDs. **Export** downloads the current configuration.
- JSON outputs and tables can be copied or downloaded. Tables show at most 100 rows; downloads contain the complete output.
- Activate a saved webhook or schedule workflow using the top switch. Manual editor runs do not require activation. The webhook endpoint appears when its node is selected.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Save | Cmd/Ctrl + S |
| Run | Cmd/Ctrl + Enter |
| Undo / redo | Cmd/Ctrl + Z / Shift + Cmd/Ctrl + Z |
| Duplicate selected node | Cmd/Ctrl + D |
| Delete selected node or connection | Delete / Backspace |
| Search blocks | `/` |
| Deselect / close dialog | Escape |

While editing code or a text field, normal text-editing shortcuts take precedence over graph operations.

## Run and test locally

Use `docker compose up --build -d` to build and start all services. The API applies migrations automatically; existing workflows remain in PostgreSQL. See [USAGE.md](USAGE.md) for environment setup and account creation.

```bash
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

The browser suite includes the editor, existing demos, account isolation, and cancellation. It uses installed Google Chrome and the running local stack. `PLAYWRIGHT_BASE_URL` can point the frontend checks at a separate local preview. Live HTTP and Groq tests call their real services.

Failed queue jobs may retry up to three times; graphs containing Apify Actor use one attempt to reduce duplicate billed runs. When configuring an HTTP endpoint that changes external data, use the external service’s idempotency support if repeated requests would matter.

## Live web scraping and Apify

The library now includes **Web Scraper**, **Apify Actor**, and **Apify Dataset** under **Web & scraping**. Open **Recipes → Live price research** to run a six-step scrape without a key, or **Apify research pipeline** after configuring the server token. **Integrations** shows setup instructions and a real read-only Apify connection test.

The scraper inspector provides editable CSS selectors and extraction fields, numeric conversion, absolute links, pagination, and page/record limits. Running nodes report progress while collecting pages; Apify progress includes a live Console run link. Final tables support search, numeric sorting, clickable source links, CSV export, and JSON download. CSV exports include the full dataset regardless of the table search.

See [SCRAPING_GUIDE.md](SCRAPING_GUIDE.md) for the full workflow walkthrough, token setup, Actor billing limits, and website compatibility.

When importing a workflow, direct JSONata references to old node IDs are updated alongside the regenerated node and edge IDs. This includes quoted `$nodes` paths and literal `$lookup($nodes, "id")` calls. Unrelated source data and text stay intact; IDs assembled dynamically inside expressions need to be updated manually.
