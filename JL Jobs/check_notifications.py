#!/usr/bin/env python3
"""
Monitor Joblogic notifications and send an email alert when a new job
is logged from the Customer Portal by Lynn Forsyth.

Flow:
  1. Launch browser, give user time to log in
  2. Poll the notifications page every 15 minutes
  3. If a notification matches the target text, send an email via Gmail SMTP
  4. Track already-seen notifications to avoid duplicate emails

Prerequisites:
  pip install playwright
  playwright install chromium

Configuration:
  Set GMAIL_APP_PASSWORD below (or via GMAIL_APP_PASSWORD env var).
  Generate an app password at https://myaccount.google.com/apppasswords
"""

import os
import sys
import time
import smtplib
import hashlib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Gmail SMTP settings
GMAIL_ADDRESS = "joe.segal@up-fm.com"
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "YOUR_APP_PASSWORD_HERE")

# Who receives the alert email
RECIPIENT_EMAIL = "joe.segal@up-fm.com"  # Test mode
# RECIPIENT_EMAIL = "ellee.dunne@up-fm.com"  # Production mode

# What to look for in notifications
TARGET_TEXT = "has been logged from the Customer Portal by Lynn Forsyth"

# How often to check (seconds)
CHECK_INTERVAL = 15 * 60  # 15 minutes

# Joblogic URLs
JOBLOGIC_BASE = "https://go.joblogic.com"
NOTIFICATIONS_URL = f"{JOBLOGIC_BASE}/Notification"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

seen_notifications = set()


def notification_hash(text):
    """Create a hash of notification text to track duplicates."""
    return hashlib.sha256(text.encode()).hexdigest()


def send_email(subject, body):
    """Send an alert email via Gmail SMTP."""
    msg = MIMEMultipart()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = RECIPIENT_EMAIL
    msg["Subject"] = subject

    msg.attach(MIMEText(body, "html"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.send_message(msg)
        print(f"  [EMAIL] Sent to {RECIPIENT_EMAIL}")
    except Exception as e:
        print(f"  [EMAIL ERROR] {e}")


def check_notifications(page):
    """Navigate to notifications page and check for matching notifications."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n[{timestamp}] Checking notifications...")

    try:
        page.goto(NOTIFICATIONS_URL, wait_until="networkidle", timeout=30000)
        time.sleep(3)  # Let JS render

        # Get all notification elements - try common selectors
        notifications = page.locator(
            ".notification-item, "
            ".notification-row, "
            "tr.notification, "
            "[class*='notification'], "
            ".list-group-item"
        ).all()

        if not notifications:
            # Fallback: try to get all text content from the main content area
            page_text = page.locator(
                "#main-content, .content-wrapper, .container, body"
            ).first.inner_text()

            if TARGET_TEXT in page_text:
                text_hash = notification_hash(page_text)
                if text_hash not in seen_notifications:
                    seen_notifications.add(text_hash)
                    print(f"  MATCH FOUND (via page text)")
                    send_email(
                        "Joblogic Alert: New Customer Portal Job from Lynn Forsyth",
                        f"""
                        <h2>New Job Logged from Customer Portal</h2>
                        <p>A notification matching your criteria was detected at <strong>{timestamp}</strong>.</p>
                        <p><strong>Match text:</strong> {TARGET_TEXT}</p>
                        <p><a href="{NOTIFICATIONS_URL}">View notifications in Joblogic</a></p>
                        """
                    )
                else:
                    print(f"  Match found but already notified.")
            else:
                print(f"  No matching notifications.")
            return

        print(f"  Found {len(notifications)} notification elements.")
        new_matches = 0

        for notif in notifications:
            try:
                text = notif.inner_text(timeout=5000)
            except Exception:
                continue

            if TARGET_TEXT in text:
                text_hash = notification_hash(text.strip())
                if text_hash not in seen_notifications:
                    seen_notifications.add(text_hash)
                    new_matches += 1
                    print(f"  MATCH: {text.strip()[:100]}...")

                    send_email(
                        "Joblogic Alert: New Customer Portal Job from Lynn Forsyth",
                        f"""
                        <h2>New Job Logged from Customer Portal</h2>
                        <p>A notification matching your criteria was detected at <strong>{timestamp}</strong>.</p>
                        <p><strong>Notification text:</strong></p>
                        <blockquote>{text.strip()}</blockquote>
                        <p><a href="{NOTIFICATIONS_URL}">View notifications in Joblogic</a></p>
                        """
                    )

        if new_matches == 0:
            print(f"  No new matching notifications.")

    except PlaywrightTimeout:
        print(f"  [TIMEOUT] Page took too long to load. Will retry next cycle.")
    except Exception as e:
        print(f"  [ERROR] {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Joblogic Notification Monitor")
    print(f"  Target text: \"{TARGET_TEXT}\"")
    print(f"  Check interval: {CHECK_INTERVAL // 60} minutes")
    print(f"  Sending alerts to: {RECIPIENT_EMAIL}")
    print("=" * 60)

    if GMAIL_APP_PASSWORD == "YOUR_APP_PASSWORD_HERE":
        print("\nWARNING: Gmail app password not set!")
        print("Set it via: export GMAIL_APP_PASSWORD='your-app-password'")
        print("Or edit GMAIL_APP_PASSWORD in this script.")
        print()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        # Navigate to Joblogic login
        page.goto(JOBLOGIC_BASE, wait_until="networkidle")
        print("\nPlease log in to Joblogic in the browser window.")
        print("You have 120 seconds to log in...")
        print("(The monitor will start automatically after login.)\n")

        # Wait for login - check if we reach the dashboard
        logged_in = False
        for i in range(120):
            time.sleep(1)
            current_url = page.url
            if "/Dashboard" in current_url or "/Home" in current_url or "/Job" in current_url:
                logged_in = True
                print("Login detected! Starting monitor...\n")
                break
            if i % 10 == 0 and i > 0:
                print(f"  Waiting for login... ({120 - i}s remaining)")

        if not logged_in:
            print("Assuming login is complete. Starting monitor...\n")

        # Initial check
        check_notifications(page)

        # Poll loop
        print(f"\nNext check in {CHECK_INTERVAL // 60} minutes. Press Ctrl+C to stop.")
        try:
            while True:
                time.sleep(CHECK_INTERVAL)
                check_notifications(page)
                print(f"Next check in {CHECK_INTERVAL // 60} minutes. Press Ctrl+C to stop.")
        except KeyboardInterrupt:
            print("\n\nMonitor stopped by user.")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
