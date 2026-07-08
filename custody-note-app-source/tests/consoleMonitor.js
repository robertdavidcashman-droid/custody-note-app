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
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        if (args.includes('[QE-DEBUG]')) {
          const ts = new Date().toISOString().slice(11, 23);
          console.log(ts + ' ' + args);
        }
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

async function run() {
  console.log('Connecting to Electron app...');
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('No page found'); process.exit(1); }
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable', {});
  console.log('Connected! Monitoring [QE-DEBUG] console output...');
  console.log('Go ahead and use the Quick Email modal in the app.\n');
  console.log('--- waiting for events ---');
}

run().catch(err => { console.error(err); process.exit(1); });
