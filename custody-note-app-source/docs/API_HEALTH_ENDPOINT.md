# GET /api/health — Implementation Guide

The Custody Note desktop app optionally checks `GET /api/health` to determine connectivity before sync. Add this endpoint to the custodynote.com API for better sync reliability.

## Response

- **200** or **204** → API available, sync proceeds
- **401** → Auth required (no licence key)
- **404** → Treated as "api_available" (client proceeds with sync; endpoint not implemented)

## Example implementations

### Next.js App Router
```js
// app/api/health/route.js
export async function GET() {
  return new Response(null, { status: 204 });
}
```

### Next.js Pages Router
```js
// pages/api/health.js
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.status(204).end();
}
```

### Vercel serverless
```js
// api/health.js
export default function handler(req, res) {
  res.status(204).end();
}
```

## Notes

- No auth required; this is a public reachability check
- 8-second client timeout
- If the endpoint does not exist (404), the app assumes API is reachable and proceeds with sync
