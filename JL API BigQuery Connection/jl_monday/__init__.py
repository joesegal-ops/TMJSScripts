"""Shared JobLogic⇄Monday integration package (see CONSOLIDATION.md).

Phase 1 foundation: pure mappers + status maps. Clients / pollers / LWW engine land here next.
"""
from .mappers import first_line, extract_refs
from .status_map import jl_status_to_monday, monday_pm_to_jl, JL_STATUS, MONDAY_PM

__all__ = ["first_line", "extract_refs", "jl_status_to_monday", "monday_pm_to_jl",
           "JL_STATUS", "MONDAY_PM"]
