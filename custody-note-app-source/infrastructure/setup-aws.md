# AWS Infrastructure Setup Guide

## Overview

This guide sets up the incorruptible cloud backup system for Custody Note subscribers.
It creates an S3 bucket with Object Lock (Compliance mode) in `eu-west-2` (London)
for UK data residency, an IAM role for STS-based per-subscriber credential scoping,
and an API user whose credentials are used by the website backend.

## Prerequisites

- An AWS account
- AWS CLI installed and configured (`aws configure`)
- Permissions to create S3 buckets, IAM roles, and IAM users

## Step 1: Deploy the CloudFormation Stack

```bash
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name custody-note-backup \
  --region eu-west-2 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    BucketName=custody-note-backups \
    RetentionDays=36500 \
    TransitionToIADays=30 \
    GlacierDays=90
```

## Step 2: Retrieve Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name custody-note-backup \
  --region eu-west-2 \
  --query 'Stacks[0].Outputs'
```

This returns:
- `BucketName` -- the S3 bucket name
- `RoleArn` -- the IAM role ARN for STS AssumeRole
- `ApiUserAccessKeyId` -- access key for the website backend
- `ApiUserSecretAccessKey` -- secret key (store securely, never commit)

## Step 3: Configure the Website Backend

Add these to your Vercel environment variables (or `.env.local`):

| Variable | Value |
|---|---|
| `AWS_REGION` | `eu-west-2` |
| `AWS_ACCESS_KEY_ID` | From CloudFormation output `ApiUserAccessKeyId` |
| `AWS_SECRET_ACCESS_KEY` | From CloudFormation output `ApiUserSecretAccessKey` |
| `AWS_BACKUP_ROLE_ARN` | From CloudFormation output `RoleArn` |
| `AWS_BACKUP_BUCKET` | `custody-note-backups` |
| `AWS_STS_EXTERNAL_ID` | `custody-note-backup` |

## How It Works

### Object Lock (Compliance Mode)

Once a backup is uploaded, it **cannot be deleted or overwritten** by anyone --
not even the AWS account root user -- for the configured retention period (default: 100 years).
This makes backups permanently incorruptible and tamper-proof.

### Per-Subscriber Isolation

When the app requests backup credentials, the website backend:
1. Validates the subscriber's licence key and cloud backup entitlement
2. Computes a SHA-256 hash of the licence key to create a unique S3 prefix
3. Calls AWS STS `AssumeRole` with an inline policy scoped to only that prefix
4. Returns temporary credentials (15-minute TTL) to the app

The scoped policy (see `scoped-policy-template.json`) ensures each subscriber
can only read/write within their own prefix -- `backups/{licence-hash}/`.

### Encryption Layers

1. **Client-side**: AES-256-GCM encryption before upload (subscriber's own key)
2. **Server-side**: SSE-S3 (AES-256) applied by S3 automatically
3. **In transit**: HTTPS/TLS 1.2+ enforced by bucket policy

### Cost Estimate

With 100 subscribers each uploading ~5 MB every 2 minutes (quick backup) plus
hourly archives, monthly costs are approximately:
- S3 storage: ~$5-15/month (with IA transition after 30 days)
- STS calls: negligible (pennies)
- Data transfer: ~$2-5/month

## Verifying the Setup

```bash
# Test that Object Lock is enabled
aws s3api get-object-lock-configuration \
  --bucket custody-note-backups \
  --region eu-west-2

# Test STS AssumeRole
aws sts assume-role \
  --role-arn arn:aws:iam::ACCOUNT_ID:role/CustodyNoteBackupRole \
  --role-session-name test \
  --external-id custody-note-backup \
  --region eu-west-2
```
