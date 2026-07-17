# Deployment Guide — Custody Note Cloud Backup System

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────────────┐
│  Custody Note App   │────▶│  custodynote.com (Next.js)   │
│  (Electron desktop) │     │  Hosted on Vercel             │
│                     │     │                              │
│  - Local backup     │     │  API Routes:                 │
│  - Managed S3 upload│     │  /api/licence/validate       │
│  - Restore from S3  │     │  /api/backup/credentials     │
│                     │     │  /api/backup/list            │
└─────────────────────┘     │  /api/checkout               │
                            │  /api/webhooks/stripe        │
                            │  /api/trial                  │
                            │  /api/trial/validate         │
                            └──────────┬───────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
            ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
            │ Vercel KV  │      │  AWS STS    │     │   Stripe    │
            │ (licences) │      │ (temp creds)│     │ (payments)  │
            └────────────┘      └──────┬──────┘     └─────────────┘
                                       │
                                ┌──────▼──────┐
                                │  AWS S3     │
                                │ Object Lock │
                                │ eu-west-2   │
                                └─────────────┘
```

## Step 1: AWS Infrastructure

See `setup-aws.md` for detailed instructions.

```bash
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name custody-note-backup \
  --region eu-west-2 \
  --capabilities CAPABILITY_NAMED_IAM
```

Save the outputs (access keys, role ARN, bucket name).

## Step 2: Stripe Setup

### Create Products and Prices

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Products** > **Add product**
3. Create:
   - **Custody Note Subscription** — recurring monthly/yearly price
   - **Cloud Backup Add-on** — recurring monthly/yearly price (added to subscription)
4. Copy the Price IDs (start with `price_`)

### Configure Webhook

1. Go to **Developers** > **Webhooks** > **Add endpoint**
2. URL: `https://custodynote.com/api/webhooks/stripe`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy the webhook signing secret (`whsec_...`)

## Step 3: Vercel Deployment

### Environment Variables

Set these in the Vercel dashboard (Settings > Environment Variables):

| Variable | Source | Example |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard > API Keys | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard > Webhooks | `whsec_...` |
| `STRIPE_PRICE_ID_SUBSCRIPTION` | Stripe Products | `price_...` |
| `STRIPE_PRICE_ID_CLOUD_BACKUP` | Stripe Products | `price_...` |
| `AWS_REGION` | CloudFormation | `eu-west-2` |
| `AWS_ACCESS_KEY_ID` | CloudFormation output | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | CloudFormation output | (secret) |
| `AWS_BACKUP_ROLE_ARN` | CloudFormation output | `arn:aws:iam::...` |
| `AWS_BACKUP_BUCKET` | CloudFormation | `custody-note-backups` |
| `AWS_STS_EXTERNAL_ID` | CloudFormation | `custody-note-backup` |
| `NEXT_PUBLIC_SITE_URL` | Your domain | `https://custodynote.com` |

Vercel KV variables (`KV_URL`, etc.) are auto-populated when you link a KV store.

### Deploy

```bash
cd "custody note - website production"
vercel --prod
```

Or connect the GitHub repo to Vercel for automatic deployments.

## Step 4: Configure the Electron App

The app needs to know where the API lives. Create or update `licence-config.json`
in the app's `userData` directory:

```json
{
  "validationUrl": "https://custodynote.com/api/licence/validate",
  "apiUrl": "https://custodynote.com"
}
```

For the trial/distribution package, include this file in the `userData` folder
created by `prepare-trial.js`.

## Step 5: Testing

### Test the full flow

1. Start a trial from custodynote.com/trial
2. Enter the trial key in the app — verify licence validation works
3. Subscribe via [custodynote.com/pricing](https://custodynote.com/pricing)
4. Enter the paid licence key — verify cloud backup activates
5. Make a change in the app — verify backup uploads to S3 within 2 minutes
6. Check S3 bucket — verify files exist under `backups/{hash}/`
7. Restore from cloud on a fresh install — verify data is recovered

### Test Stripe webhooks locally

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Maintenance

### Monitoring

- **Vercel**: Function logs in the Vercel dashboard
- **AWS S3**: Enable CloudTrail and S3 access logging for audit
- **Stripe**: Webhook delivery logs in Stripe Dashboard

### Costs

| Service | Estimated monthly cost (100 subscribers) |
|---|---|
| Vercel (Pro) | $20 |
| Vercel KV | $0 (free tier covers licence storage) |
| AWS S3 | $5-15 |
| AWS STS | <$1 |
| Stripe | 2.9% + 30p per transaction |

### Revoking a licence

```bash
# Using Vercel KV CLI or dashboard
# Set status to 'revoked' on the licence key
```

### Checking a subscriber's backups

```bash
aws s3 ls s3://custody-note-backups/backups/<subscriber-hash>/ --region eu-west-2
```
