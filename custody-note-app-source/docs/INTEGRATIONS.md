# Third-party integrations

## Postcode address lookup

Postcode lookups are proxied through the CustodyNote server (`POST /api/postcodes/lookup`). The Ideal Postcodes API key is stored server-side only — no client configuration is needed. Any machine with a valid CustodyNote licence can use postcode lookup automatically.

## QuickFile invoicing

QuickFile credentials (account number, API key, application ID) are encrypted on the Custody Note server (`POST /api/settings/quickfile`) using your licence key. Enter them once in **Settings → Integrations → QuickFile** on any computer; they sync to your account and are pulled automatically on startup, when you open Settings, and before billing.

## Custody Note licence & cloud

Subscription validation, cloud backup, sync, and account sign-in use **custodynote.com** APIs and your **custodynote.com** account / licence key.
