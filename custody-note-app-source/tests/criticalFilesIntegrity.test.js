/**
 * Critical-files integrity test.
 *
 * Guards against silent corruption of the main-process JS files that ship
 * inside `app.asar`. A single broken file (parse error, truncation, or
 * accidental concatenation) here means the installed app fails to launch
 * with `SyntaxError` from electron's main process — and the user is left
 * with a permanently broken install that the in-app updater can no longer
 * recover from (because main process won't start).
 *
 * Specifically: in v1.5.0 the shipped `updater.js` was found to start with
 * a fragment of a Mocha-style `it(...)` block from `tests/workflowUtils.test.js`
 * concatenated in front of the real updater code, producing
 *   `SyntaxError: Unexpected identifier 'Optimiz'` at line 1.
 *
 * This test runs on every `npm run test:unit` (and therefore on CI / before
 * every release build via `verify:release` chain) and asserts:
 *
 *   1. The file parses as valid JavaScript (via `node --check` — same gate
 *      Electron will run at require() time, but executed at test time).
 *   2. The file begins with its expected first line (cheap "is this even
 *      the right file?" tripwire that catches accidental overwrites).
 *   3. The file contains a stable structural marker (an export, function
 *      declaration, or `contextBridge` call) — catches the case where a
 *      file is truncated to a parseable but useless stub.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/**
 * @type {Array<{
 *   file: string,
 *   firstLineStartsWith: string,
 *   mustContain: string[],
 * }>}
 */
const CRITICAL_FILES = [
  {
    file: 'main.js',
    firstLineStartsWith: "const { app, BrowserWindow",
    mustContain: [
      "require('electron')",
      "require('./updater')",
      'app.requestSingleInstanceLock',
    ],
  },
  {
    file: 'preload.js',
    firstLineStartsWith: "const { contextBridge",
    mustContain: [
      "contextBridge.exposeInMainWorld('api'",
      "contextBridge.exposeInMainWorld('custodyNoteBuildInfo'",
      "contextBridge.exposeInMainWorld('CustodyEmailCompose'",
    ],
  },
  {
    file: 'updater.js',
    firstLineStartsWith: "const path = require('path')",
    mustContain: [
      "require('electron-log')",
      "require('./updateState')",
      'module.exports = {',
      'initUpdater',
      'createNoopUpdaterController',
    ],
  },
  {
    file: 'updateState.js',
    firstLineStartsWith: "const fs = require('fs')",
    mustContain: ['module.exports'],
  },
];

function readFirstLine(absPath) {
  const buf = fs.readFileSync(absPath, 'utf8');
  const nl = buf.indexOf('\n');
  return (nl === -1 ? buf : buf.slice(0, nl)).replace(/\r$/, '');
}

function nodeCheck(absPath) {
  const r = spawnSync(process.execPath, ['--check', absPath], {
    encoding: 'utf8',
  });
  return {
    ok: r.status === 0,
    stderr: (r.stderr || '').trim(),
    stdout: (r.stdout || '').trim(),
  };
}

describe('Critical main-process files are intact', () => {
  for (const spec of CRITICAL_FILES) {
    const absPath = path.join(ROOT, spec.file);

    describe(spec.file, () => {
      it('exists and is non-empty', () => {
        assert.ok(fs.existsSync(absPath), `${spec.file} not found at ${absPath}`);
        const stat = fs.statSync(absPath);
        assert.ok(stat.size > 0, `${spec.file} is empty`);
        assert.ok(
          stat.size > 200,
          `${spec.file} is suspiciously small (${stat.size} bytes) — possible truncation`
        );
      });

      it('parses as valid JavaScript (node --check)', () => {
        const result = nodeCheck(absPath);
        assert.strictEqual(
          result.ok,
          true,
          `${spec.file} failed to parse:\n${result.stderr}`
        );
      });

      if (spec.firstLineStartsWith) {
        it(`first line starts with "${spec.firstLineStartsWith}"`, () => {
          const firstLine = readFirstLine(absPath);
          assert.ok(
            firstLine.startsWith(spec.firstLineStartsWith),
            `${spec.file} first line is "${firstLine.slice(0, 80)}" — expected to start with "${spec.firstLineStartsWith}".\n` +
              'This usually means the file was overwritten with the contents of another file ' +
              '(e.g. a test fixture leaked in during an automated edit).'
          );
        });
      }

      for (const marker of spec.mustContain) {
        it(`contains expected marker: ${marker}`, () => {
          const src = fs.readFileSync(absPath, 'utf8');
          assert.ok(
            src.includes(marker),
            `${spec.file} is missing structural marker "${marker}". ` +
              'File may be truncated or replaced.'
          );
        });
      }
    });
  }
});
