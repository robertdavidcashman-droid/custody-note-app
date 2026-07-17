# Custody Note — Cloud Backup Guide

## Overview

Custody Note offers two backup tiers:

1. **Local Backup (included with all subscriptions)**
   - Automatic encrypted backup every 2 minutes
   - Hourly timestamped archives (48 kept)
   - Optional off-site folder (OneDrive, Dropbox, Google Drive)
   - Data stays on your computer only

2. **Cloud Backup (add-on subscription)**
   - Everything in Local, plus automatic encrypted upload to AWS (London data centre)
   - Incorruptible: backups are permanently protected — cannot be deleted or tampered with (Object Lock)
   - Per-subscriber isolation: only you can access your backups
   - Restore from cloud on any machine
   - SRA-compliant data handling

---

## Subscribing to Cloud Backup

### From the app

1. Open **Settings** in Custody Note
2. Scroll to the **Cloud Backup** section
3. Click **Subscribe to Cloud Backup**
4. You will be taken to the secure Stripe checkout page
5. Complete payment — your cloud backup activates automatically within minutes

### From the website

1. Go to [custodynote.com/pricing](https://custodynote.com/pricing)
2. Choose **Standard + Cloud Backup**
3. Complete the checkout
4. Enter your licence key in the Custody Note app (Settings > Licence)
5. Cloud backup activates automatically

---

## How It Works

### Encryption

Your database is encrypted **before** it leaves your computer using AES-256-GCM
encryption with a key unique to you. Even if someone gained access to the raw
backup files on AWS, they cannot read your data without your encryption key.

A second layer of encryption (AES-256 server-side) is applied by AWS automatically.

All transfers use HTTPS (TLS 1.2+).

### Backup Schedule

| Backup type     | Frequency      | Where                        |
|-----------------|----------------|------------------------------|
| Quick backup    | Every 2 minutes| Local folder + cloud (if subscribed) |
| Hourly archive  | Every hour     | Local folder + cloud (if subscribed) |
| Manual backup   | On demand      | Local folder + cloud (if subscribed) |

### Object Lock (Incorruptible)

Cloud backups are stored with AWS S3 Object Lock in **Compliance mode**.
This means:

- Once uploaded, a backup **cannot be deleted or modified by anyone** — permanently
- Not even the Custody Note developers or AWS account administrators can tamper with it
- This provides a permanent audit trail and protects against ransomware, accidental deletion,
  or malicious actors

### Data Isolation (SRA Compliance)

Each subscriber's backups are stored in a separate, isolated area:

- Your backups are stored under a unique prefix derived from your licence key
- The temporary credentials your app receives only allow access to your area
- You cannot see, access, or even know about any other subscriber's backups
- The Custody Note developers cannot decrypt your backups (client-side encryption)

This satisfies Solicitors Regulation Authority requirements for:
- Client confidentiality
- Data protection
- Separation of client data
- Secure storage of case records

### UK Data Residency

All cloud backups are stored in the **AWS eu-west-2 (London)** region.
Data never leaves the United Kingdom.

---

## Restoring from Cloud Backup

If your computer fails, is stolen, or you move to a new machine:

1. Install Custody Note on the new machine
2. Enter your licence key (Settings > Licence)
3. Go to **Settings > Cloud Backup**
4. Click **Restore from Cloud Backup**
5. Select the backup you want to restore from the list
6. Confirm — a safety copy of any existing local database is saved first
7. Enter your recovery password when prompted
8. Your database is restored

**Important:** You need your recovery password to decrypt cloud backups.
Set one in Settings > Security & Encryption and keep it somewhere safe.

---

## Frequently Asked Questions

### What if I stop paying for cloud backup?

Your existing backups remain on AWS and are permanently protected by Object Lock.
They cannot be deleted. You can resubscribe at any time to restore them.
New backups will not be uploaded until you resubscribe.

### Can the Custody Note team read my backups?

No. Your database is encrypted on your computer before upload using a key that
only exists on your machine. We never see or store your encryption key.

### What happens if my internet drops during a backup?

The backup fails silently and retries at the next scheduled backup (within 2 minutes).
Your local backup is not affected. The app works fully offline.

### How much storage does cloud backup use?

A typical Custody Note database is 1-10 MB. Cloud backups are extremely small.
The `attendance-latest.db` file is overwritten each time, and hourly archives
accumulate up to 48 files on AWS before older ones are superseded.

### Can I use my own AWS account instead?

Yes. The existing AWS S3 settings in Settings > Backup let you configure your own
bucket with your own credentials. This is an advanced option for users who prefer
full control. The managed cloud backup subscription handles everything automatically.

### Is this GDPR compliant?

Yes. Data is stored in the UK (London), encrypted at rest and in transit,
access-controlled per subscriber, and you can request deletion at any time.

---

## Troubleshooting

### "Could not obtain cloud credentials"

- Check your internet connection
- Verify your licence key is active (Settings > About)
- Your subscription may have expired — check your email for renewal notices

### "Cloud backup not included in your subscription"

- You are on the Standard plan (local backup only)
- Upgrade to Standard + Cloud Backup in Settings or at custodynote.com/pricing

### "Could not decrypt the backup"

- You need your recovery password to restore cloud backups
- If you haven't set one, go to Settings > Security & Encryption
- If you've forgotten it, the backup cannot be decrypted (this is by design for security)

### Cloud backup shows as "Local backup only" in the footer

- The app checks your entitlement on startup and every hour
- If you just subscribed, restart the app or wait up to an hour
- Check Settings > Cloud Backup for detailed status

---

## Security Summary

| Layer              | Technology                                      |
|--------------------|-------------------------------------------------|
| Client encryption  | AES-256-GCM (your unique key)                   |
| Server encryption  | AES-256 (AWS SSE-S3)                             |
| In transit         | HTTPS / TLS 1.2+                                 |
| Immutability       | S3 Object Lock, Compliance mode, permanent retention|
| Access control     | STS temporary credentials, scoped IAM policies   |
| Data residency     | AWS eu-west-2 (London, United Kingdom)           |
| Key protection     | Windows Credential Store (safeStorage) or fallback|
