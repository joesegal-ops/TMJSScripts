-- Quote status change-data-capture. Runs daily (after the quote refresh). Appends a row whenever a
-- quote's status differs from the last time we observed it (and seeds every quote on first run).
-- "Date rejected" (which the API does not expose) = the first observed_at where new_status = 'Rejected'.
-- Forward-looking: accurate from the day this was switched on (seeded rows are approximate = seed date).

CREATE TABLE IF NOT EXISTS `vmimporteddata.raw.quote_status_events` (
  quote_id     INT64,
  quote_number STRING,
  old_status   STRING,   -- NULL on the seed/first observation
  new_status   STRING,
  observed_at  TIMESTAMP
);

INSERT INTO `vmimporteddata.raw.quote_status_events` (quote_id, quote_number, old_status, new_status, observed_at)
WITH cur AS (
  SELECT Id AS quote_id,
         ANY_VALUE(QuoteNumber) AS quote_number,
         ANY_VALUE(QuoteStatusDescription) AS status
  FROM `vmimporteddata.raw.quotes`
  WHERE Id IS NOT NULL
  GROUP BY Id
),
last_seen AS (
  SELECT quote_id, new_status AS status
  FROM `vmimporteddata.raw.quote_status_events`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY quote_id ORDER BY observed_at DESC) = 1
)
SELECT c.quote_id, c.quote_number, l.status, c.status, CURRENT_TIMESTAMP()
FROM cur c
LEFT JOIN last_seen l ON l.quote_id = c.quote_id
WHERE l.quote_id IS NULL                              -- new quote (seed)
   OR IFNULL(l.status, '') != IFNULL(c.status, '');   -- status changed since last observation
