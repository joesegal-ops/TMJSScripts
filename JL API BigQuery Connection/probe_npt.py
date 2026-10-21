"""Introspect + try Engineer/GetSchedulerSearch and Timesheet/GetNonProductiveTypes. Run on VM. Read-only."""
import os, json, requests, datetime as dt
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
BASE="https://api.joblogic.com"
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}"}
spec=requests.get(f"{BASE}/swagger/v1/swagger.json",headers=H,timeout=60).json()

def resolve(ref):
    n=spec
    for x in ref.lstrip("#/").split("/"): n=n.get(x,{})
    return n
def props(s,seen=None,d=0):
    seen=set(seen or ())
    if not isinstance(s,dict) or d>4: return "?"
    if "$ref" in s:
        if s["$ref"] in seen: return s["$ref"].split("/")[-1]
        seen.add(s["$ref"]); return props(resolve(s["$ref"]),seen,d+1)
    if s.get("type")=="array": return [props(s.get("items",{}),seen,d+1)]
    if s.get("properties"): return {k:props(v,seen,d+1) for k,v in s["properties"].items()}
    return s.get("type","?")+("|enum" if "enum" in s else "")

for path in ["/api/v1/Engineer/GetSchedulerSearch","/api/v1/Timesheet/GetNonProductiveTypes"]:
    for m,op in spec["paths"][path].items():
        print(f"=== {m.upper()} {path} ===")
        print("params:",[(p.get("name"),p.get("in"),p.get("required")) for p in op.get("parameters",[])])
        rb=(op.get("requestBody") or {}).get("content",{})
        for ct,c in rb.items(): print("body",ct,json.dumps(props(c.get("schema",{})),indent=1)[:2500])
        r200=op.get("responses",{}).get("200",{}).get("content",{})
        for ct,c in list(r200.items())[:1]: print("resp",json.dumps(props(c.get("schema",{})),indent=1)[:3500])

today=dt.date.today()
r=requests.get(f"{BASE}/api/v1/Timesheet/GetNonProductiveTypes",headers=H,params={"TenantId":TID},timeout=60)
print("\nTYPES",r.status_code,r.text[:1500])
# engineers via public API
ids=[]
for pg in (1,2):
    r=requests.post(f"{BASE}/api/v1/Engineer/GetAll",headers=H,json={"TenantId":TID,"PageIndex":pg,"PageSize":50},timeout=60)
    ids+= [e.get("Id") for e in r.json().get("Items",[])]
print("engineers",len(ids),ids[:5])
sch=spec["paths"]["/api/v1/Engineer/GetSchedulerSearch"]["post"]["requestBody"]["content"]["application/json"]["schema"]
sch=resolve(sch["$ref"]) if "$ref" in sch else sch
it=sch["properties"]["TypeOfJobs"]["items"]; it=resolve(it["$ref"]) if "$ref" in it else it
print("TypeOfJobs enum:",it.get("enum"),it.get("x-enumNames"),it.get("description"))
eng=[i for i in ids if isinstance(i,int)]
for tj in (0,6,7,99):
    tot=0; items=[]
    for pg in range(1,20):
        body={"TenantId":TID,"PageIndex":pg,"PageSize":50,"StartDate":"2026-10-12","EndDate":"2026-10-17","EngineerIds":eng,"TypeOfJobs":[tj]}
        r=requests.post(f"{BASE}/api/v1/Engineer/GetSchedulerSearch",headers=H,json=body,timeout=60)
        if r.status_code!=200: print(tj,r.status_code,r.text[:300]); break
        j=r.json(); items+=j["Items"]; tot=j["TotalCount"]
        if len(items)>=tot or not j["Items"]: break
    print(f"\nTypeOfJob={tj}: total={tot} got={len(items)}")
    if items and items[0].get("JobId") in (0,None):
        print("KEYS",sorted(items[0].keys()))
        for x in items[:3]: print(json.dumps(x)[:1200])
        print("ROWS",sorted((x.get("StartDate","")[:16],x.get("EndDate","")[11:16],x.get("EngineerName"),x.get("Title"),x.get("TypeDescription"),x.get("Reason")) for x in items)[:40])
