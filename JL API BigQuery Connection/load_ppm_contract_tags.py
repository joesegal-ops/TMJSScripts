"""PPM contract TAGS -> raw.ppm_contract_tags (WRITE_TRUNCATE snapshot). Runs on the MAC, not the VM.

The public API's PPMContract/GetAll has no Tags, so tags come from the web app's
POST /api/PPMContract/SearchPPMContract (form-encoded, __RequestVerificationToken header, PageSize caps at 50),
pulled in a logged-in go.joblogic.com Chrome tab by the nightly "refresh-ppm-contract-tags" scheduled task.
That task saves the pulled rows as a JSON array of
  [UniqueId, PPMContractNumber, Tags, IsCancelled, JobCategory, PlanReference, CustomerName, SiteName,
   StartDate "dd/mm/yyyy", EndDate "dd/mm/yyyy"]
(either bare, or embedded in a tool-output file) and runs:  python3 load_ppm_contract_tags.py <file>

Safety: refuses to load if the pull looks incomplete (< MIN_SHARE of raw.ppm_contracts), so a broken
session/half pull never truncates the good snapshot.
"""
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile

PROJECT = "vmimporteddata"
TABLE = "vmimporteddata:raw.ppm_contract_tags"
MIN_SHARE = 0.85
SCHEMA = ("UniqueId:STRING,PPMContractNumber:STRING,Tags:STRING,TagList:STRING,IsCancelled:BOOL,"
          "JobCategory:STRING,PlanReference:STRING,CustomerName:STRING,SiteName:STRING,"
          "StartDate:DATE,EndDate:DATE,_source:STRING,_ingested_at:TIMESTAMP")
SCHEMA_JSON = [dict(zip(("name", "type"), f.split(":"))) for f in SCHEMA.split(",")]
for f in SCHEMA_JSON:
    if f["name"] == "TagList":
        f["mode"] = "REPEATED"


def bq(*args, stdin=None):
    return subprocess.run(["bq", f"--project_id={PROJECT}", *args], input=stdin,
                          capture_output=True, text=True, check=True).stdout


def main(path):
    raw = open(path, encoding="utf-8").read().strip()
    rows = json.loads(raw[raw.index("["):raw.rindex("]") + 1])
    rows = list({r[0]: r for r in rows}.values())  # de-dupe on UniqueId (paging can overlap)

    api_count = int(json.loads(bq("query", "--use_legacy_sql=false", "--format=json",
        "SELECT COUNT(*) n FROM `vmimporteddata.raw.ppm_contracts`"))[0]["n"])
    if len(rows) < MIN_SHARE * api_count:
        sys.exit(f"ABORT: pulled {len(rows)} contracts vs {api_count} in raw.ppm_contracts "
                 f"(< {MIN_SHARE:.0%}) — not overwriting the existing snapshot")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    d = lambda s: dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat() if s else None
    fd, nd = tempfile.mkstemp(suffix=".ndjson")
    sd, sch = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            for uid, num, tags, canc, cat, plan, cust, site, start, end in rows:
                f.write(json.dumps({
                    "UniqueId": uid, "PPMContractNumber": num, "Tags": tags,
                    "TagList": [t.strip() for t in (tags or "").split(",") if t.strip()],
                    "IsCancelled": canc, "JobCategory": cat, "PlanReference": plan,
                    "CustomerName": cust, "SiteName": site, "StartDate": d(start), "EndDate": d(end),
                    "_source": "web SearchPPMContract", "_ingested_at": now}) + "\n")
        with os.fdopen(sd, "w") as f:
            json.dump(SCHEMA_JSON, f)
        bq("load", "--source_format=NEWLINE_DELIMITED_JSON", "--replace", TABLE, nd, sch)
    finally:
        os.remove(nd); os.remove(sch)
    stat = sum(1 for r in rows if "StatutoryPPM" in [t.strip() for t in (r[2] or "").split(",")])
    print(f"loaded {len(rows)} contracts ({stat} StatutoryPPM) -> {TABLE}; API has {api_count}")


if __name__ == "__main__":
    main(sys.argv[1])
