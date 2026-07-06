# Joblogic API → BigQuery pipeline

Pulls data from the Joblogic public API on a schedule and loads it into BigQuery.
Egress is forced through a single **reserved static IP** (Cloud NAT) so it satisfies
Joblogic's API IP-whitelist requirement.

## How it works

```
Cloud Scheduler ──► Cloud Run Job (main.py)
                         │ egress via VPC connector
                         ▼
                    Cloud NAT ──► reserved static IP  ← whitelist with Joblogic
                         ├─ OAuth token (client_credentials, scope=JL.Api)
                         ├─ paginated GET against JL_API_PATH
                         └─ load → BigQuery
```

## Setup

1. **Get API credentials** from Joblogic (Support / the "API Access" app in your portal):
   `client_id` + `client_secret`.
2. Edit the `EDIT THESE` block at the top of `setup.sh` (project, region, dataset, schedule,
   and the JL endpoint you want).
3. Run `setup.sh` step by step. After **step 3** it prints the **static egress IP** — send that
   to Joblogic Support to whitelist for API access.
4. In **step 7**, create the secrets with your real credentials (commands are commented in place).
5. Once whitelisted, test: `gcloud run jobs execute jl-bq-loader --region=<REGION>`.

## Picking the endpoint

The public API exposes entities (jobs, customers, quotes, visits, invoices…), **not** the canned
report email. Find the endpoint matching your report's data in
[apidocs.joblogic.com](https://apidocs.joblogic.com/) / the
[Joblogic Postman workspace](https://www.postman.com/bold-robot-681180/documentation/18108455-adc463e3-bba7-44c2-b8c4-b25fedb494c9),
then set in `setup.sh`:

- `JL_API_PATH` – e.g. `/job`
- `JL_RECORDS_KEY` – the JSON key holding the array (e.g. `data`, or empty if the body *is* the array)
- `JL_PAGE_PARAM` / `JL_SIZE_PARAM` / `JL_PAGE_SIZE` – match the endpoint's pagination

## Config (env vars on the Cloud Run job)

| Var | Default | Notes |
|-----|---------|-------|
| `JL_TOKEN_URL` | `https://identityserver.joblogic.com/connect/token` | Confirm prod host with JL |
| `JL_API_BASE` | `https://api.joblogic.com` | Confirm prod base with JL |
| `JL_SCOPE` | `JL.Api` | |
| `JL_API_PATH` | — (required) | The resource to pull |
| `JL_EXTRA_QUERY` | — | e.g. `modifiedSince=2026-06-01` for incremental pulls |
| `BQ_WRITE_MODE` | `WRITE_TRUNCATE` | Idempotent snapshot. Use `WRITE_APPEND` to accumulate |

## Notes

- **Snapshot vs incremental.** Default `WRITE_TRUNCATE` replaces the table each run — simplest and
  idempotent, ideal for small/medium report data. For large datasets, switch to a `modifiedSince`
  incremental pull (`JL_EXTRA_QUERY`) + `WRITE_APPEND`, then dedupe in a BigQuery view, or load into
  a staging table and `MERGE`.
- **Schema.** Uses BigQuery autodetect. For a locked-down schema, replace `autodetect=True` in
  `main.py:load_to_bq` with an explicit `schema=[bigquery.SchemaField(...)]`.
- **Frequency.** `*/15 * * * *` = every 15 min. Tokens are ~1h TTL and fetched fresh each run, so any
  interval is fine. Watch Joblogic's API rate limits if you go very frequent.
- **Cost.** Roughly: Cloud NAT (~$0.044/hr + data), VPC connector (2× e2-micro), tiny Cloud Run/BQ
  usage. Ballpark a few £/month at 15-min cadence.
