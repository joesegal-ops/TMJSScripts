"""Introspect GET /api/v1/Audit and try it for a Job. Run on VM. Read-only."""
import os, json, requests, itertools
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
APIV="https://api.joblogic.com/api/v1"
JOB_INT=os.environ.get("PROBE_JOBINT","29450326")
JOB_GUID=os.environ.get("PROBE_JOBGUID","a06fb368-635b-4d01-aa65-eec37771cf4c")
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}"}
spec=requests.get("https://api.joblogic.com/swagger/v1/swagger.json",headers=H,timeout=60).json()

op=spec["paths"]["/api/v1/Audit"]["get"]
print("=== GET /api/v1/Audit parameters ===")
for p in op.get("parameters",[]):
    print(f"  {p.get('name')} (in={p.get('in')}, required={p.get('required')}, type={(p.get('schema') or {}).get('type', p.get('type'))})")

def resolve(ref):
    n=spec
    for x in ref.lstrip("#/").split("/"): n=n.get(x,{})
    return n
# response schema
resp=op.get("responses",{}).get("200",{})
sch=(resp.get("content",{}) or {}).get("application/json",{}).get("schema",{}) or resp.get("schema",{})
def props(s,seen=None,d=0):
    seen=seen or set()
    if not isinstance(s,dict) or d>5: return {}
    if "$ref" in s:
        if s["$ref"] in seen: return {}
        seen.add(s["$ref"]); return props(resolve(s["$ref"]),seen,d+1)
    out={}
    for k,v in (s.get("properties",{}) or {}).items():
        if v.get("type")=="array":
            it=v.get("items",{})
            out[k]="array<%s>"%(it.get("$ref","").split("/")[-1] or it.get("type","?"))
            if "$ref" in it: out[k+"[]"]=props(it,seen,d+1)
        elif "$ref" in v: out[k]=props(v,seen,d+1)
        else: out[k]=v.get("type","?")
    return out
print("\n=== 200 response schema ===")
print(json.dumps(props(sch),indent=1)[:1500])

print("\n=== try calls (job int",JOB_INT,"/ guid",JOB_GUID,") ===")
attempts=[
  {"tenantId":TID,"EntityType":"Job","EntityId":JOB_INT},
  {"tenantId":TID,"EntityType":"Job","EntityUniqueId":JOB_GUID},
  {"tenantId":TID,"entityType":"Job","entityId":JOB_INT},
  {"tenantId":TID,"EntityName":"Job","EntityId":JOB_INT},
  {"tenantId":TID,"EntityType":"Job","Id":JOB_INT},
  {"tenantId":TID,"Type":"Job","EntityId":JOB_INT},
]
for a in attempts:
    try:
        r=requests.get(f"{APIV}/Audit",params=a,headers=H,timeout=40)
        t=r.text.replace("\n"," ")
        print(f"  {a} -> {r.status_code} len={len(r.text)}  {t[:180]}")
    except Exception as e:
        print(f"  {a} -> ERR {e}")
