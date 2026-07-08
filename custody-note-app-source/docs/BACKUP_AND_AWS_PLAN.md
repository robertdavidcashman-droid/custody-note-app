# Backup Options Review & AWS Integration Plan

## Goal

- Connect the app to an existing **Amazon Web Services (AWS)** account for backup.
- Implement AWS backup in **Admin / Settings**.
- Review all backup options and give a clear plan so **users and you never lose the app or records**.

---

## 1. Current Backup Options (Review)

| Option | Where | How it works | Status |
|--------|--------|--------------|--------|
| **Local backup folder** | Settings > Backup | User picks a folder (e.g. Desktop). Encrypted `attendance-latest.db` every 2 mins; timestamped hourly archives; up to 48 kept. | **Working** |
| **Off-site folder** | Settings > Backup | Second folder (e.g. OneDrive, Dropbox). Same encrypted files are *copied* there on every backup; sync to cloud is by the user’s client. | **Working** |
| **Cloud backup URL** | Settings > Backup | Optional URL + Bearer token. App has `uploadBackupToCloud()` that POSTs the encrypted buffer. | **Not wired** – URL/token are saved but never used in `backup-now` or quick/hourly backup. |
| **Recovery password** | Settings > Security | Lets you open the encrypted DB on a new machine using `recovery.dat` + password. | **Working** |

**Gap:** The “Cloud backup URL” and “Cloud backup token” fields do nothing until we call `uploadBackupToCloud()` from the backup flow.

---

## 2. What We Will Do

### A. Wire existing “Cloud backup URL” (quick fix)

- In **main.js**, in the `backup-now` handler (and optionally in `runQuickBackup` / `runHourlyBackup`):
  - Read `cloudBackupUrl` and `cloudBackupToken` from the settings table.
  - If URL is set, call `uploadBackupToCloud(url, encryptedBuffer, token)` after writing local/offsite files.
  - If upload fails, log it and optionally show a toast (e.g. “Backup saved locally; cloud upload failed”).
- No new UI; existing “Cloud backup URL” and “Cloud backup token” become active.

### B. Add AWS S3 backup in Admin

- **Settings > Backup**: new subsection **“AWS S3 (optional)”**:
  - Checkbox: **Enable AWS S3 backup**
  - **Region** (e.g. `eu-west-2`)
  - **Bucket name**
  - **Access Key ID** (text)
  - **Secret Access Key** (password field)
- **Backend (main.js)**:
  - Add dependency: `@aws-sdk/client-s3` (official v3 SDK).
  - New helper: `uploadBackupToS3(region, bucket, accessKeyId, secretAccessKey, buffer)`.
  - Upload key pattern: e.g. `custody-note/attendance-latest.db` and optionally `custody-note/archives/attendance-backup-YYYY-MM-DDTHH-mm-ss.db` for “Backup now”.
  - In `backup-now` (and optionally quick/hourly): if AWS S3 is enabled, call this after local/offsite (and after any existing cloud URL upload).
- **Security**: Store AWS credentials in the same settings store (or, later, in OS keychain). Document that users should use an IAM user with minimal policy (e.g. `s3:PutObject`, `s3:GetObject` only on that bucket prefix).

### C. “Never lose app or records” plan (for you and users)

A single place in the app (e.g. **Settings > Backup** or **Help**) that states:

1. **App itself**
   - Keep the installer (or portable build) in a safe place (e.g. second drive, cloud folder).
   - Version is shown in the app footer; match backups to app version when restoring.

2. **Records (data)**
   - **Tier 1 – Local:** Set a **backup folder**. Gives quick + hourly encrypted backups on this machine.
   - **Tier 2 – Same machine, different risk:** Use **off-site backup folder** to a folder that syncs (OneDrive, Dropbox, Google Drive). No extra server; you control the account.
   - **Tier 3 – Your own cloud:** Use **AWS S3** and/or **Cloud backup URL** (your own API that writes to S3/Azure/etc.). Data stays in your AWS/tenant.
   - **Recovery:** Set a **recovery password** and keep it safe. Copy a backup file (e.g. `attendance-latest.db`) and `recovery.dat` to a new machine; open the app and enter the recovery password to unlock.

3. **Recommended minimum**
   - Backup folder set + recovery password set.
   - At least one of: off-site folder (sync folder) **or** AWS S3 **or** Cloud backup URL.

4. **Restore instructions**
   - Short “How to restore” in Help: replace the app’s DB file with the backup file (and ensure `recovery.dat` is present if using recovery password), then restart the app.

---

## 3. Implementation Order

1. **Wire Cloud backup URL** in `backup-now` (and optionally in quick/hourly backup) so existing UI works.
2. **Add AWS S3** to Settings (Backup section): UI + settings keys + `uploadBackupToS3` + call from `backup-now` (and optionally from quick/hourly).
3. **Document** the “never lose app or records” plan in the app (Backup section + Help) and, if you want, in a short user-facing doc (e.g. `docs/Backup-and-recovery.md`).

---

## 4. AWS Setup (for you / users)

To use an **existing** AWS account:

1. Create an S3 bucket (e.g. `my-custody-note-backups`), in a region you prefer (e.g. `eu-west-2`).
2. Create an IAM user “custody-note-backup” with programmatic access (Access Key ID + Secret Access Key).
3. Attach a policy that allows only that bucket (and optionally a prefix like `custody-note/`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::my-custody-note-backups",
        "arn:aws:s3:::my-custody-note-backups/custody-note/*"
      ]
    }
  ]
}
```

4. In the app: Settings > Backup > enable AWS S3, enter region, bucket name, Access Key ID, Secret Access Key. Backups will then go to S3 as well.

---

## 5. Files to Touch

- **main.js**: Wire `uploadBackupToCloud` in backup flow; add S3 upload helper and call it when AWS is configured; read new settings (e.g. `awsS3Enabled`, `awsS3Region`, `awsS3Bucket`, `awsS3AccessKeyId`, `awsS3SecretAccessKey`).
- **index.html**: In Backup card, add AWS S3 subsection (enable, region, bucket, access key, secret key).
- **app.js**: Persist new settings from the Backup form; optional: show “Cloud upload failed” / “S3 upload failed” toasts.
- **package.json**: Add `@aws-sdk/client-s3` (and possibly `@aws-sdk/credential-providers` if we ever use env/profile).
- **Help** (and optionally `docs/Backup-and-recovery.md`): Add “Never lose your data” and “How to restore” using the plan above.

---

## 6. Summary

- **Cloud backup URL** is implemented in code but not called; we wire it so it’s used on every backup when set.
- **AWS S3** is added as a first-class option in Admin/Backup so you can connect an existing AWS account (bucket + IAM keys) and never lose records.
- A clear **backup and recovery plan** is documented in the app and optionally in a doc, so both you and users know how to avoid losing the app or records.
