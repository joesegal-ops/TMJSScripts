"""Bulk-write Job Ref 1 (AdditionalDetail.JobRef1) from a two-column TSV/CSV: Job Number, value.

Runs on the jl-loader VM via the public API, so no browser/laptop is needed. Per job:
GetById -> rebuild the FULL UpdateJobRequest with only JobRef1 changed -> PUT /api/v1/Job.
(PUT is a full update: Status/JobType/DateLogged/Description are required. Verified 2026-10-12 on
three Test-site jobs that a rebuilt body changes nothing but JobRef1 across GetById + the ~120-field
getall row — see probe_jobref1_write.py.)

Job number -> Id/UniqueId/CustomerContractId comes from raw.jobs (zero API calls); numbers missing
there fall back to one Job/getall SearchTerm lookup.

Resumable: every outcome is appended to <outdir>/results.jsonl; a rerun skips rows already done
(errors are retried). Paced to leave headroom under the 100/min API cap for the loader crons.

  ./venv/bin/python set_job_ref1.py LIST.tsv --dry-run            # classify only, no writes
  ./venv/bin/python set_job_ref1.py LIST.tsv --limit 20           # pilot
  ./venv/bin/python set_job_ref1.py LIST.tsv [--only-empty] [--notify you@x]
Writes <outdir>/results.csv (Job Number, New, Previous, Result, Error) at the end of every run.
"""
import os, sys, csv, json, time, argparse, subprocess, datetime as dt
import requests
from google.cloud import bigquery

TID = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
PROJECT = "vmimporteddata"; BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
ZERO_GUID = "00000000-0000-0000-0000-000000000000"

JOB_HEADERS = {'job', 'job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job reference', 'number', 'id', 'job id'}
REF_HEADERS = {'reference', 'ref', 'value', 'job ref 1', 'job ref1', 'jobref1', 'ref 1', 'ref1', 'job ref',
               'reference number', 'jobuserreferencefieldvalue'}

def log(msg):
    print(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)

# ---------- input ----------
def parse_list(path):
    text = open(path, encoding="utf-8-sig").read()
    delim = "\t" if "\t" in text else ","
    rows = [r for r in csv.reader(text.splitlines(), delimiter=delim) if any(c.strip() for c in r)]
    if not rows: return []
    head = [c.strip().lower().replace("_", " ") for c in rows[0]]
    jc = next((i for i, h in enumerate(head) if h in JOB_HEADERS), -1)
    rc = next((i for i, h in enumerate(head) if h in REF_HEADERS and i != jc), -1)
    start = 1 if jc >= 0 and rc >= 0 else 0
    if start == 0: jc, rc = 0, 1
    out = {}
    for r in rows[start:]:
        job = (r[jc] if len(r) > jc else "").strip()
        val = (r[rc] if len(r) > rc else "").strip()
        if job and val: out[job.upper()] = (job, val)     # duplicate job number: last row wins
    return list(out.values())

# ---------- API ----------
_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
            "client_secret": CSEC, "scope": "JL.Api"}, timeout=60)
        r.raise_for_status()
        _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

class ApiReject(Exception):
    """A 4xx the API meant (validation etc.) — record it, don't retry."""

def call(method, path, pace, **kw):
    last = None
    for attempt in range(1, 8):
        time.sleep(pace)
        try:
            r = requests.request(method, f"{BASE}/{path}", headers={"Authorization": f"Bearer {token()}",
                                 "Content-Type": "application/json"}, timeout=90, **kw)
        except requests.RequestException as e:
            last = str(e); time.sleep(min(10 * attempt, 120)); continue
        if r.status_code == 401:
            _tok["v"] = None; continue
        if r.status_code in (403, 429) or r.status_code >= 500:
            last = f"{r.status_code} {r.text[:150]}"; time.sleep(min(10 * attempt, 120)); continue
        if r.status_code >= 400:
            try: msg = r.json().get("Message") or json.dumps(r.json().get("errors"))
            except Exception: msg = r.text[:300]
            raise ApiReject(f"{r.status_code} {msg}")
        return r.json() if r.text else {}
    raise RuntimeError(f"{method} {path} failed after retries: {last}")

def lookup_by_number(jobno, pace):
    d = call("POST", "Job/getall", pace, json={"TenantId": TID, "PageIndex": 1, "PageSize": 50, "SearchTerm": jobno,
             "IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True})
    hits = [x for x in d.get("Items", []) if str(x.get("JobNumber", "")).upper() == jobno.upper()]
    if len(hits) != 1: return None if not hits else "ambiguous"
    x = hits[0]
    return {"Id": x["Id"], "UniqueId": x["UniqueId"], "CustomerContractId": as_int(x.get("CustomerContractId")),
            "cur": x.get("JobUserReferenceFieldValue")}

def as_int(x):
    try: return int(x) if x not in (None, "", 0, "0") else None
    except (TypeError, ValueError): return None

def build_body(j, contract_id, jobref1):
    ad = j.get("AdditionalDetail") or {}
    ref2 = ad.get("JobRef2")
    tags = [t if isinstance(t, str) else (t.get("Title") or t.get("Name")) for t in (j.get("Tags") or [])]
    return {
        "Id": j["Id"], "TenantId": TID, "ExternalId": j.get("ExternalId"),
        "Description": j.get("Description"), "Status": j.get("Status"), "JobType": j.get("JobType"),
        "JobCategory": j.get("JobCategory"), "PriorityLevel": j.get("PriorityLevel"),
        "OrderNumber": j.get("OrderNumber"), "ReferenceNumber": j.get("ReferenceNumber"),
        "DateLogged": j.get("DateLogged"), "PreferredAppointmentDate": j.get("PreferredAppointmentDate"),
        "TargetCompletionDate": j.get("TargetCompletionDate"), "TargetAttendanceDate": j.get("TargetAttendanceDate"),
        "DateComplete": j.get("DateComplete"),
        "Tags": [t for t in tags if t],
        "AdditionalDetail": {
            "Trade": ad.get("Trade"), "OwnerUserId": ad.get("OwnerUserId"),
            "NextContactDate": ad.get("NextContactDate"), "IsRequireApproval": bool(ad.get("IsRequireApproval")),
            "QuotedValue": ad.get("QuotedValue") or None,      # API rejects 0 ("must be greater than 0")
            "JobRef1": jobref1,
            "JobRef2": None if ref2 in (None, ZERO_GUID) else ref2,
            "SecondaryTradeIds": [t.get("Id") or t.get("UniqueId") for t in (ad.get("SecondaryTrades") or [])],
        },
        "ProjectNumber": j.get("ProjectNumber"),
        "CustomerContractId": contract_id or None,
    }

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("list"); ap.add_argument("--outdir", default=None)
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--only-empty", action="store_true")
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--pace", type=float, default=0.9)
    ap.add_argument("--notify", default=None, help="email a summary via msmtp when finished")
    a = ap.parse_args()
    outdir = a.outdir or os.path.splitext(os.path.abspath(a.list))[0] + "_run"
    os.makedirs(outdir, exist_ok=True)
    res_path = os.path.join(outdir, "results.jsonl")

    items = parse_list(a.list)
    log(f"list={a.list} rows={len(items)} outdir={outdir} dry_run={a.dry_run} only_empty={a.only_empty} pace={a.pace}s")

    done = {}
    if os.path.exists(res_path):
        for line in open(res_path):
            try: r = json.loads(line); done[r["job"].upper()] = r
            except Exception: pass
    todo = [(j, v) for j, v in items if done.get(j.upper(), {}).get("result") in (None, "error")]
    log(f"already done={len(items) - len(todo)} todo={len(todo)}")

    bq = bigquery.Client(project=PROJECT)
    idx = {}
    for r in bq.query("SELECT JobNumber, Id, UniqueId, CustomerContractId, JobUserReferenceFieldValue, IsFrozen "
                      "FROM `vmimporteddata.raw.jobs` QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC)=1").result():
        k = str(r.JobNumber).upper()
        idx[k] = "ambiguous" if k in idx and idx[k] != "ambiguous" and idx[k]["Id"] != r.Id else {
            "Id": r.Id, "UniqueId": r.UniqueId, "CustomerContractId": as_int(r.CustomerContractId),
            "cur": r.JobUserReferenceFieldValue, "frozen": str(r.IsFrozen).lower() == "true"}
    log(f"raw.jobs index: {len(idx)} job numbers")

    if a.dry_run:
        c = {"write (empty now)": 0, "write (overwrite)": 0, "same": 0, "has value (only-empty)": 0,
             "not in raw.jobs (API lookup at run time)": 0, "ambiguous": 0, "frozen per raw.jobs": 0}
        samples = []
        for j, v in todo:
            h = idx.get(j.upper())
            if h is None: c["not in raw.jobs (API lookup at run time)"] += 1; continue
            if h == "ambiguous": c["ambiguous"] += 1; continue
            cur = (h["cur"] or "").strip()
            if h.get("frozen"): c["frozen per raw.jobs"] += 1
            if cur == v: c["same"] += 1
            elif a.only_empty and cur: c["has value (only-empty)"] += 1
            elif cur:
                c["write (overwrite)"] += 1
                if len(samples) < 25: samples.append(f"{j}: {cur!r} -> {v!r}")
            else: c["write (empty now)"] += 1
        for k, n in c.items(): log(f"  {k:42} {n}")
        writes = c["write (empty now)"] + c["write (overwrite)"] + c["not in raw.jobs (API lookup at run time)"]
        log(f"  est. run time ~{writes * 2 * (a.pace + 0.6) / 3600:.1f}h (2 API calls/job)")
        for s in samples: log("  overwrite " + s)
        return

    if a.limit: todo = todo[:a.limit]
    t0, n = time.time(), 0
    stats = {}
    with open(res_path, "a") as out:
        for j, v in todo:
            rec = {"job": j, "new": v, "prev": None, "result": None, "error": None, "at": dt.datetime.utcnow().isoformat()}
            try:
                h = idx.get(j.upper())
                if h is None: h = lookup_by_number(j, a.pace)
                if h is None: rec["result"] = "not found"
                elif h == "ambiguous": rec["result"] = "ambiguous"
                else:
                    job = call("GET", "Job/GetById", a.pace, params={"id": h["Id"], "tenantId": TID, "includeAdditionalDetails": "true"})
                    job = job.get("Data", job)
                    cur = (job.get("AdditionalDetail") or {}).get("JobRef1")
                    rec["prev"] = cur
                    if (cur or "").strip() == v: rec["result"] = "same"
                    elif a.only_empty and (cur or "").strip(): rec["result"] = "has value"
                    else:
                        call("PUT", "Job", a.pace, json=build_body(job, h.get("CustomerContractId"), v))
                        rec["result"] = "set"
            except ApiReject as e:
                rec["result"], rec["error"] = "error", str(e)
            except Exception as e:
                rec["result"], rec["error"] = "error", f"{type(e).__name__}: {e}"
            out.write(json.dumps(rec) + "\n"); out.flush()
            stats[rec["result"]] = stats.get(rec["result"], 0) + 1
            n += 1
            if rec["result"] == "error": log(f"{j} ERROR {rec['error']}")
            if n % 250 == 0 or n == len(todo):
                rate = n / (time.time() - t0)
                log(f"{n}/{len(todo)}  {stats}  {rate * 60:.0f} jobs/min  ETA {(len(todo) - n) / rate / 3600:.1f}h")

    # results.csv over the whole list (latest outcome per job)
    final = {}
    for line in open(res_path):
        try: r = json.loads(line); final[r["job"].upper()] = r
        except Exception: pass
    csv_path = os.path.join(outdir, "results.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["Job Number", "New Job Ref 1", "Previous Job Ref 1", "Result", "Error"])
        for j, v in items:
            r = final.get(j.upper(), {})
            w.writerow([j, v, r.get("prev") or "", r.get("result") or "pending", r.get("error") or ""])
    totals = {}
    for j, _ in items:
        k = final.get(j.upper(), {}).get("result") or "pending"; totals[k] = totals.get(k, 0) + 1
    summary = f"Job Ref 1 run finished: this run {n} jobs in {(time.time() - t0) / 3600:.1f}h. Whole list: {totals}. Results: {csv_path}"
    log(summary)
    if a.notify:
        try:
            msg = f"To: {a.notify}\nSubject: Job Ref 1 bulk update finished\n\n{summary}\n"
            subprocess.run(["msmtp", a.notify], input=msg.encode(), timeout=60, check=False)
        except Exception as e:
            log(f"notify failed: {e}")

if __name__ == "__main__":
    main()
