/**
 * DevTools helper: verify copy-and-paste email bridge (v1.6.21).
 * Requires Electron with remote debugging on port 9222 and the app window open.
 */
const http = require('http');
const WebSocket = require('ws');

let ws, msgId = 0;
const pending = {};

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id && pending[msg.id]) {
        pending[msg.id](msg);
        delete pending[msg.id];
      }
    });
  });
}

function send(method, params) {
  return new Promise(resolve => {
    const id = ++msgId;
    pending[id] = resolve;
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true })
    .then(r => r.result?.result?.value);
}

async function run() {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});

  console.log('=== Email bridge debug (v1.6.21) ===\n');

  const ce = await evaluate('typeof (window.CustodyEmailCompose && window.CustodyEmailCompose.mergeTemplatePlaceholders)');
  console.log('CustodyEmailCompose.mergeTemplatePlaceholders:', ce);

  const copyHelper = await evaluate('typeof window.custodyCopyEmailText');
  console.log('custodyCopyEmailText:', copyHelper);

  const openExt = await evaluate('typeof (window.api && window.api.openExternal)');
  console.log('window.api.openExternal (non-email links only):', openExt);

  ws.close();
}

run().catch(err => { console.error(err); process.exit(1); });
