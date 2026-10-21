-- raw.engineer_daily_sites: allocator's daily AM/PM engineer sites (Planner Non-Productive Time).
-- Loaded by load_engineer_sites.py (cron, Visit/SearchPlanner); each run replaces its date window.
-- One row per engineer per day that has any NPT. Recurring NPT only appears from the day itself,
-- so rows for future dates are not loaded.
CREATE OR REPLACE TABLE `vmimporteddata.raw.engineer_daily_sites` (
  date            DATE      NOT NULL OPTIONS(description="Planner day (Europe/London)"),
  engineer_id     INT64     NOT NULL OPTIONS(description="Joblogic engineer Id (Engineer/GetAll Id)"),
  engineer        STRING             OPTIONS(description="Engineer name"),
  engineer_email  STRING             OPTIONS(description="Engineer email from Engineer/GetAll, when present"),
  am_site         STRING             OPTIONS(description="First site-type NPT of the day"),
  pm_site         STRING             OPTIONS(description="Second site-type NPT; = am_site when only one was set (whole day)"),
  extra_sites     STRING             OPTIONS(description="Any 3rd+ site markers, / separated"),
  region          STRING             OPTIONS(description="Region-type NPT (East, West - Region 1, ...)"),
  other_npt       STRING             OPTIONS(description="Non-site NPT: leave, sickness, placeholder, early starter... with UK times and reason"),
  is_unavailable  BOOL               OPTIONS(description="Has AL/Holiday/Sick Leave/NOT AVAILABLE that day"),
  _ingested_at    TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY engineer_id
OPTIONS(description="Allocator daily AM/PM engineer sites from Joblogic Planner Non-Productive Time (Visit/SearchPlanner). Loaded by load_engineer_sites.py; each run replaces today-7..today.");
