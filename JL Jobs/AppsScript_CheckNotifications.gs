/**
 * Joblogic Notification Monitor (Google Apps Script version)
 *
 * Polls Joblogic's API every 15 minutes for recently logged jobs and sends
 * an email when a job matches: logged from the Customer Portal by Lynn Forsyth.
 *
 * SETUP:
 *  1. Go to https://script.google.com and create a new project.
 *  2. Paste this file in as Code.gs.
 *  3. Get a Client ID / Secret from Joblogic's "API Access" app.
 *     (Login to Joblogic > apps > API Access.)
 *  4. In Apps Script: Project Settings > Script Properties, add:
 *       - JOBLOGIC_CLIENT_ID
 *       - JOBLOGIC_CLIENT_SECRET
 *  5. Run setupTrigger() ONCE to install the 15-minute schedule.
 *  6. Grant permissions when prompted (Gmail send + UrlFetch + Properties).
 *
 * CONFIG:
 *  - RECIPIENT_EMAIL is set to joe.segal@up-fm.com (test mode).
 *    Swap to ellee.dunne@up-fm.com for production.
 *  - Adjust API_BASE and endpoint paths per Joblogic's latest docs
 *    (apidocs.joblogic.com). The paths below are templates.
 */

// ---------- CONFIG ----------
const RECIPIENT_EMAIL = "joe.segal@up-fm.com";        // Test mode
// const RECIPIENT_EMAIL = "ellee.dunne@up-fm.com";   // Production mode

const TARGET_TEXT = "has been logged from the Customer Portal by Lynn Forsyth";
const TARGET_LOGGED_BY = "Lynn Forsyth";
const TARGET_SOURCE = "Customer Portal";

// Joblogic API — adjust if your docs show different paths
const API_BASE = "https://api.joblogic.com";
const TOKEN_ENDPOINT = API_BASE + "/oauth/token";
const JOBS_ENDPOINT = API_BASE + "/v1/jobs";
// Alternative endpoint to try if the above doesn't exist:
// const NOTIFICATIONS_ENDPOINT = API_BASE + "/v1/notifications";

// ---------- MAIN ENTRY POINTS ----------

/**
 * Called by the 15-minute trigger. Also runnable manually for testing.
 */
function checkNotifications() {
  const props = PropertiesService.getScriptProperties();
  const seenIdsRaw = props.getProperty("SEEN_JOB_IDS") || "[]";
  const seenIds = new Set(JSON.parse(seenIdsRaw));

  let token;
  try {
    token = getAccessToken_();
  } catch (err) {
    Logger.log("Auth failed: " + err);
    return;
  }

  const jobs = fetchRecentJobs_(token);
  Logger.log("Fetched " + jobs.length + " recent jobs.");

  let newMatches = 0;
  for (const job of jobs) {
    const matches = jobMatches_(job);
    if (!matches) continue;

    const jobId = String(job.Id || job.JobId || job.Reference || job.JobNumber);
    if (seenIds.has(jobId)) continue;

    seenIds.add(jobId);
    newMatches++;
    sendAlert_(job);
  }

  // Persist seen IDs (keep the most recent 500 to avoid growing forever)
  const trimmed = Array.from(seenIds).slice(-500);
  props.setProperty("SEEN_JOB_IDS", JSON.stringify(trimmed));

  Logger.log("New matches: " + newMatches);
}

/**
 * Install a trigger that runs checkNotifications every 15 minutes.
 * Run this ONCE from the Apps Script editor.
 */
function setupTrigger() {
  // Remove any existing triggers for this function first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "checkNotifications") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("checkNotifications")
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log("Trigger installed. checkNotifications will run every 15 minutes.");
}

/**
 * Manual test: send a dummy alert email. Run this to verify Gmail permissions.
 */
function testEmail() {
  sendAlert_({
    JobNumber: "TEST-001",
    Description: "Test job",
    Source: "Customer Portal",
    LoggedBy: "Lynn Forsyth",
    DateLogged: new Date().toISOString()
  });
}

// ---------- HELPERS ----------

/**
 * Get an OAuth access token from Joblogic using the Client ID/Secret.
 * Adjust this if Joblogic uses a different auth scheme (e.g. static API key).
 */
function getAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty("JOBLOGIC_CLIENT_ID");
  const clientSecret = props.getProperty("JOBLOGIC_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Set JOBLOGIC_CLIENT_ID and JOBLOGIC_CLIENT_SECRET in Script Properties.");
  }

  // Check cache first (tokens usually last an hour)
  const cache = CacheService.getScriptCache();
  const cached = cache.get("JOBLOGIC_TOKEN");
  if (cached) return cached;

  const resp = UrlFetchApp.fetch(TOKEN_ENDPOINT, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error("Token request failed: " + resp.getResponseCode() + " " + resp.getContentText());
  }

  const data = JSON.parse(resp.getContentText());
  const token = data.access_token;
  const expires = (data.expires_in || 3600) - 60; // 1-min safety margin
  cache.put("JOBLOGIC_TOKEN", token, expires);
  return token;
}

/**
 * Fetch jobs logged in the last 30 minutes.
 * Adjust the endpoint / query params to match Joblogic's actual API.
 */
function fetchRecentJobs_(token) {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 60 * 1000); // 30 min back
  const sinceIso = since.toISOString();

  // Common query patterns — adjust to whatever Joblogic documents
  const url = JOBS_ENDPOINT
    + "?loggedFrom=" + encodeURIComponent(sinceIso)
    + "&pageSize=50";

  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/json"
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    Logger.log("Jobs fetch failed: " + resp.getResponseCode() + " " + resp.getContentText());
    return [];
  }

  const data = JSON.parse(resp.getContentText());
  // Response shape varies — handle a few common layouts
  return data.Data || data.data || data.Jobs || data.items || data || [];
}

/**
 * Check whether a job matches: logged from Customer Portal by Lynn Forsyth.
 */
function jobMatches_(job) {
  const source = String(job.Source || job.LoggedFrom || job.JobSource || "");
  const loggedBy = String(job.LoggedBy || job.CreatedBy || job.UserCreated || "");
  const description = String(job.Description || job.Notes || "");

  // Primary: structured fields
  if (source.indexOf(TARGET_SOURCE) !== -1 && loggedBy.indexOf(TARGET_LOGGED_BY) !== -1) {
    return true;
  }

  // Fallback: raw text match against the whole job record
  const blob = JSON.stringify(job);
  return blob.indexOf(TARGET_TEXT) !== -1;
}

/**
 * Send the alert email.
 */
function sendAlert_(job) {
  const jobRef = job.JobNumber || job.Reference || job.Id || "(unknown)";
  const description = job.Description || "(no description)";
  const dateLogged = job.DateLogged || job.CreatedDate || new Date().toISOString();

  const subject = "Joblogic Alert: New Customer Portal Job from Lynn Forsyth (" + jobRef + ")";
  const body =
    "<h2>New Job Logged from Customer Portal</h2>" +
    "<p>A job matching your criteria has been logged in Joblogic.</p>" +
    "<ul>" +
    "  <li><strong>Job ref:</strong> " + jobRef + "</li>" +
    "  <li><strong>Description:</strong> " + description + "</li>" +
    "  <li><strong>Logged by:</strong> " + (job.LoggedBy || "Lynn Forsyth") + "</li>" +
    "  <li><strong>Source:</strong> " + (job.Source || "Customer Portal") + "</li>" +
    "  <li><strong>Date logged:</strong> " + dateLogged + "</li>" +
    "</ul>" +
    "<p><a href=\"https://go.joblogic.com/Job\">Open in Joblogic</a></p>";

  GmailApp.sendEmail(RECIPIENT_EMAIL, subject, "", { htmlBody: body });
  Logger.log("Alert sent to " + RECIPIENT_EMAIL + " for job " + jobRef);
}
