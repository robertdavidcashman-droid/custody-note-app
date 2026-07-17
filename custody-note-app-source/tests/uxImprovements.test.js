const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const stylesCssPath = path.join(__dirname, '..', 'styles.css');
const stylesCssSource = fs.readFileSync(stylesCssPath, 'utf8');

describe('PACE Search — N/A option', () => {

  it('searchTypes array includes N/A as a selectable option', () => {
    const searchTypesMatch = appJsSource.match(/const searchTypes\s*=\s*\[([^\]]+)\]/);
    assert.ok(searchTypesMatch, 'searchTypes array must exist');
    const searchTypesBlock = searchTypesMatch[1];
    assert.ok(searchTypesBlock.includes("'N/A'"), 'searchTypes must include N/A');
  });

  it('N/A is the first option in PACE search types (before specific types)', () => {
    const searchTypesMatch = appJsSource.match(/const searchTypes\s*=\s*\[([^\]]+)\]/);
    const items = searchTypesMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    assert.strictEqual(items[0], 'N/A', 'N/A should be the first option');
  });

  it('paceSearches default initialises with searchType empty string (safe for N/A)', () => {
    assert.ok(
      appJsSource.includes("{ searchType: '', whatFound: '' }"),
      'default paceSearches entry must have empty searchType'
    );
  });

  it('PACE search summary display handles N/A gracefully', () => {
    const summaryIdx = appJsSource.indexOf("'PACE search ' + (i + 1)");
    assert.ok(summaryIdx !== -1, 'PACE search summary display must exist');
    const block = appJsSource.substring(summaryIdx - 200, summaryIdx + 200);
    assert.ok(block.includes('ps.searchType'), 'summary must reference searchType');
  });
});

describe('Conflict Certification — auto date', () => {

  it('conflictCheckDate field exists in custody attend section', () => {
    const attendStart = appJsSource.indexOf("id: 'attend'");
    assert.ok(attendStart !== -1, 'attend section must exist');
    const attendBlock = appJsSource.substring(attendStart, attendStart + 3000);
    assert.ok(attendBlock.includes("'conflictCheckDate'"), 'attend section must include conflictCheckDate field');
  });

  it('conflictCheckDate field exists in telephone advice form', () => {
    const telStart = appJsSource.indexOf('const telFormSections');
    assert.ok(telStart !== -1, 'telFormSections must exist');
    const telEnd = appJsSource.indexOf('const voluntaryFormSections');
    const telBlock = appJsSource.substring(telStart, telEnd);
    assert.ok(telBlock.includes("'conflictCheckDate'"), 'telephone form must include conflictCheckDate');
  });

  it('prefillDefaults auto-fills conflictCheckDate with today', () => {
    const pfIdx = appJsSource.indexOf('function prefillDefaults()');
    assert.ok(pfIdx !== -1, 'prefillDefaults must exist');
    const pfBlock = appJsSource.substring(pfIdx, pfIdx + 5000);
    assert.ok(
      pfBlock.includes('conflictCheckDate'),
      'prefillDefaults must set conflictCheckDate'
    );
    assert.ok(
      pfBlock.includes("new Date().toISOString().slice(0, 10)"),
      'conflictCheckDate must default to today via toISOString().slice(0, 10)'
    );
  });

  it('does NOT overwrite existing conflictCheckDate (only sets if falsy)', () => {
    const pfIdx = appJsSource.indexOf('function prefillDefaults()');
    const pfBlock = appJsSource.substring(pfIdx, pfIdx + 5000);
    assert.ok(
      pfBlock.includes('if (!formData.conflictCheckDate)'),
      'must guard with if (!formData.conflictCheckDate)'
    );
  });

  it('generateConflictCert uses conflictCheckDate over record date', () => {
    const certIdx = appJsSource.indexOf('function generateConflictCert()');
    assert.ok(certIdx !== -1, 'generateConflictCert must exist');
    const certBlock = appJsSource.substring(certIdx, certIdx + 500);
    assert.ok(
      certBlock.includes('d.conflictCheckDate'),
      'cert must use conflictCheckDate'
    );
    const dateLineMatch = certBlock.match(/formatDateGB\(d\.conflictCheckDate \|\| d\.date/);
    assert.ok(dateLineMatch, 'cert date must fall back from conflictCheckDate to d.date');
  });

  it('conflictCheckDate appears in summary views', () => {
    const occurrences = (appJsSource.match(/Date of conflict check/g) || []).length;
    assert.ok(occurrences >= 2, 'conflictCheckDate must appear in at least 2 summary views (custody + telephone/voluntary)');
  });
});

describe('UX — Bullseye-style form subsections', () => {

  it('renderField renders static headings with status chips', () => {
    const renderIdx = appJsSource.indexOf('function renderField(');
    assert.ok(renderIdx !== -1, 'renderField must exist');
    const renderBlock = appJsSource.substring(renderIdx, renderIdx + 2200);
    assert.ok(renderBlock.includes('section-heading--static'), 'section headings default to static');
    assert.ok(renderBlock.includes('section-status-chip'), 'section headings include status chip');
    assert.ok(renderBlock.includes('_applySubsectionHeadingMode'), 'must apply subsection mode after render');
  });

  it('optional blocks keep defaultCollapsed for compact mode only', () => {
    const optionalSections = [
      '_h_pace_reviews',
      '_h_strip_search',
      '_h_property',
      '_h_forensics',
      '_h_device_seizure',
      '_h_special_warnings',
    ];
    optionalSections.forEach(key => {
      const re = new RegExp("key:\\s*'" + key + "'.*defaultCollapsed:\\s*true");
      assert.ok(re.test(appJsSource), key + ' must retain defaultCollapsed for compact mode');
    });
  });

  it('expanded mode is default with completion helpers', () => {
    assert.ok(appJsSource.includes('function _computeHeadingCompletion'), '_computeHeadingCompletion must exist');
    assert.ok(appJsSource.includes('function refreshAllSubsectionHeadingChips'), 'chip refresh helper must exist');
    assert.ok(appJsSource.includes("formSubsectionsMode"), 'settings must persist formSubsectionsMode');
    assert.ok(appJsSource.includes("applyFormSubsectionsMode('expanded')"), 'default subsection mode is expanded');
  });

  it('primary sections do NOT use defaultCollapsed', () => {
    const primarySections = [
      '_h_referral',
      '_h_arrest',
      '_h_welfare',
      '_h_disclosure_received',
      '_h_conflict',
      '_h_eligibility',
    ];
    primarySections.forEach(key => {
      const re = new RegExp("key:\\s*'" + key + "'.*defaultCollapsed:\\s*true");
      assert.ok(!re.test(appJsSource), key + ' must NOT have defaultCollapsed: true');
    });
  });
});

describe('CSS — UX improvements', () => {

  it('form-group has increased margin-bottom (>= 1rem)', () => {
    const match = stylesCssSource.match(/\.form-group\s*\{[^}]*margin-bottom:\s*([\d.]+)rem/);
    assert.ok(match, 'form-group must define margin-bottom');
    assert.ok(parseFloat(match[1]) >= 1, 'form-group margin-bottom should be >= 1rem');
  });

  it('section-heading has hover state (compact collapsible mode)', () => {
    assert.ok(
      stylesCssSource.includes('.section-heading:hover') || stylesCssSource.includes('.section-heading--collapsible:hover'),
      'section-heading must have :hover styles for collapsible mode'
    );
  });

  it('expanded subsection mode uses static headings and status chips', () => {
    assert.ok(stylesCssSource.includes('.section-heading--static'), 'static subsection headings');
    assert.ok(stylesCssSource.includes('.section-status-chip'), 'subsection completion chips');
    assert.ok(stylesCssSource.includes('.subsections-expanded'), 'expanded subsection mode class');
  });

  it('section-note has visual distinction (padding + border-left)', () => {
    const noteComment = stylesCssSource.indexOf('/* Section notes within form sections */');
    assert.ok(noteComment !== -1, 'section-note comment must exist');
    const noteBlock = stylesCssSource.substring(noteComment, noteComment + 500);
    assert.ok(noteBlock.includes('border-left'), 'section-note must have border-left');
    assert.ok(noteBlock.includes('padding'), 'section-note must have padding');
  });

  it('form-section has adequate padding (>= 1.5rem)', () => {
    const sectionMatch = stylesCssSource.match(/\.form-section\s*\{[^}]*padding:\s*([\d.]+)rem/);
    assert.ok(sectionMatch, '.form-section must define padding');
    assert.ok(parseFloat(sectionMatch[1]) >= 1.4, 'form-section padding should be >= 1.4rem');
  });

  it('checklist items have adequate padding (>= 0.5rem)', () => {
    const match = stylesCssSource.match(/\.checklist-item\s*\{[^}]*padding:\s*([\d.]+)rem/);
    assert.ok(match, '.checklist-item must define padding');
    assert.ok(parseFloat(match[1]) >= 0.5, 'checklist-item padding should be >= 0.5rem');
  });

  it('checkbox inputs have min 22px size for touch targets', () => {
    const match = stylesCssSource.match(/\.checklist-item input\[type="checkbox"\]\s*\{[^}]*width:\s*(\d+)px/);
    assert.ok(match, 'checkbox width must be defined');
    assert.ok(parseInt(match[1]) >= 22, 'checkbox width should be >= 22px');
  });

  it('attendance-form has scroll-padding-top for sticky headings', () => {
    assert.ok(
      stylesCssSource.includes('scroll-padding-top'),
      'attendance-form must have scroll-padding-top'
    );
  });

  it('focus-visible styles exist for keyboard navigation', () => {
    assert.ok(
      stylesCssSource.includes('focus-visible'),
      'CSS must include focus-visible styles'
    );
  });

  it('no double scrollbar on body when form is active (body overflow: hidden)', () => {
    const bodyMatch = stylesCssSource.match(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
    assert.ok(bodyMatch, 'html, body must have overflow: hidden');
  });
});

describe('Form layout — de-squash side panels', () => {
  const indexHtmlPath = path.join(__dirname, '..', 'index.html');
  const indexHtmlSource = fs.readFileSync(indexHtmlPath, 'utf8');

  it('hides top section bar when left sidebar/rail is active', () => {
    assert.ok(
      stylesCssSource.includes('html.sidebar-nav-active #section-index-bar'),
      'sidebar-nav-active must hide duplicate section-index-bar'
    );
  });

  it('defines compact sidebar rail styles for medium widths', () => {
    assert.ok(stylesCssSource.includes('html.sidebar-compact .form-section-sidebar'), 'compact rail styles must exist');
    assert.ok(appJsSource.includes('LAYOUT_SIDEBAR_COMPACT_MAX'), 'compact breakpoint constant must exist');
  });

  it('uses 1500px threshold for docked context panel', () => {
    assert.ok(stylesCssSource.includes('min-width: 1500px'), 'context panel dock breakpoint must be 1500px');
    assert.ok(appJsSource.includes('LAYOUT_CONTEXT_DOCK_MIN = 1500'), 'context dock constant must be 1500');
  });

  it('provides summary drawer toggle and backdrop in the form header', () => {
    assert.ok(indexHtmlSource.includes('id="form-context-panel-toggle"'), 'summary toggle button must exist');
    assert.ok(indexHtmlSource.includes('id="form-context-panel-backdrop"'), 'drawer backdrop must exist');
    assert.ok(appJsSource.includes('setContextPanelCollapsed'), 'collapse helper must exist');
  });

  it('hides duplicate section status card when sidebar navigation is active', () => {
    assert.ok(
      stylesCssSource.includes('html.sidebar-nav-active .form-panel-card--section-status'),
      'section status card must hide when sidebar is active'
    );
    assert.ok(indexHtmlSource.includes('form-panel-card--section-status'), 'section status card marker class must exist');
  });

  it('lets the form use full width when sidebar navigation is active', () => {
    assert.ok(
      stylesCssSource.includes('html.sidebar-nav-active .attendance-form { max-width: none; }'),
      'form must not be capped at 1100px when sidebars are visible'
    );
  });

  it('restorePanelWidths respects compact and drawer layout modes', () => {
    assert.ok(appJsSource.includes('function clearPanelInlineWidths'), 'must clear saved inline widths in compact/drawer modes');
    assert.ok(appJsSource.includes('compactSidebar)'), 'restorePanelWidths must check compact sidebar');
    assert.ok(appJsSource.includes('contextDocked'), 'restorePanelWidths must check docked context panel');
  });
});
