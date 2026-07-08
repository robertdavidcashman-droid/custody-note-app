'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

describe('attendance picker overlay (app.js)', () => {
  it('defines openAttendancePickerModal with fixed body overlay', () => {
    assert.ok(appJs.includes('function openAttendancePickerModal'), 'shared picker helper expected');
    assert.ok(appJs.includes("overlay.className = 'attendance-picker-overlay'"), 'fixed overlay class expected');
    assert.ok(appJs.includes('document.body.appendChild(overlay)'), 'overlay must mount on body');
  });

  it('showLaaFormPicker uses openAttendancePickerModal', () => {
    assert.ok(/function showLaaFormPicker[\s\S]*openAttendancePickerModal\(/.test(appJs),
      'home LAA cards must use shared picker');
  });

  it('showLaaFormPicker offers blank form and create attendance when empty', () => {
    assert.ok(appJs.includes("blankLabel: 'Generate blank form'"), 'blank form option expected');
    assert.ok(appJs.includes('startNewAttendanceFromHome'), 'create attendance shortcut expected');
  });

  it('showLaaFormsPopup uses fixed overlay on body', () => {
    const start = appJs.indexOf('function showLaaFormsPopup');
    const end = appJs.indexOf('function showLaaFormPicker', start);
    const chunk = appJs.substring(start, end > start ? end : start + 2500);
    assert.ok(chunk.includes('attendance-picker-overlay'), 'record header LAA popup must be fixed overlay');
    assert.ok(chunk.includes('document.body.appendChild(popup)'), 'record header popup on body');
  });
});
