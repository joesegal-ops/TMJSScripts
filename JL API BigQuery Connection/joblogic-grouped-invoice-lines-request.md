# Email draft — Joblogic Support: API access to Customer Grouped invoice line/job breakdown

**To:** Joblogic Support
**Subject:** API — retrieving the per-job line breakdown of Customer Grouped invoices

Hi,

Our API integration (UK tenant `38a05a51-8e8d-4073-9fbb-9863fd935329`, `client_credentials` /
`JL.Api`, requests from whitelisted IP `8.228.52.239`) is working well for invoices in general.
We've hit one gap we can't get past: **Customer Grouped invoices cannot be broken down per job
through the API**, and we need that breakdown to reconcile invoiced vs. uninvoiced revenue per job.

## What works

`POST /api/v1/Invoice/getall` returns all invoices, and for **standard/PPM/project** invoices each
one carries a `JobNumber`/`JobId` on the header, so we can attribute it to a job.
`GET /api/v1/Invoice/GetById?id={Id}&tenantId={tenant}` also works for these and returns a `Lines`
array — e.g. `id=12507231` (invoice #001891) returns HTTP 200 with its line items.

## The problem — Customer Grouped invoices (Type 2)

A Customer Grouped invoice bills **many jobs on one invoice**. In the API its header has
**`JobNumber = null` and `JobId = null`**, and `InvoiceLines = null` (though `InvoiceLineExist = true`),
so there is no way to see which jobs it covers or how much of it belongs to each job.

**Worked example — invoice #001922:**

| Field | Value |
|---|---|
| InvoiceNumber | `001922` |
| Id | `12539009` |
| UniqueId | `a0fd08fb-8e27-4c2b-b301-d9719a45f8a3` |
| Type | `2` (Customer Grouped) |
| Net (ex VAT) | `£61,167.86` |
| DateRaised | `2026-05-27` |
| OrderNumber | `CONS - MAY 26 \| SCON-00021244 - 10YORK` |
| JobNumber / JobId | `null` / `null` |

What we've tried, and the results:

1. **`GET /api/v1/Invoice/GetById?id=12539009&tenantId=…`** → `HTTP 400 {"Message":"Invoice does not
   exist"}` — even though `Invoice/getall` itself returned this exact `Id`. (The same call works for
   normal invoices.) Passing the `UniqueId` gives `HTTP 400 "id is not valid"` (it expects an integer).
2. **`Invoice/getall` with a line-expansion flag** — we tried `IncludeInvoiceLines`, `IncludeLines`,
   `ExpandLines`, `IncludeInvoiceLineItems`, `IncludeLineItems`; `InvoiceLines` stays `null` for the
   grouped invoice in every case.
3. **Grouped/consolidated-specific endpoints** — `Invoice/GetCustomerGroupedInvoiceById`,
   `Invoice/GetCGroupInvoiceById`, `Invoice/GetGroupedInvoiceById`, `CustomerGroupedInvoice/GetById`,
   `CustomerGroupedInvoice/getall`, and several variants → all `HTTP 404`.
4. **Batch fields** — `BatchInvoiceId` / `BatchInvoiceNumber` are `null` on grouped invoices (and on
   all invoices), so there's no child→parent link to follow either.

## What we need

A way, via the API, to obtain **for a Customer Grouped invoice the list of jobs it covers with each
job's net (ex-VAT) amount** — i.e. for invoice #001922, the jobs and per-job amounts that sum to the
£61,167.86. Any of the following would solve it:

1. Make Customer Grouped invoices retrievable via `Invoice/GetById` (or tell us the correct
   id/endpoint for them), **with** their `Lines`; **and** include a `JobNumber`/`JobId` on each line.
2. Or a flag on `Invoice/getall` that populates `InvoiceLines`, each line carrying its `JobNumber`/`JobId`
   and net amount.
3. Or a dedicated endpoint that returns a grouped invoice's constituent jobs/child-invoices and amounts.

## Questions

1. What is the correct API call to get the per-job breakdown of a Customer Grouped invoice
   (worked example: invoice #001922 / Id `12539009`)?
2. Why does `Invoice/GetById` return "Invoice does not exist" for a grouped-invoice `Id` that
   `Invoice/getall` returns? Is there a separate id or endpoint for Type-2 invoices?
3. For invoice lines generally, can each line include the `JobNumber`/`JobId` it relates to (so
   grouped-invoice lines can be attributed to jobs)?

Thanks,
Joe Segal — UP-FM
