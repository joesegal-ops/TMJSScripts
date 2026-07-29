"""
Read-only probe: does Joblogic's Invoice/getall return Schedule-Of-Rates invoices?

Context: invoice #1225 (SOR, PROJ0000509, raised 2026-02-13, £27,585.67) shows in the
Joblogic UI but is ABSENT from raw.invoices — while the standard PROJ invoices raised the
same day (#1224, #1226) load fine. 54 invoice numbers are missing from the range overall.
This probe hits the live API (no BigQuery writes) to find out WHY, so we can fix ingestion.

Run on the VM with the same creds the loader uses, e.g.:

  cd /opt/jl-loader && set -a && source config.env \
    && JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)" \
    && JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)" \
    && JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)" \
    && set +a && venv/bin/python probe_sor_invoices.py

Then paste the whole output back.
"""
import os, json, time
import requests

TID  = os.environ["JL_TENANT_ID"]
CID  = os.environ["JL_CLIENT_ID"]
CSEC = os.environ["JL_CLIENT_SECRET"]
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
PACE = 0.65

# The invoices we care about: 1225 is the missing SOR one; 1224/1226 are same-day controls.
TARGETS = {1224, 1225, 1226}

# Full flag set, exactly as the loader uses it.
FULL_FLAGS = {"IncludeStandardInvoices": True, "IncludePPMInvoices": True,
              "IncludeCGroupInvoices": True, "IncludeSORInvoices": True,
              "IncludeRelatedJobInvoices": True, "OrderBy": 0}

_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials",
            "client_id": CID, "client_secret": CSEC, "scope": "JL.Api"}, timeout=60)
        r.raise_for_status()
        _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def fetch(extra_body, label, max_pages=200):
    """Page through Invoice/getall with the given body. Returns list of item dicts."""
    rows, page = [], 1
    total = None
    while page <= max_pages:
        body = {"TenantId": TID, "PageIndex": page, "PageSize": 50}
        body.update(extra_body)
        r = None
        for attempt in range(1, 6):
            time.sleep(PACE)
            r = requests.post(f"{BASE}/Invoice/getall", json=body,
                headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
                timeout=60)
            if r.status_code == 401:
                _tok["v"] = None; time.sleep(2 * attempt); continue
            if r.status_code in (429, 403) or r.status_code >= 500:
                print(f"  [{label}] HTTP {r.status_code} page {page} (try {attempt}) — backing off")
                time.sleep(min(5 * attempt, 60)); continue
            break
        if r is None or r.status_code >= 400:
            print(f"  [{label}] giving up on page {page}: HTTP {getattr(r,'status_code','?')} {getattr(r,'text','')[:200]}")
            break
        d = r.json()
        items = d.get("Items", []) if isinstance(d, dict) else d
        if isinstance(d, dict) and total is None:
            total = d.get("TotalCount")
        rows.extend(items or [])
        if not items or len(items) < 50 or (total is not None and len(rows) >= total):
            break
        page += 1
    print(f"  [{label}] fetched {len(rows)} items (API TotalCount={total})")
    return rows, total

def num_of(item):
    """Best-effort invoice number from an item dict."""
    for k in ("InvoiceNumber", "invoiceNumber", "Number", "SeqId"):
        if k in item and item[k] is not None:
            try:
                return int(item[k])
            except (ValueError, TypeError):
                return item[k]
    return None

def report_targets(rows, label):
    present = set()
    for it in rows:
        n = num_of(it)
        if n in TARGETS:
            present.add(n)
    for t in sorted(TARGETS):
        mark = "FOUND" if t in present else "MISSING"
        print(f"  [{label}] invoice #{t}: {mark}")
    return present

def describe_type_fields(rows, label):
    """Find candidate 'type' / SOR indicator fields and their value spread."""
    if not rows:
        return
    keys = sorted(rows[0].keys())
    print(f"  [{label}] item keys ({len(keys)}): {', '.join(keys)}")
    for k in keys:
        lk = k.lower()
        if any(t in lk for t in ("type", "sor", "scheduleofrates", "category", "kind")):
            vals = {}
            for it in rows:
                v = it.get(k)
                vals[str(v)] = vals.get(str(v), 0) + 1
            top = sorted(vals.items(), key=lambda x: -x[1])[:8]
            print(f"  [{label}] field '{k}' values: {top}")

def dump_item(rows, number, label):
    for it in rows:
        if num_of(it) == number:
            print(f"  [{label}] FULL item for invoice #{number}:")
            print(json.dumps(it, indent=2, default=str)[:4000])
            return True
    return False

def main():
    print("=" * 72)
    print("TEST 1 — full flags, NO date window (mirrors nightly loader.py)")
    print("=" * 72)
    rows1, _ = fetch(FULL_FLAGS, "full/no-window")
    report_targets(rows1, "full/no-window")
    describe_type_fields(rows1, "full/no-window")
    dump_item(rows1, 1225, "full/no-window") or dump_item(rows1, 1224, "full/no-window")

    print()
    print("=" * 72)
    print("TEST 2 — full flags, Feb-2026 window (mirrors incremental backfill chunk)")
    print("=" * 72)
    feb = {**FULL_FLAGS, "StartDate": "2026-02-01T00:00:00Z", "EndDate": "2026-03-01T00:00:00Z"}
    rows2, _ = fetch(feb, "full/feb-window")
    report_targets(rows2, "full/feb-window")

    print()
    print("=" * 72)
    print("TEST 3 — ONLY IncludeSORInvoices=True (are SOR invoices ever returned alone?)")
    print("=" * 72)
    sor_only = {"IncludeSORInvoices": True, "OrderBy": 0,
                "StartDate": "2026-02-01T00:00:00Z", "EndDate": "2026-03-01T00:00:00Z"}
    rows3, _ = fetch(sor_only, "sor-only/feb")
    report_targets(rows3, "sor-only/feb")
    describe_type_fields(rows3, "sor-only/feb")

    print()
    print("=" * 72)
    print("TEST 4 — full flags, Feb window, sweep numbers 1220-1232 (see the gap live)")
    print("=" * 72)
    seen = sorted({num_of(it) for it in rows2 if isinstance(num_of(it), int) and 1220 <= num_of(it) <= 1232})
    print(f"  invoice numbers 1220-1232 returned by API: {seen}")
    print(f"  (raw.invoices is missing 1225, 1227, 1229 — compare)")

if __name__ == "__main__":
    main()
