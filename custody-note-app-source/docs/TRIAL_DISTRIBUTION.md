# Trial Version Distribution

When emailing the trial version of Custody Note to a potential user, you **must include the database** along with the app. The database **must be blank** (no attendance records) so the recipient starts with a clean slate.

## Automated preparation

Run **`npm run prepare-trial`** (or use **Menu → Prepare trial for email** in the app). This will:

1. Build the app if needed
2. Create a blank database and encryption keys
3. Package the app + userData into a zip on your Desktop
4. Open the Desktop folder

Then attach the zip (`CustodyNote-Trial-YYYY-MM-DD.zip`) to your email and send.

## What to include

1. **The app** (installer or portable build)
2. **A blank database** (`attendances.db`) – with no records
3. **Encryption key files** (so the DB can be opened):
   - `encryption.key` (or `master.fallback` if safeStorage was unavailable)
   - Optionally `recovery.dat` if you set a recovery password for the trial package

## How to create a blank database for trial distribution

1. Run the app on a clean profile (or use a fresh userData path).
2. On first launch, the app creates an empty `attendances.db` in userData.
3. **Before adding any records**, copy the entire userData folder (or at minimum `attendances.db` + encryption key file(s)).
4. Package the app + userData together for the recipient.

**Alternative:** If you already have data:
- Take a backup, then delete all attendance records and firms if needed, or
- Run the app with a temporary/portable userData directory to generate a fresh blank DB, then copy it.

## Why the database must be blank

- Recipients should start the trial with no pre-existing data.
- They get the full trial experience (30-day trial) without seeing someone else's records.
- Avoids any privacy or confidentiality issues.
