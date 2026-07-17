/**
 * Firm selection: Change button clears fields, no auto-fill on new records.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Firm selection — new record starts blank', () => {
  it('prefillDefaults does NOT auto-populate firmId from a default firm', () => {
    const fnIdx = appJs.indexOf('function prefillDefaults()');
    assert.ok(fnIdx > -1, 'prefillDefaults must exist');
    const fnSlice = appJs.slice(fnIdx, fnIdx + 3000);

    assert.ok(
      !fnSlice.includes("firms.find(function(f) { return f.is_default; })"),
      'prefillDefaults must not look up a default firm'
    );
    assert.ok(
      !fnSlice.includes("setFieldValueSilent('firmContactName'"),
      'prefillDefaults must not set firmContactName'
    );
    assert.ok(
      !fnSlice.includes("setFieldValueSilent('firmContactEmail'"),
      'prefillDefaults must not set firmContactEmail'
    );
    assert.ok(
      !fnSlice.includes("setFieldValueSilent('firmContactPhone'"),
      'prefillDefaults must not set firmContactPhone'
    );
  });

  it('travelOriginPostcode is NOT hardcoded — pulled from settings', () => {
    const fnIdx = appJs.indexOf('function prefillDefaults()');
    const fnEnd = appJs.indexOf('\n  function ', fnIdx + 1);
    const fnSlice = appJs.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 5000);

    assert.ok(
      !fnSlice.includes("formData.travelOriginPostcode = 'TN156ER'"),
      'must not hardcode TN156ER'
    );
    assert.ok(
      fnSlice.includes('s.officePostcode'),
      'must pull travelOriginPostcode from settings.officePostcode'
    );
  });
});

describe('Office postcode setting', () => {
  it('Settings page has an officePostcode input', () => {
    assert.ok(indexHtml.includes('id="setting-office-postcode"'), 'settings must have office postcode input');
  });

  it('Settings save collects officePostcode', () => {
    assert.ok(appJs.includes("officePostcode: document.getElementById('setting-office-postcode')"), 'saveSettings must collect officePostcode');
  });

  it('Settings load populates officePostcode', () => {
    assert.ok(appJs.includes("setting-office-postcode"), 'loadSettings must populate office postcode field');
    assert.ok(appJs.includes("s.officePostcode"), 'loadSettings must read officePostcode from settings');
  });

  it('First-launch modal includes office postcode field', () => {
    assert.ok(indexHtml.includes('id="fl-office-postcode"'), 'first-launch must have office postcode input');
  });
});

describe('Firm selection — Change button clears all firm fields (main form)', () => {
  it('form-firm-change handler clears firmId, firmName, and all contact fields', () => {
    const changeIdx = appJs.indexOf("hiddenFirmInput.value = '';\n            formData.firmId = ''");
    assert.ok(changeIdx > -1, 'main form change handler must exist (hiddenFirmInput clear)');
    const handlerSlice = appJs.slice(changeIdx, changeIdx + 800);

    assert.ok(handlerSlice.includes("formData.firmId = ''"), 'must clear formData.firmId');
    assert.ok(handlerSlice.includes("formData.firmName = ''"), 'must clear formData.firmName');
    assert.ok(handlerSlice.includes("formData.firmLaaAccount = ''"), 'must clear formData.firmLaaAccount');
    assert.ok(handlerSlice.includes("formData.firmContactName = ''"), 'must clear formData.firmContactName');
    assert.ok(handlerSlice.includes("formData.firmContactPhone = ''"), 'must clear formData.firmContactPhone');
    assert.ok(handlerSlice.includes("formData.firmContactEmail = ''"), 'must clear formData.firmContactEmail');

    assert.ok(handlerSlice.includes("setFieldValue('firmLaaAccount', '')"), 'must clear firmLaaAccount DOM');
    assert.ok(handlerSlice.includes("setFieldValue('firmContactName', '')"), 'must clear firmContactName DOM');
    assert.ok(handlerSlice.includes("setFieldValue('firmContactPhone', '')"), 'must clear firmContactPhone DOM');
    assert.ok(handlerSlice.includes("setFieldValue('firmContactEmail', '')"), 'must clear firmContactEmail DOM');
  });
});

describe('Firm selection — Change button clears fields (quick capture)', () => {
  it('QC change handler clears referral name, phone, and email fields', () => {
    const qcChangeIdx = appJs.indexOf("selectedLine.querySelector('.form-firm-change').addEventListener('click', function() {\n          hiddenInput.value = '';");
    assert.ok(qcChangeIdx > -1, 'QC form-firm-change handler must exist');
    const handlerSlice = appJs.slice(qcChangeIdx, qcChangeIdx + 600);

    assert.ok(handlerSlice.includes("getElementById('qc-referral-name')"), 'must access qc-referral-name');
    assert.ok(handlerSlice.includes("getElementById('qc-referral-phone')"), 'must access qc-referral-phone');
    assert.ok(handlerSlice.includes("getElementById('qc-referral-email')"), 'must access qc-referral-email');
    assert.ok(handlerSlice.includes("nameEl.value = ''"), 'must clear referral name');
    assert.ok(handlerSlice.includes("phoneEl.value = ''"), 'must clear referral phone');
    assert.ok(handlerSlice.includes("emailEl.value = ''"), 'must clear referral email');
  });

  it('QC firm init does NOT auto-select a default/remembered firm', () => {
    const qcInitIdx = appJs.indexOf('function qcInitFirmSelector()');
    assert.ok(qcInitIdx > -1, 'qcInitFirmSelector must exist');
    const fnSlice = appJs.slice(qcInitIdx, qcInitIdx + 5000);

    assert.ok(
      !fnSlice.includes("getRememberedQuickCaptureFirmId()"),
      'qcInitFirmSelector must not auto-recall a remembered firm'
    );
    assert.ok(
      !fnSlice.includes("fi.is_default"),
      'qcInitFirmSelector must not look up a default firm'
    );
  });
});

describe('Firm selection — selecting a firm populates contact fields', () => {
  it('main form firm click sets firmContactName, phone, email, and LAA account', () => {
    const formFirmClickIdx = appJs.indexOf("item.addEventListener('click', function() {\n              hiddenFirmInput.value = String(fi.id);");
    assert.ok(formFirmClickIdx > -1, 'main form firm item click handler must exist');
    const clickSlice = appJs.slice(formFirmClickIdx, formFirmClickIdx + 600);

    assert.ok(clickSlice.includes("setFieldValue('firmLaaAccount'"), 'must set firmLaaAccount on selection');
    assert.ok(clickSlice.includes("setFieldValue('firmContactName'"), 'must set firmContactName on selection');
    assert.ok(clickSlice.includes("setFieldValue('firmContactPhone'"), 'must set firmContactPhone on selection');
    assert.ok(clickSlice.includes("setFieldValue('firmContactEmail'"), 'must set firmContactEmail on selection');
  });

  it('QC firm click calls qcSetReferralFromFirm to populate fields', () => {
    const qcClickIdx = appJs.indexOf("item.addEventListener('click', function() {\n            hiddenInput.value = String(fi.id);");
    assert.ok(qcClickIdx > -1, 'QC firm item click handler must exist');
    const clickSlice = appJs.slice(qcClickIdx, qcClickIdx + 400);

    assert.ok(clickSlice.includes('qcSetReferralFromFirm(fi'), 'must call qcSetReferralFromFirm on selection');
  });
});
