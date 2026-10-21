"""Probe Visit/SearchPlanner (public API) for NPT items. Run on VM. Read-only."""
import os, json, requests, datetime as dt
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
BASE="https://api.joblogic.com"
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}"}
spec=requests.get(f"{BASE}/swagger/v1/swagger.json",headers=H,timeout=60).json()
S=spec["components"]["schemas"]
for n in ["Joblogic.API.Models.SearchPlannerRequest","Joblogic.API.Models.PlannerItemResponse"]:
    print("==",n); sch=S[n]
    for k,v in sch.get("properties",{}).items(): print("  ",k,v.get("type") or v.get("$ref","").split("/")[-1],v.get("items",{}).get("$ref","").split("/")[-1] if v.get("type")=="array" else "", v.get("enum",""))
op=spec["paths"]["/api/v1/Visit/SearchPlanner"]["post"]
print("resp:",json.dumps(op["responses"].get("200",{}))[:400])
for k,v in S.items():
    if "enum" in v and any(x in k.lower() for x in ["plannertype","itemtype","planneritem"]): print("ENUM",k,v["enum"])
ids=[]
for pg in (1,2):
    ids+=[e["Id"] for e in requests.post(f"{BASE}/api/v1/Engineer/GetAll",headers=H,json={"TenantId":TID,"PageIndex":pg,"PageSize":50},timeout=60).json()["Items"]]
body={"TenantId":TID,"StartDate":"2026-10-14","EndDate":"2026-11-07","EngineerIds":ids,"IncludeNonProductiveTime":True,"IncludeReactiveVisits":False,"IncludePPMVisits":False}
r=requests.post(f"{BASE}/api/v1/Visit/SearchPlanner",headers=H,json=body,timeout=60)
print("\nSEARCH",r.status_code,r.text[:300])
try:
    j=r.json(); it=j.get("Items") or j.get("items") or (j if isinstance(j,list) else [])
    print("total",j.get("TotalCount") if isinstance(j,dict) else len(it))
    npt=[x for x in it if any("nonproductive" in k.lower() and x[k] for k in x)]
    print("npt-like",len(npt))
    for x in (npt or it)[:2]: print(json.dumps(x)[:1500])
    import collections
    print("dates",sorted(collections.Counter(x["StartDate"][:10] for x in npt).items()))
    print("virtual-ish keys", [k for k in (npt[0] if npt else {}) ])
    print("today",sorted((x["StartDate"][11:16],x["EngineerName"],x["TypeDescription"]) for x in npt if x["StartDate"].startswith("2026-10-16")))
except Exception as e: print("parse",e)
