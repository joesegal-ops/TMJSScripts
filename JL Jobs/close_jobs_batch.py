#!/usr/bin/env python3
"""
Fast batch-close Joblogic jobs using Chrome MCP automation.

This script is designed to be run step-by-step via Claude Code with Chrome MCP.
It provides JavaScript snippets that batch-process jobs via API calls,
dramatically faster than the sequential UI approach.

Flow:
  1. Read job IDs from Google Sheet
  2. Batch-search all jobs via /api/Job/SearchJsonData to get internal IDs
  3. Batch-complete jobs via /api/Job/CompleteJobPost
  4. Batch-tag jobs with "Solved on SF" via multi-tab UI automation

Prerequisites:
  pip install gspread
  Google Sheets OAuth set up via gspread
"""

import json
import sys
import gspread

SHEET_ID = "1ZZ8s53qLxiqJp8tPimuvTeTMcLMTyofCFq3_rAtPsAY"


def read_job_ids():
    """Read job IDs from Column A of the Google Sheet."""
    gc = gspread.oauth()
    sh = gc.open_by_key(SHEET_ID)
    ws = sh.sheet1
    values = ws.col_values(1)

    # Skip header row if present
    if values and values[0].lower() in ("job id", "job no", "job no.", "jobid", "job number", "id"):
        values = values[1:]

    # Filter out empty strings
    job_ids = [v.strip() for v in values if v.strip()]
    return job_ids


def generate_batch_search_js(job_ids):
    """Generate JS to batch-search all job references and resolve to internal IDs."""
    return f"""
(async () => {{
    const jobRefs = {json.dumps(job_ids)};
    const results = {{}};
    const errors = [];
    const token = document.querySelector('input[name="__RequestVerificationToken"]')?.value;

    // Process in batches of 5 concurrent requests
    const BATCH_SIZE = 5;
    for (let i = 0; i < jobRefs.length; i += BATCH_SIZE) {{
        const batch = jobRefs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (ref) => {{
            try {{
                const resp = await fetch('/api/Job/SearchJsonData', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json',
                        '__RequestVerificationToken': token || ''
                    }},
                    body: JSON.stringify({{
                        SearchTerm: ref,
                        PageSize: 5,
                        PageIndex: 1,
                        EngineerType: 0,
                        IncludePPMJobs: true,
                        IncludeReactiveJobs: true,
                        StartLoggedDate: '',
                        EndLoggedDate: '',
                        StartDate: '',
                        EndDate: '',
                        StartCompleteDate: '',
                        EndCompleteDate: '',
                        StartNextContactDate: '',
                        EndNextContactDate: ''
                    }})
                }});
                const data = await resp.json();
                // Jobs are in AdditionalData.Jobs (Joblogic-specific response shape)
                const jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
                const match = jobs.find(j => j.JobNumber === ref || j.ReferenceNumber === ref);
                if (match) {{
                    results[ref] = {{
                        id: match.Id || match.JobId,
                        status: match.Status || match.JobStatus,
                        hasTag: false
                    }};
                }} else if (jobs.length > 0) {{
                    // Take first result
                    results[ref] = {{
                        id: jobs[0].Id || jobs[0].JobId,
                        status: jobs[0].Status || jobs[0].JobStatus,
                        hasTag: false
                    }};
                }} else {{
                    errors.push(ref + ': not found');
                }}
            }} catch (e) {{
                errors.push(ref + ': ' + e.message);
            }}
        }});
        await Promise.all(promises);
    }}

    return JSON.stringify({{
        found: Object.keys(results).length,
        notFound: errors.length,
        results,
        errors
    }});
}})()
"""


def generate_batch_complete_js(jobs_to_complete):
    """Generate JS to batch-complete jobs via API.

    jobs_to_complete: list of {ref, internalId} dicts
    """
    return f"""
(async () => {{
    const jobs = {json.dumps(jobs_to_complete)};
    const results = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {{
        const batch = jobs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (job) => {{
            try {{
                // Step 1: GET the complete job modal to get CSRF token
                const modalResp = await fetch('/Job/CompleteJob/' + job.id);
                const modalHtml = await modalResp.text();

                // Extract token from modal HTML
                const tokenMatch = modalHtml.match(/name="__RequestVerificationToken".*?value="([^"]+)"/);
                if (!tokenMatch) {{
                    results.push({{ref: job.ref, status: 'error', msg: 'no CSRF token'}});
                    return;
                }}
                const token = tokenMatch[1];

                // Step 2: POST to complete the job
                const now = new Date();
                const dateStr = now.toLocaleDateString('en-GB', {{
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false
                }}).replace(',', '');

                const formData = new FormData();
                formData.append('Id', job.id);
                formData.append('DateComplete', dateStr);
                formData.append('CancelOpenVisits', 'true');
                formData.append('__RequestVerificationToken', token);

                const completeResp = await fetch('/api/Job/CompleteJobPost', {{
                    method: 'POST',
                    body: formData
                }});

                if (completeResp.ok) {{
                    results.push({{ref: job.ref, status: 'completed'}});
                }} else {{
                    results.push({{ref: job.ref, status: 'error', msg: 'HTTP ' + completeResp.status}});
                }}
            }} catch (e) {{
                results.push({{ref: job.ref, status: 'error', msg: e.message}});
            }}
        }});
        await Promise.all(promises);
    }}

    return JSON.stringify(results);
}})()
"""


def generate_tag_js():
    """Generate JS to add 'Solved on SF' tag on current job detail page."""
    return """
(() => {
    const tagDiv = document.getElementById('TagsJob_Id');
    if (!tagDiv) return 'TagsJob_Id not found';
    let el = tagDiv; let vue = null;
    while (el && !vue) { vue = el.__vue__; el = el.parentElement; }
    if (!vue) return 'Vue instance not found';
    const solvedOpt = vue.options.find(o => o.Title === 'Solved on SF');
    if (!solvedOpt) return 'Solved on SF option not found';
    if (solvedOpt.selected) return 'Already tagged';
    vue.toggleOptionStatus(solvedOpt);
    return 'Tag added';
})()
"""


def main():
    print("Reading job IDs from Google Sheet...")
    try:
        job_ids = read_job_ids()
    except Exception as e:
        print(f"ERROR reading Google Sheet: {e}")
        sys.exit(1)

    if not job_ids:
        print("No job IDs found in Column A. Exiting.")
        sys.exit(0)

    print(f"Found {len(job_ids)} job IDs to process.\n")
    print("Job IDs:", ", ".join(job_ids))
    print()

    # Generate the batch search JS
    print("=" * 60)
    print("STEP 1: Copy and run this JS in Chrome DevTools console")
    print("        (or use via Chrome MCP javascript_tool)")
    print("=" * 60)
    print()
    print("--- Batch Search JS ---")
    print(generate_batch_search_js(job_ids))
    print()

    print("After running the search, paste the results JSON here")
    print("to generate the batch complete JS.")


if __name__ == "__main__":
    main()
