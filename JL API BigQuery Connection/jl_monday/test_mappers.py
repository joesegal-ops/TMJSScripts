"""Local, no-network tests for the shared mappers. Run: python -m jl_monday.test_mappers"""
from .mappers import first_line, extract_refs
from .status_map import jl_status_to_monday, monday_pm_to_jl


def check(label, got, want):
    ok = got == want
    print(("  ok  " if ok else "  FAIL") + f" {label}: got={got!r}" + ("" if ok else f" want={want!r}"))
    return ok


def main():
    n = 0; fails = 0

    # --- first_line (Description -> Name) ---
    cases = [
        ("10 Devonshire - New Office.\r\n\r\nEmpty crates...", "10 Devonshire - New Office."),
        ("Title: LON40 | Projects | 5th Floor\nbody", "LON40 | Projects | 5th Floor"),
        ("LON53 | 9th Floor | Resecure Foam Panels", "LON53 | 9th Floor | Resecure Foam Panels"),
        ("", ""),
    ]
    for desc, want in cases:
        n += 1; fails += not check("first_line", first_line(desc), want)

    # --- extract_refs (PO/REQ -> PO Number ; standalone 8-9 digit -> SF) ---
    ref_cases = [
        (("Awaiting PO - Sorcha", None),   {"po": None,          "sf": None}),
        (("REQ-00928050 - Yemi", None),    {"po": "REQ-00928050", "sf": None}),
        (("PROJ | PO-01048711", None),     {"po": "PO-01048711",  "sf": None}),
        (("12008971", "12008971"),         {"po": None,          "sf": "12008971"}),
        (("Approved by CM Yalde", None),   {"po": None,          "sf": None}),
        (("125854556", None),              {"po": None,          "sf": "125854556"}),  # 9-digit test job
        (("PO-01048711", "12008971"),      {"po": "PO-01048711",  "sf": "12008971"}),  # both, diff fields
    ]
    for args, want in ref_cases:
        n += 1; fails += not check(f"extract_refs{args}", extract_refs(*args), want)

    # --- JL status -> Monday ---
    st_cases = [
        (5,  {"pm": "Assigned",            "finance": None}),
        (7,  {"pm": "Project In Progress", "finance": None}),
        (8,  {"pm": None,                  "finance": "To Invoice"}),
        (4,  {"pm": "Complete",            "finance": "Invoiced"}),
        (10, {"pm": "Lost/Not Progressed", "finance": None}),
        (999,{"pm": None,                  "finance": None}),  # unknown
    ]
    for sid, want in st_cases:
        n += 1; fails += not check(f"jl_status[{sid}]", jl_status_to_monday(status_id=sid), want)

    # --- Monday PM -> JL (push-back) ---
    pm_cases = [
        ("Snagging",            {"push": True,  "jl_status_id": 5,  "jl_status_name": "New Job"}),
        ("Complete",            {"push": True,  "jl_status_id": 11, "jl_status_name": "Completed"}),
        ("Lost/Not Progressed", {"push": True,  "jl_status_id": 10, "jl_status_name": "Cancelled"}),
        ("Approved",            {"push": False, "jl_status_id": None, "jl_status_name": None}),
        ("Scoping",             {"push": False, "jl_status_id": None, "jl_status_name": None}),
        ("Project In Progress", {"push": False, "jl_status_id": None, "jl_status_name": None}),
    ]
    for pm, want in pm_cases:
        n += 1; fails += not check(f"monday_pm[{pm}]", monday_pm_to_jl(pm), want)

    print(f"\n{n-fails}/{n} passed" + ("" if not fails else f"  ({fails} FAILED)"))
    return fails


if __name__ == "__main__":
    raise SystemExit(1 if main() else 0)
