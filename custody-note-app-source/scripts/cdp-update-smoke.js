const http = require('http');
const WebSocket = require('ws');

let ws;
let nextId = 1;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const pages = JSON.parse(data);
        const page = pages.find((p) => p.title === 'Custody Note');
        if (!page) return reject(new Error('No Custody Note page found on port 9222'));
        ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.on('open', resolve);
        ws.on('message', (msg) => {
          const payload = JSON.parse(msg.toString());
          if (payload.id && pending.has(payload.id)) {
            pending.get(payload.id)(payload);
            pending.delete(payload.id);
          }
        });
        ws.on('error', reject);
      });
    }).on('error', reject);
  });
}

function evaluate(expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (payload) => {
      if (payload.result && payload.result.exceptionDetails) {
        reject(new Error(payload.result.exceptionDetails.text || 'Runtime exception'));
      } else {
        resolve(payload.result && payload.result.result ? payload.result.result.value : undefined);
      }
    });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression,
        returnByValue: true,
        awaitPromise,
      },
    }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Evaluation timed out'));
      }
    }, 20000);
  });
}

async function main() {
  await connect();
  const version = await evaluate(`(async () => (await window.api.getAppVersion()).version)()`, true);
  const status = await evaluate(`(async () => JSON.stringify(await window.api.getAutoUpdateState()))()`, true);
  console.log('Current version:', version);
  console.log('Current updater state:', status);

  const result = await evaluate(`(async () => JSON.stringify(await window.api.appCheckUpdates()))()`, true);
  console.log('Manual check result:', result);

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const readyState = await evaluate(`(async () => JSON.stringify(await window.api.getAutoUpdateState()))()`, true);
  console.log('State after check:', readyState);

  console.log('Invoking install...');
  await evaluate(`(async () => JSON.stringify(await window.api.appUpdateInstall()))()`, true);
  console.log('Install command sent.');

  ws.close();
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
