"""Pure field mappers shared by every JobLogic⇄Monday path (create, sync, TM relay).

No I/O — just the rules. Validated against live data 2026-07-23. See CONSOLIDATION.md §3.
"""
import re

_TITLE = re.compile(r"^\s*title\s*:\s*", re.I)
_PO     = re.compile(r"(?:PO|REQ)-?\d+", re.I)          # PO or REQ token -> PO Number
_ALPHA  = re.compile(r"[A-Za-z]+-?\d+")                  # any alpha-prefixed token (strip before SF scan)
_SF     = re.compile(r"\b\d{8,9}\b")                     # standalone 8-9 digit Salesforce id


def first_line(description):
    """Monday item Name = first non-empty line of the JL Description, 'Title:' stripped, <=255 chars."""
    for line in (description or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = _TITLE.sub("", line.strip())
        if t:
            return t[:255]
    return ""


def extract_refs(*fields):
    """Scan JL OrderNumber + ReferenceNumber (any order) and return {'po':..., 'sf':...}.

    PO Number  <- first (PO|REQ)-?\\d+ token.
    Client Ref <- a standalone 8-9 digit number NOT attached to an alpha prefix
                  (so digits inside PO-01048711 / REQ-00928050 are NOT taken as an SF id).
    Free-text like 'Awaiting PO' / 'Approved by CM' yields neither.
    """
    blob = " ".join(f for f in fields if f)
    po = _PO.search(blob)
    sf = _SF.search(_ALPHA.sub(" ", blob))
    return {"po": po.group(0) if po else None,
            "sf": sf.group(0) if sf else None}
