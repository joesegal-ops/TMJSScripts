-- Salesforce "UP Support Request Report - ALL 7Days" -> importdata-494110.Salesforce
-- The report is a rolling window, so each day's CSV is loaded to support_requests_staging
-- (WRITE_TRUNCATE) and MERGEd into support_requests: one row per Support_Request_ID,
-- the most recently MODIFIED version wins (so files can be loaded in any order, incl. a historic
-- export), and requests that drop out of the window are kept.
-- Loader: salesforce-to-bq.gs (Apps Script, daily after the 10:00 UK email).

-- 1) Upsert (run after every staging load; the Apps Script runs this same statement)
MERGE `importdata-494110.Salesforce.support_requests` t
USING (
  SELECT * REPLACE (LEFT(Support_Request_ID, 15) AS Support_Request_ID) FROM `importdata-494110.Salesforce.support_requests_staging`
  WHERE NULLIF(Support_Request_ID, '') IS NOT NULL
  -- Daily report sends 18-char IDs, Salesforce CSV exports 15-char: key on the 15-char form.
  QUALIFY ROW_NUMBER() OVER (PARTITION BY LEFT(Support_Request_ID, 15)) = 1
) s
ON t.Support_Request_ID = s.Support_Request_ID
WHEN MATCHED AND IFNULL(SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', s.Date_Time_Last_Modified), DATETIME '1900-01-01')
        >= IFNULL(SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', t.Date_Time_Last_Modified), DATETIME '1900-01-01') THEN UPDATE SET
  Support_Request_Owner = s.Support_Request_Owner, Account_Name = s.Account_Name, Subject = s.Subject,
  Date_Time_Opened = s.Date_Time_Opened, Age = s.Age, Open = s.Open, Status = s.Status,
  Opened_Date = s.Opened_Date, Date_Time_Last_Modified = s.Date_Time_Last_Modified,
  Member_Name = s.Member_Name, Support_Request_Type = s.Support_Request_Type,
  Support_Request_Owner_Alias = s.Support_Request_Owner_Alias, Support_Request_Number = s.Support_Request_Number,
  Account_Owner = s.Account_Owner, Account_Owner_Alias = s.Account_Owner_Alias, Description = s.Description,
  Priority = s.Priority, Primary_Member_Name = s.Primary_Member_Name, Floor = s.Floor,
  Office_Numbers = s.Office_Numbers, Support_Request_Subtype = s.Support_Request_Subtype,
  Building_Name = s.Building_Name,
  Report_Date = CURRENT_DATE('Europe/London'), Loaded_At = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (Support_Request_Owner, Account_Name, Subject, Date_Time_Opened, Age, Open, Status, Opened_Date, Date_Time_Last_Modified, Member_Name, Support_Request_Type, Support_Request_Owner_Alias, Support_Request_Number, Account_Owner, Account_Owner_Alias, Description, Priority, Primary_Member_Name, Floor, Office_Numbers, Support_Request_Subtype, Building_Name, Support_Request_ID, Report_Date, Loaded_At)
  VALUES (s.Support_Request_Owner, s.Account_Name, s.Subject, s.Date_Time_Opened, s.Age, s.Open, s.Status, s.Opened_Date, s.Date_Time_Last_Modified, s.Member_Name, s.Support_Request_Type, s.Support_Request_Owner_Alias, s.Support_Request_Number, s.Account_Owner, s.Account_Owner_Alias, s.Description, s.Priority, s.Primary_Member_Name, s.Floor, s.Office_Numbers, s.Support_Request_Subtype, s.Building_Name, s.Support_Request_ID, CURRENT_DATE('Europe/London'), CURRENT_TIMESTAMP());

-- 2) Typed view. Salesforce exports US formats: dates M/D/YYYY, date-times "M/D/YYYY, h:mm AM".
CREATE OR REPLACE VIEW `importdata-494110.Salesforce.support_requests_clean` AS
SELECT
  Support_Request_ID,
  SAFE_CAST(Support_Request_Number AS INT64)                                    AS Support_Request_Number,
  Subject, Description, Status,
  (Open = '1')                                                                  AS Is_Open,
  Priority, Support_Request_Type, Support_Request_Subtype,
  SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', NULLIF(Date_Time_Opened, ''))        AS Date_Time_Opened,
  SAFE.PARSE_DATE('%m/%d/%Y', NULLIF(Opened_Date, ''))                          AS Opened_Date,
  SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', NULLIF(Date_Time_Last_Modified, '')) AS Date_Time_Last_Modified,
  SAFE_CAST(Age AS NUMERIC)                                                     AS Age_Hours,
  Member_Name, Primary_Member_Name, Account_Name, Account_Owner, Account_Owner_Alias,
  Support_Request_Owner, Support_Request_Owner_Alias,
  Building_Name, Floor, Office_Numbers,
  Report_Date AS Last_Seen_In_Report, Loaded_At
FROM `importdata-494110.Salesforce.support_requests`;
