"""Granular notes + full visits backfill. Per job: Note/GetAll(Job) for job notes; Visit/GetAll(JobId)
for full visit records (GUIDs, all visits); Note/GetAll(Visit) per visit for engineer notes.
Writes raw.notes (one row per note, per-visit granular) and raw.visits (full visit records).

Long run (~20h). Resumable: checkpoints processed job ids; appends to jsonl; rerun to continue.
Token auto-refresh, 403/429 backoff. Paced to leave headroom for the 15-min jobs cron.
  nohup .../python load_notes_full.py > notes.log 2>&1 &
"""
import os, json, time, datetime as dt
import requests
from google.cloud import bigquery

TID=os.environ["JL_TENANT_ID"]; CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]
PROJECT="vmimporteddata"; BASE="https://api.joblogic.com/api/v1"
TOKEN_URL="https://identityservice.joblogic.com/connect/token"
NOTES_JL="/tmp/raw_notes.jsonl"; VISITS_JL="/tmp/raw_visits.jsonl"; DONE="/tmp/notes_done.txt"
PACE=0.72  # ~83/min, headroom under the 100/min cap for the jobs cron

_tok={"v":None,"t":0.0}
def token():
    if _tok["v"] is None or time.time()-_tok["t"]>2700:
        r=requests.post(TOKEN_URL,data={"grant_type":"client_credentials","client_id":CID,
            "client_secret":CSEC,"scope":"JL.Api"},timeout=60); r.raise_for_status()
        _tok["v"]=r.json()["access_token"]; _tok["t"]=time.time()
    return _tok["v"]

def call(path, body):
    for attempt in range(1,6):
        time.sleep(PACE)
        r=requests.post(f"{BASE}/{path}",json=body,headers={"Authorization":f"Bearer {token()}",
            "Content-Type":"application/json"},timeout=60)
        if r.status_code in (429,403) or r.status_code>=500:
            if r.status_code==401: _tok["v"]=None
            time.sleep(min(5*attempt,60)); continue
        if r.status_code==401: _tok["v"]=None; continue
        r.raise_for_status(); return r.json()
    r.raise_for_status()

def notes_for(etype, uid):
    d=call("Note/GetAll",{"TenantId":TID,"PageIndex":1,"PageSize":50,"EntityType":etype,"EntityUniqueId":uid})
    return d.get("Items",[]) if isinstance(d,dict) else []

def visits_for(job_int):
    out,page=[],1
    while True:
        d=call("Visit/GetAll",{"TenantId":TID,"PageIndex":page,"PageSize":50,"JobId":str(job_int)})
        items=d.get("Items",[]) if isinstance(d,dict) else []
        out.extend(items)
        if not items or len(items)<50 or len(out)>=d.get("TotalCount",0): break
        page+=1
    return out

def main():
    bq=bigquery.Client(project=PROJECT)
    rows=list(bq.query("SELECT Id, UniqueId, NoOfVisits FROM `vmimporteddata.raw.jobs` ORDER BY Id").result())
    done=set()
    if os.path.exists(DONE): done={x.strip() for x in open(DONE) if x.strip()}
    todo=[r for r in rows if str(r.Id) not in done]
    print(f"{dt.datetime.now():%H:%M:%S} jobs={len(rows)} done={len(done)} todo={len(todo)}",flush=True)
    ing=dt.datetime.now(dt.timezone.utc).isoformat()
    fn=open(NOTES_JL,"a"); fv=open(VISITS_JL,"a"); fd=open(DONE,"a")
    n=0
    for r in todo:
        jid, juid, nv = r.Id, r.UniqueId, (r.NoOfVisits or 0)
        try:
            for note in notes_for("Job", juid):
                note.update({"_EntityType":"Job","_JobId":jid,"_JobUniqueId":juid,"_ingested_at":ing})
                fn.write(json.dumps(note,default=str)+"\n")
            if nv>0:
                for v in visits_for(jid):
                    v["_JobId"]=jid; v["_ingested_at"]=ing; fv.write(json.dumps(v,default=str)+"\n")
                    vuid=v.get("UniqueId")
                    if vuid:
                        for note in notes_for("Visit", vuid):
                            note.update({"_EntityType":"Visit","_JobId":jid,"_VisitId":v.get("Id"),
                                         "_VisitUniqueId":vuid,"_ingested_at":ing})
                            fn.write(json.dumps(note,default=str)+"\n")
        except Exception as e:
            print(f"{dt.datetime.now():%H:%M:%S} job {jid} error: {type(e).__name__} {e}",flush=True)
            continue  # leave un-done so a rerun retries it
        fd.write(f"{jid}\n"); n+=1
        if n%500==0: fn.flush(); fv.flush(); fd.flush(); print(f"{dt.datetime.now():%H:%M:%S} {n}/{len(todo)}",flush=True)
    fn.close(); fv.close(); fd.close()
    print(f"{dt.datetime.now(dt.timezone.utc):%H:%M:%S} fetch done; loading BQ...",flush=True)
    for path,table in [(NOTES_JL,"notes"),(VISITS_JL,"visits")]:
        if os.path.getsize(path)>0:
            with open(path,"rb") as f:
                bq.load_table_from_file(f, f"{PROJECT}.raw.{table}", job_config=bigquery.LoadJobConfig(
                    source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                    write_disposition="WRITE_TRUNCATE", autodetect=True, ignore_unknown_values=True)).result()
            print(f"loaded raw.{table}: {bq.get_table(f'{PROJECT}.raw.{table}').num_rows} rows",flush=True)

if __name__=="__main__":
    main()
