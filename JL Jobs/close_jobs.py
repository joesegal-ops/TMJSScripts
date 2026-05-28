#!/usr/bin/env python3
"""
Bulk-complete Joblogic jobs using job IDs from a Google Sheet.

Prerequisites:
  pip install playwright gspread
  playwright install chromium
  Set up a Google Cloud service account and save the JSON key to:
    ~/.config/gspread/service_account.json
  Share the Google Sheet with the service account's client_email.
"""

import sys
import time
import gspread
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

SHEET_ID = "1ZZ8s53qLxiqJp8tPimuvTeTMcLMTyofCFq3_rAtPsAY"
JOBLOGIC_JOBS_URL = "https://go.joblogic.com/Job"


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


def add_solved_on_sf_tag(page, job_id, prefix):
    """Add the 'Solved on SF' tag to the current job page."""
    try:
        # Click Edit button to enable editing
        edit_btn = page.locator('button:has-text("Edit"), a:has-text("Edit")').first
        if not edit_btn.is_visible(timeout=3000):
            print(f"{prefix} WARNING: Edit button not found for {job_id}. Skipping tag.")
            return
        edit_btn.click()
        time.sleep(1)

        # Use JavaScript to select "Solved on SF" in the Vue multiselect Tags widget
        page.evaluate("""
            () => {
                const tagDiv = document.getElementById('TagsJob_Id');
                if (!tagDiv) return false;
                let el = tagDiv;
                let vue = null;
                while (el && !vue) {
                    vue = el.__vue__;
                    el = el.parentElement;
                }
                if (!vue) return false;
                const solvedOpt = vue.options.find(o => o.Title === 'Solved on SF');
                if (!solvedOpt || solvedOpt.selected) return false;
                vue.toggleOptionStatus(solvedOpt);
                return true;
            }
        """)
        time.sleep(0.5)

        # Click Save button
        save_btn = page.locator('button:has-text("Save")').first
        save_btn.click()
        time.sleep(2)
        page.wait_for_load_state("networkidle", timeout=15000)

        print(f"{prefix} Tagged {job_id} with 'Solved on SF'.")
    except Exception as e:
        print(f"{prefix} WARNING: Could not add tag to {job_id}: {e}")


def complete_job(page, job_id, index, total):
    """Search for a job by ID, open it, and mark it as complete."""
    prefix = f"[{index}/{total}]"
    print(f"{prefix} Processing job {job_id}...")

    # Navigate to jobs page
    page.goto(JOBLOGIC_JOBS_URL, wait_until="networkidle", timeout=30000)

    # Clear status filter if present (click the X on any status tag)
    try:
        status_clear = page.locator(".filter-option-close, .select2-selection__clear").first
        if status_clear.is_visible(timeout=2000):
            status_clear.click()
            time.sleep(0.5)
    except (PlaywrightTimeout, Exception):
        pass

    # Type job ID in search box
    search_box = page.locator(
        'input[placeholder*="Customer / Site / Job Number"]'
    )
    search_box.fill(job_id)
    time.sleep(0.3)

    # Click Search
    page.locator('button[type="submit"]:has-text("Search"), button:has-text("Search")').first.click()
    time.sleep(2)

    # Find and click the job link in results
    job_link = page.locator(f'a[href*="/Job/Detail/"]:has-text("{job_id}")').first
    if not job_link.is_visible(timeout=5000):
        print(f"{prefix} WARNING: Job {job_id} not found in search results. Skipping.")
        return False

    job_link.click()
    page.wait_for_load_state("networkidle", timeout=15000)
    time.sleep(1)

    # Check if the job is already completed
    try:
        status_badge = page.locator('.badge, .label').filter(has_text="Completed").first
        if status_badge.is_visible(timeout=2000):
            print(f"{prefix} Job {job_id} is already completed. Adding tag only.")
            add_solved_on_sf_tag(page, job_id, prefix)
            return True
    except (PlaywrightTimeout, Exception):
        pass

    # Click "Complete Job" button
    complete_job_btn = page.locator("#completeJob, a.btnCompleteJob").first
    if not complete_job_btn.is_visible(timeout=5000):
        print(f"{prefix} WARNING: 'Complete Job' button not found for {job_id}. Skipping.")
        return False

    complete_job_btn.click()
    time.sleep(1)

    # Wait for the modal to appear
    modal = page.locator("#modalSwitchContainer, .jlSwitchModal")
    modal.wait_for(state="visible", timeout=10000)
    time.sleep(0.5)

    # Check the "Cancel open visits" checkbox
    checkbox = page.locator("#CancelOpenVisits")
    if not checkbox.is_checked():
        checkbox.check()
        time.sleep(0.3)

    # Click "Complete" button in the modal
    complete_btn = page.locator(
        '#modalSwitchContainer button.jl-button-save, '
        '#modalSwitchContainer button:has-text("Complete")'
    ).first
    complete_btn.click()

    # Wait for completion (page should reload or status should change)
    time.sleep(3)
    page.wait_for_load_state("networkidle", timeout=15000)

    print(f"{prefix} Job {job_id} completed successfully.")

    # Add "Solved on SF" tag
    add_solved_on_sf_tag(page, job_id, prefix)

    return True


def main():
    # Step 1: Read job IDs from Google Sheet
    print("Reading job IDs from Google Sheet...")
    try:
        job_ids = read_job_ids()
    except Exception as e:
        print(f"ERROR reading Google Sheet: {e}")
        print("\nMake sure you have:")
        print("  1. OAuth credentials at ~/.config/gspread/credentials.json")
        print("  2. The Google Sheets API enabled on your GCP project")
        sys.exit(1)

    if not job_ids:
        print("No job IDs found in Column A. Exiting.")
        sys.exit(0)

    print(f"Found {len(job_ids)} job IDs to process.\n")

    # Step 2: Launch browser and wait for login
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        page.goto("https://go.joblogic.com", wait_until="networkidle")
        print("=" * 60)
        print("Please log in to Joblogic in the browser window.")
        print("You have 60 seconds to log in...")
        print("=" * 60)
        time.sleep(60)
        print("Continuing...")

        # Step 3: Process each job
        succeeded = []
        failed = []

        for i, job_id in enumerate(job_ids, start=1):
            try:
                ok = complete_job(page, job_id, i, len(job_ids))
                if ok:
                    succeeded.append(job_id)
                else:
                    failed.append(job_id)
            except Exception as e:
                print(f"[{i}/{len(job_ids)}] ERROR on job {job_id}: {e}")
                failed.append(job_id)

            # Small pause between jobs
            time.sleep(1)

        # Step 4: Summary
        print("\n" + "=" * 60)
        print(f"DONE. {len(succeeded)} completed, {len(failed)} failed.")
        if failed:
            print(f"\nFailed jobs: {', '.join(failed)}")
        print("=" * 60)

        browser.close()


if __name__ == "__main__":
    main()
