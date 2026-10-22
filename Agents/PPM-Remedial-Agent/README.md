# PPM Remedial Agent

A Google Apps Script that runs in Google's cloud as **Openclaw.test@up-fm.com**. Every 10 minutes it:

1. Finds new emails sent to **subcontractors@up-fm.com** (looking back 3 days).
2. Sends the email body, any PDFs and any photos to Claude (`claude-opus-5-5`).
3. Writes a row for every email to the **Log** tab of the "PPM Remedial Flags" Google Sheet.
4. If remedial action is needed, writes one row per remedial item to the **Remedials** tab and labels the Gmail thread `PPM/Remedial required`.
5. Labels the thread `PPM/Review` when Claude's confidence is low, or when the email still failed after 3 attempts.

## One-time setup (about 10 minutes)

1. **Sign in as Openclaw.test@up-fm.com** in a separate Chrome profile or an incognito window.
2. Go to <https://script.google.com> and click **New project**. Rename it "PPM Remedial Agent".
3. **Code:** replace the contents of `Code.gs` with this folder's `Code.gs`.
4. **Manifest:** open Project Settings (the cog), tick **Show "appsscript.json" manifest file in editor**, then paste in this folder's `appsscript.json`.
5. **API key:** in Project Settings, under **Script Properties**, add `ANTHROPIC_API_KEY` with your key from <https://console.anthropic.com> (Settings → API keys). Use a dedicated key for this script.
6. **Run `setup`:** in the editor, pick `setup` from the function dropdown and click **Run**. Approve the Gmail, Sheets and external-request permissions. The execution log prints the URL of the new Sheet.
7. **Share the Sheet** with the ops team. The Sheet is owned by the Openclaw mailbox.
8. **First run:** pick `processInbox` and **Run**. Check the Log tab. Each run handles up to 6 emails.
9. **Schedule it:** pick `installTrigger` and **Run**. From now on it runs every 10 minutes with no further action.

## Using the Sheet

- **Remedials** is the working list. The columns Action owner, Status (starts as "New") and Notes are for the team to fill in. The script only ever adds rows, so team edits are never overwritten.
- **Log** has every email the script looked at. Use it to spot emails that should have been flagged but weren't. Use the Message ID column to stop an email being reprocessed: deleting its row makes the script process that email again.

## Tuning

- **What counts as remedial:** edit `SYSTEM_PROMPT` in `Code.gs` (the EICR codes, gas classifications and other rules).
- **Volume or speed:** change `CONFIG.MAX_PER_RUN`, the trigger interval in `installTrigger()`, or `CONFIG.EFFORT` (`low` is faster and cheaper; `medium` is the default).
- **Cost:** at 10–20 emails a day with PDFs, expect roughly £1–3 a day on Opus 5.5.

## Limits

- Word, Excel and other attachment types are listed in the Log but not read. Ask if you need them; they can be converted through Drive.
- Attachments over 20 MB in total per email are skipped and noted in the Log.
- Each run must finish within Apps Script's 6-minute limit, which is why a run handles 6 emails at most.
