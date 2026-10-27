# Flowcraft: live web research and Apify workflows

Flowcraft can collect data from websites, process it through connected nodes, and produce a searchable report with CSV and JSON downloads. Two ready-made recipes demonstrate the complete process:

| Recipe | What runs outside Flowcraft | Account needed |
| --- | --- | --- |
| **Live price research** | Real HTTP requests to a book catalogue, including its next page | None |
| **Apify research pipeline** | A real Apify Actor run, followed by a real dataset API read | An Apify account and server API token |

The native recipe fetches [Books to Scrape](https://books.toscrape.com/), a scraping practice catalogue. Its book prices are fictional; Flowcraft retrieves and processes the website live. Neither recipe substitutes saved responses when a request fails. An unreachable website, invalid selector, missing credential, or failed Actor produces its actual empty result or an actionable error.

## Start the system

From the project directory, with the existing root `.env` configured:

```bash
docker compose up --build -d
```

Open **http://localhost:3000**, sign in or create an account, and open **Recipes**. You can also select either workflow from **Integrations** in the editor toolbar.

The frontend runs on port 3000, the API on 4000, and the background worker performs the workflow. PostgreSQL stores saved workflows and execution history; Redis carries queued work and live events. Keep the API and worker running while executing workflows.

## Run the native price research workflow

1. Choose **Live price research**, or open **http://localhost:3000/?recipe=scrape**.
2. Open **Run input**. The initial research brief is:

   ```json
   {
     "url": "https://books.toscrape.com/",
     "maxPrice": 25,
     "maxPages": 2
   }
   ```

3. Click **Run workflow**. Flowcraft saves the graph, queues it, and runs each connected step.
4. Watch the Web Scraper fetch listings, follow the next-page link, and extract titles, prices, availability, and product URLs.
5. The following nodes keep books at or below your budget, calculate metrics, and build **Your live buying shortlist**.
6. Open the report table. Search records, click a column heading to sort, follow product links, or export **CSV** or **JSON**.
7. Change `maxPrice` and run again. The shortlist and metrics are computed from the newly retrieved listings. Setting a budget with no matches produces an empty shortlist; it is a valid result.

The final report includes the number of listings collected, matching books, budget, average and lowest matching prices, pages visited, source URL, and retrieval time. Values depend on the live source. Click any executed node to compare its actual **Input & output**, or reopen a saved run in **Run history**.

After a run, select **Keep books within budget**, open **Test this node independently**, choose **Use last input**, and select **Test node**. The preview uses the test input as `$json` and completed upstream outputs from that saved run as `$nodes`, so it can read the same budget. If you change earlier input or processing, run the workflow again to refresh that upstream context. Previewing a data node does not make another website request.

The recipe's `maxItems` is 100, while the standalone Web Scraper block starts with 40. Both remain bounded by the selected page count and actual website contents.

## Configure Web Scraper for another website

Add **Web Scraper** from **Web & scraping**, connect it after a trigger, and select it to open its parameters.

| Parameter | Meaning | Default / supported limit |
| --- | --- | --- |
| `url` | First public HTTP(S) page | Required; accepts `{{ $json.url }}` |
| `itemSelector` | CSS selector for each repeated record | Required; up to 500 characters |
| `fields` | Field definitions relative to each record | 1–30 supported by the API |
| `paginationSelector` | CSS selector for the first next-page link | Optional; blank disables pagination |
| `maxPages` | Maximum successful pages to process | API default 1; range 1–5 |
| `maxItems` | Maximum total extracted records | API default 100; range 1–200 |
| `delayMs` | Pause between content pages | Default 500; range 200–2000 ms |
| `timeoutMs` | Timeout for an individual web request | Default 15000; range 100–30000 ms |

The inspector provides controls for adding and removing extraction fields. Each field has:

- **Name:** the output property, such as `price`. Names must be unique, at most 80 characters, and cannot be JavaScript prototype property names.
- **Selector:** a CSS selector inside the item. The first matching element supplies the value. Leave it blank, or use `:scope`, to read the item element itself.
- **Attribute:** use `text` for text content, or an HTML attribute such as `title`, `href`, or `src`.
- **Type:** `text`, `number`, or `url`. Numbers are parsed from text such as a currency price. URL values and `href`/`src` attributes are resolved against the page's URL.

For the example catalogue, the item selector is `article.product_pod` and the fields are:

```json
[
  { "name": "title", "selector": "h3 a", "attribute": "title", "type": "text" },
  { "name": "price", "selector": ".price_color", "attribute": "text", "type": "number" },
  { "name": "availability", "selector": ".availability", "attribute": "text", "type": "text" },
  { "name": "url", "selector": "h3 a", "attribute": "href", "type": "url" }
]
```

Its next-page selector is `.next a`. A different website usually requires different selectors; changing only the URL does not adapt the book selectors to that website.

Missing or empty fields become `null`. An item selector with no matches returns an empty `items` array. Extracted whitespace is normalized, unsupported link schemes become `null`, and numeric parsing returns `null` when no number can be read. Records are collected in page order without automatic row deduplication.

The Web Scraper output has this structure:

```text
{
  sourceUrl: <starting URL>,
  pages: [{ url: <final page URL>, itemCount: <records collected on that page> }],
  count: <total records collected>,
  items: [<records defined by your fields>],
  scrapedAt: <ISO retrieval timestamp>
}
```

Connect **Filter Items** using array field `items`. Connect **Summarize Items** to the filtered array and choose the numeric field to summarize, such as `price`. **Code / Expression** can reshape the dataset before a **Workflow Result**, **AI Analysis**, or **HTTP Request** node.

### Native scraper boundaries

The native scraper reads server-rendered HTML. It does not execute page JavaScript, click buttons, solve CAPTCHAs, sign in, or run a browser. Use a suitable Apify browser Actor for pages that need JavaScript rendering.

Requests identify themselves as `FlowcraftBot/1.0` and check `robots.txt`. A disallowed URL stops the step. A missing robots file with HTTP 404 or 410 allows the scrape; other unsuccessful robots responses stop it because the policy cannot be verified. Pagination remains on the current page's final origin after redirects, and repeated page URLs are not visited again.

Requests reject local/private network destinations and embedded URL credentials. Each redirect is checked, with at most five redirects per request. Content pages are limited to 2,000,000 bytes, robots files to 512,000 bytes, each extracted field to 10,000 characters, and the collected records to approximately 1 MB of JSON. Reduce page count, records, or fields if a limit is reached.

Use sites you are permitted to access, and configure a sensible request delay. The practice catalogue is a useful place to learn selectors before adapting the workflow to your own sources.

## Connect your Apify account

The Apify integration is implemented, but it needs your account token to run. Without `APIFY_API_TOKEN`, a run that reaches an Apify node fails explicitly and opens connection setup. Other branches can still run without Apify. It does not return example scraped data.

1. Sign in to [Apify Console token settings](https://console.apify.com/settings/integrations) and create or obtain an API token with access to the selected Actor and dataset.
2. Edit the **existing `.env` in the project root** and add or update this line:

   ```dotenv
   APIFY_API_TOKEN=your_actual_apify_token
   ```

3. Recreate both services so that Docker loads the new environment value:

   ```bash
   docker compose up -d --force-recreate api worker
   ```

4. In Flowcraft, open **Integrations** and click **Test Apify connection**. A successful check displays the connected username when available.

The connection test makes a read-only `GET /v2/users/me` request. It does not launch an Actor. A configured token and a verified connection are different states: expired tokens, missing permissions, and network failures are reported when checked. See [Apify authentication and getting started](https://docs.apify.com/api/v2/getting-started).

The token stays in the API and worker environments and is sent to Apify in an authorization header. Do not paste it into Actor input, node parameters, URLs, or ordinary HTTP Request headers. The dedicated integration does not include its server token in exported workflows or execution results. The server token is shared by workflows on this deployment; this version does not maintain a separate Apify connection for each Flowcraft user.

For development outside Docker, put the same setting in the root `.env` and restart both API and worker processes. Keep `.env` out of Git.

## Run the Apify research pipeline

1. Choose **Apify research pipeline**, or open **http://localhost:3000/?recipe=apify**.
2. In **Run input**, choose the research URL and initial page limit:

   ```json
   { "url": "https://docs.apify.com/", "maxPages": 2 }
   ```

3. Select **Run Website Content Crawler**. Inspect its Actor ID, input JSON, timeout, maximum charge, and billable-item limit before starting.
4. Click **Run workflow**. Flowcraft starts the Actor once, polls its status, waits for `SUCCEEDED`, and passes the resulting dataset ID to **Apify Dataset**.
5. The dataset node retrieves the selected records. The expression node produces titles, URLs, word counts, and short text excerpts; the final report presents the research brief.
6. While the Actor is running, its live progress shows the provider status and a run link. Open that link for the full provider log and billing details. The Actor step also records `consoleUrl` in its output; inspect the Dataset step for the retrieved source records.

The starter Actor is `apify/website-content-crawler`. Its JSON input maps the trigger URL into `startUrls` and the trigger page limit into `maxCrawlPages`. The recipe uses `crawlerType: "cheerio"` for HTML retrieval, enables `respectRobotsTxtFile`, and explicitly selects the Actor's Apify proxy configuration. For JavaScript-rendered sites, use a compatible browser engine such as `playwright:firefox` in the Actor input, keeping the page and charge limits small. Actor input schemas vary; consult the selected Actor's own documentation. [Website Content Crawler input reference](https://apify.com/apify/website-content-crawler/input-schema).

The starter pipeline's report is a transformation of scraped text, rather than an AI-generated summary. You can connect **AI Analysis** after the dataset or brief to add analysis; that separately requires the server's `GROQ_API_KEY` and sends the preceding data to Groq.

### Apify Actor parameters and limits

| Parameter | Meaning | Flowcraft default / supported limit |
| --- | --- | --- |
| `actorId` | Actor ID, `owner/name`, or `owner~name` | Required |
| `input` | JSON object matching that Actor's schema | Default `{}`; up to 100,000 bytes |
| `timeoutSecs` | Remote Actor execution timeout | Default 120; backend range 1–300 seconds |
| `maxItems` | Maximum billable items for pay-per-result Actors | Default 20; range 1–200 |
| `maxTotalChargeUsd` | Maximum total charge submitted to Apify for this run | Default 0.10; greater than 0 and at most 5 USD |

**`maxItems` is not a universal crawl or result-count limit.** It limits billable items for pay-per-result Actors. Set the Actor's own input limit too, such as `maxCrawlPages` for Website Content Crawler. The dataset read limit controls how many records Flowcraft retrieves; it does not stop the Actor crawling or reduce work it has already done. These distinctions follow the [Apify run API](https://docs.apify.com/api/v2/actors-runs-post).

Real runs may consume Apify credits. Some Actors require subscriptions, account permissions, or a minimum run charge. If the initial $0.10 cap is rejected, review that Actor's pricing and adjust the limit deliberately. Each new manual or scheduled run is a separate provider run with its own configured cap.

The Actor node returns `runId`, `status`, `actorId`, `defaultDatasetId`, `consoleUrl`, `startedAt`, and `finishedAt`. It succeeds only for `SUCCEEDED`; failed, aborted, and timed-out runs fail the workflow. An Actor without a dataset may return `defaultDatasetId: null`; choose its appropriate output API rather than connecting a Dataset node to a missing ID.

### Read datasets and retrieve another page

The **Apify Dataset** node supports:

| Parameter | Meaning | Default / limit |
| --- | --- | --- |
| `datasetId` | Existing dataset ID or mapped Actor output | Usually `{{ $json.defaultDatasetId }}` |
| `limit` | Maximum records requested in this read | Default 100; range 1–200 |
| `offset` | Number of source records to skip | Default 0; nonnegative integer |
| `fields` | Comma-separated property names | Optional; blank requests all non-hidden fields; at most 2000 characters |

The recipe requests `url,title,text,metadata` with a limit of 20. Other Actors can return different fields, so update both the selection and downstream expression when changing Actors.

Reads request JSON with `clean=true`. The output contains `datasetId`, `items`, `count`, and `offset`. Here, `count` means records returned in this page. When Apify supplies its pagination-total header, the output also includes `total`, `hasMore`, and `nextOffset`. An empty cleaned page does not necessarily mean the dataset has no later source records: cleaning can omit hidden or empty items. Follow `nextOffset` when available, or advance by the requested limit. See [Apify dataset pagination and cleaning](https://docs.apify.com/api/v2/dataset-items-get).

The node reads one page; it does not automatically fetch the entire dataset. To retrieve more records without launching the Actor again, create a workflow containing **Manual Trigger → Apify Dataset → Workflow Result**, paste the existing dataset ID from the previous run, and change `offset`. For consecutive dataset nodes, the second node can use `{{ $json.datasetId }}` and the desired offset.

Every Apify response is streamed with a 1 MB limit. Large text fields can hit that limit with only a few records. Reduce `limit` or select fewer fields. The final brief contains excerpts; full text remains available in the Dataset step's output for the records actually retrieved.

## View, download, and extend your results

The output viewer recognizes an array or an object with an `items` array. It supports record search, sortable columns, clickable public source links, CSV export, JSON download, and copying JSON. The table displays at most 100 matching records and 12 columns. Downloads contain all records returned by that node, including fields or rows beyond those display limits. Search and sorting affect the table view; CSV exports the full retrieved dataset.

**Export workflow** downloads the node graph and parameters. Output **CSV/JSON** downloads the data produced by a run. These serve different purposes.

To automate collection, use **Schedule Trigger → Set Fields → Web Scraper → processing nodes**. Put the research defaults in Set Fields, for example `{ "url": "https://books.toscrape.com/", "maxPrice": 25, "maxPages": 2 }`, so that mappings have real values when no manual input is supplied. For an Apify pipeline, supply its URL and page limit in the same way. Save and activate the workflow. Its minimum interval is 1000 ms, but choose a much longer interval for website research. The schedule can start new executions while an earlier one is still running, so account for overlapping requests and, for Apify, repeated charges. Deactivate the workflow to stop future scheduled starts; use **Cancel run** for an execution already in progress.

For incoming events, use a **Webhook Trigger**, save and activate the workflow, and send JSON to the generated webhook URL. Map its URL and other input fields into the scraper parameters. A later **HTTP Request** node can send the processed data to another application's API, using that application's expected schema and authentication.

## Cancellation, retries, and troubleshooting

**Cancel run** marks the Flowcraft execution cancelled and prevents later nodes. The native scraper checks cancellation between pages and records. Its current HTTP request may finish or reach its request timeout before cancellation is observed.

For Apify, cancellation checks interrupt pending status and dataset requests. Once the remote run ID is known, Flowcraft requests a remote abort on cancellation, polling failure, or the local wait timeout. During Actor startup it first waits for the start response, up to the request timeout, so that it can obtain the ID needed to abort. The local Actor wait budget is the configured timeout plus a 15-second allowance. [Apify run status](https://docs.apify.com/api/v2/actor-run-get) and [abort API](https://docs.apify.com/api/v2/actor-run-abort-post) describe the provider operations.

Cancellation is not proof that a remote Actor stopped. If the start response is lost, the worker crashes, or the abort request fails, check and stop the run in Apify Console. The submitted remote timeout and charge cap still apply. Cancellation does not reverse work already completed or provider charges already incurred.

Flowcraft sends the Actor-start POST once, disables Apify's `restartOnError`, and disables ordinary automatic queue retries for any workflow containing an Apify Actor node. Other queued workflows may retry up to three times. Process crashes and queue recovery still prevent an exactly-once guarantee, so inspect Apify Console before rerunning an ambiguous start failure. For an HTTP node that changes another application's data, use that service's idempotency support when repeated requests matter.

| Symptom | What to check |
| --- | --- |
| Empty native dataset | Verify the item selector against the fetched HTML. The website may render records using JavaScript. |
| Individual field is `null` | Check its relative selector and attribute. Check whether numeric text actually contains a number. |
| Scrape stops at robots policy | Review the reported path and the site's robots policy; choose an allowed source. |
| Private-network or redirect error | Use a public HTTP(S) website; inspect where its redirects lead. |
| Native page or output too large | Reduce page count, records, or extracted fields. |
| Apify connection needed | Add the token to root `.env`, then recreate both API and worker. |
| Apify HTTP 401 / 403 | Update an expired token or grant access to the selected Actor/dataset. |
| Apify HTTP 400 / 402 | Review the Actor schema, minimum charge, credits, subscriptions, and account limits. |
| Apify HTTP 429 | Wait for rate/concurrency limits to clear before retrying. |
| Apify run failed or timed out | Open the Actor step's Console link and inspect the provider log. |
| Apify response exceeds 1 MB | Lower the Dataset record limit or select fewer/smaller fields. |
| Progress view disconnected | Use **Resume checking** or reopen the execution from history. |

External scraping nodes run through **Run workflow**. Node previews are limited to data and logic transformations; a preview never silently launches an Actor. Use small inputs and inspect each node's real output while building your workflow.
