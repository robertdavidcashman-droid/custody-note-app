/**
 * Runtime regression for CRM1 official PDF prefill (lib/laaCrm1Fill.js).
 *
 * Unlike crm1PdfFill.test.js (which statically greps the source), this loads the
 * REAL crm1-v16-feb-2025.pdf template, runs fillCRM1, then reads the AcroForm
 * fields back to assert the correct boxes are ticked. This is what catches the
 * "wrong box ticked" class of bug (gender, marital, benefits) directly.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const laaCrm1Fill = require('../lib/laaCrm1Fill');

const TEMPLATE = path.join(__dirname, '..', 'data', 'laa-official-forms', 'crm1-v16-feb-2025.pdf');

async function fillWith(data) {
  const bytes = fs.readFileSync(TEMPLATE);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const misses = [];
  laaCrm1Fill.fillCRM1(form, data, { accumulator: misses });
  return { form, misses };
}

function checked(form, name) {
  return form.getCheckBox(name).isChecked();
}
function textOf(form, name) {
  try { return form.getTextField(name).getText() || ''; } catch (_) { return ''; }
}

describe('CRM1 runtime fill — template field mapping', () => {
  before(() => {
    assert.ok(fs.existsSync(TEMPLATE), 'CRM1 template must exist at ' + TEMPLATE);
  });

  it('does not report any field misses for a fully populated record', async () => {
    const { misses } = await fillWith({
      surname: 'Smith', forename: 'John', dob: '1990-04-05',
      gender: 'male', maritalStatus: 'Single',
      address1: '1 High St', city: 'Leeds', county: 'West Yorks', postCode: 'LS1 1AA',
      niNumber: 'AB123456C', ufn: '010125/001',
      passportedBenefit: 'No', grossIncome: '12000',
      capitalClient: '500', capitalPartner: '0', capitalTotal: '500',
      ethnicOriginCode: '01', disabilityCode: 'NCD',
    });
    assert.deepStrictEqual(misses, [], 'unexpected field misses: ' + JSON.stringify(misses));
  });

  it('ticks Male on CheckBox11 only (CheckBox12/14 clear)', async () => {
    const { form } = await fillWith({ gender: 'male' });
    assert.strictEqual(checked(form, 'CheckBox11'), true, 'Male = CheckBox11');
    assert.strictEqual(checked(form, 'CheckBox12'), false, 'Female box must be clear');
    assert.strictEqual(checked(form, 'CheckBox14'), false, 'Prefer-not-to-say box must be clear');
  });

  it('ticks Female on CheckBox12 only', async () => {
    const { form } = await fillWith({ gender: 'Female' });
    assert.strictEqual(checked(form, 'CheckBox12'), true, 'Female = CheckBox12');
    assert.strictEqual(checked(form, 'CheckBox11'), false);
    assert.strictEqual(checked(form, 'CheckBox14'), false);
  });

  it('ticks Prefer not to say on CheckBox14 only', async () => {
    const { form } = await fillWith({ gender: 'Prefer not to say' });
    assert.strictEqual(checked(form, 'CheckBox14'), true);
    assert.strictEqual(checked(form, 'CheckBox11'), false);
    assert.strictEqual(checked(form, 'CheckBox12'), false);
  });

  it('leaves all gender boxes clear when gender unknown', async () => {
    const { form } = await fillWith({});
    assert.strictEqual(checked(form, 'CheckBox11'), false);
    assert.strictEqual(checked(form, 'CheckBox12'), false);
    assert.strictEqual(checked(form, 'CheckBox14'), false);
  });

  it('maps marital Cohabiting to CheckBox1 and Widowed to CheckBox89 (no overlap with gender)', async () => {
    const cohab = await fillWith({ maritalStatus: 'Cohabiting' });
    assert.strictEqual(checked(cohab.form, 'CheckBox1'), true, 'Cohabiting = CheckBox1');
    assert.strictEqual(checked(cohab.form, 'CheckBox89'), false);

    const wid = await fillWith({ maritalStatus: 'Widowed' });
    assert.strictEqual(checked(wid.form, 'CheckBox89'), true, 'Widowed = CheckBox89');
    assert.strictEqual(checked(wid.form, 'CheckBox1'), false);
  });

  it('maps the standard marital options to their verified boxes', async () => {
    const single = await fillWith({ maritalStatus: 'Single' });
    assert.strictEqual(checked(single.form, 'CheckBox87'), true, 'Single = CheckBox87');

    const married = await fillWith({ maritalStatus: 'Married/Civil Partner' });
    assert.strictEqual(checked(married.form, 'Married'), true, 'Married = Married');

    const sep = await fillWith({ maritalStatus: 'Separated' });
    assert.strictEqual(checked(sep.form, 'Separated'), true, 'Separated = Separated');

    const div = await fillWith({ maritalStatus: 'Divorced/dissolved CP' });
    assert.strictEqual(checked(div.form, 'Divorced'), true, 'Divorced = Divorced');
  });

  it('Universal Credit ticks Q2 Yes (CheckBox10) and leaves Q3 untouched', async () => {
    const { form } = await fillWith({ passportedBenefit: 'Yes', benefits: 'Yes', benefitType: 'Universal Credit' });
    assert.strictEqual(checked(form, 'CheckBox10'), true, 'Q2 Yes = CheckBox10');
    assert.strictEqual(checked(form, 'CheckBox9'), false, 'Q2 No must be clear');
    assert.strictEqual(checked(form, 'CheckBox13'), false, 'Q3 ignored when passported by UC/PC');
    assert.strictEqual(checked(form, 'CheckBox6'), false);
    assert.strictEqual(textOf(form, 'The_client1'), '', 'no weekly income when passported');
  });

  it('other passporting benefit ticks Q2 No and Q3 Yes (CheckBox13)', async () => {
    const { form } = await fillWith({ passportedBenefit: 'Yes', benefits: 'Yes' });
    assert.strictEqual(checked(form, 'CheckBox10'), false, 'not UC/PC -> Q2 No');
    assert.strictEqual(checked(form, 'CheckBox9'), true, 'Q2 No = CheckBox9');
    assert.strictEqual(checked(form, 'CheckBox13'), true, 'Q3 Yes = CheckBox13');
    assert.strictEqual(checked(form, 'CheckBox6'), false);
  });

  it('not on benefits ticks Q2 No + Q3 No and fills weekly income', async () => {
    const { form } = await fillWith({ passportedBenefit: 'No', benefits: 'No', grossIncome: '5200', partnerIncome: '2600' });
    assert.strictEqual(checked(form, 'CheckBox9'), true, 'Q2 No');
    assert.strictEqual(checked(form, 'CheckBox6'), true, 'Q3 No');
    assert.strictEqual(checked(form, 'CheckBox10'), false);
    assert.strictEqual(checked(form, 'CheckBox13'), false);
    assert.strictEqual(textOf(form, 'The_client1'), '100', '5200/52 = 100 weekly');
    assert.strictEqual(textOf(form, 'Partner_if_living_with_t_'), '50', '2600/52 = 50 weekly');
    assert.strictEqual(textOf(form, 'Total1'), '150');
  });

  it('maps under-18 to the correct page-7 boxes', async () => {
    const youth = await fillWith({ juvenileVulnerable: 'Juvenile' });
    assert.strictEqual(checked(youth.form, 'Client under 18 checkbox'), true);
    assert.strictEqual(checked(youth.form, 'Client not under 18 checkbox'), false);

    const adult = await fillWith({ juvenileVulnerable: 'Adult' });
    assert.strictEqual(checked(adult.form, 'Client under 18 checkbox'), false);
    assert.strictEqual(checked(adult.form, 'Client not under 18 checkbox'), true);
  });

  it('writes identity text fields (surname, DOB split, postcode)', async () => {
    const { form } = await fillWith({ surname: 'Doe', forename: 'Jane', dob: '1985-12-31', postCode: 'M1 2AB' });
    assert.strictEqual(textOf(form, 'Surname'), 'Doe');
    assert.strictEqual(textOf(form, 'Date_of_birth'), '31');
    assert.strictEqual(textOf(form, 'Date_of_birth1'), '12');
    assert.strictEqual(textOf(form, 'Date_of_birth2'), '1985');
    assert.strictEqual(textOf(form, 'Postcode'), 'M1 2AB');
  });

  it('maps ethnicity and disability codes to their page-6 boxes', async () => {
    const { form } = await fillWith({ ethnicOriginCode: '01', disabilityCode: 'VIS' });
    assert.strictEqual(checked(form, 'CheckBox137'), true, 'ethnicity 01 -> CheckBox137');
    assert.strictEqual(checked(form, 'CheckBox32'), true, 'disability VIS -> CheckBox32');
  });
});
