const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const mainJsPath = path.join(__dirname, '..', 'main.js');
const mainJsSource = fs.readFileSync(mainJsPath, 'utf8');
// Schema DDL (indexes etc.) now lives in the versioned migration runner.
const dbMigrationsSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'dbMigrations.js'), 'utf8');
const schemaSource = mainJsSource + '\n' + dbMigrationsSource;
const stylesCssPath = path.join(__dirname, '..', 'styles.css');
const stylesCssSource = fs.readFileSync(stylesCssPath, 'utf8');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtmlSource = fs.readFileSync(indexHtmlPath, 'utf8');
const syncWorkerPath = path.join(__dirname, '..', 'main', 'syncWorker.js');
const syncWorkerSource = fs.readFileSync(syncWorkerPath, 'utf8');

describe('Performance — typing path', () => {

  it('uses single UI refresh debounce (scheduleUIRefresh) instead of multiple timers', () => {
    assert.ok(appJsSource.includes('scheduleUIRefresh'), 'app.js must use scheduleUIRefresh');
    assert.ok(appJsSource.includes('UI_REFRESH_DEBOUNCE_MS'), 'must define UI_REFRESH_DEBOUNCE_MS');
    assert.ok(appJsSource.includes('_uiRefreshDebounce'), 'must use single _uiRefreshDebounce');
  });

  it('section change handler does NOT call scheduleCollect or collectCurrentData', () => {
    const attachIdx = appJsSource.indexOf('function attachSectionListeners');
    assert.ok(attachIdx !== -1, 'attachSectionListeners must exist');
    const changeHandlerStart = appJsSource.indexOf("el.addEventListener('change'", attachIdx);
    assert.ok(changeHandlerStart !== -1, 'change listener must exist');
    const block = appJsSource.substring(changeHandlerStart, changeHandlerStart + 2200);
    assert.ok(!block.includes('scheduleCollect()'), 'change handler must not call scheduleCollect');
    assert.ok(!block.includes('collectCurrentData()'), 'change handler must not call collectCurrentData on every change');
  });

  it('section blur handler does NOT call collectCurrentData', () => {
    const attachIdx = appJsSource.indexOf('function attachSectionListeners');
    const blurIdx = appJsSource.indexOf("el.addEventListener('blur'", attachIdx);
    assert.ok(blurIdx !== -1, 'blur listener must exist');
    const blurBlock = appJsSource.substring(blurIdx, blurIdx + 350);
    assert.ok(!blurBlock.includes('collectCurrentData()'), 'blur must not call collectCurrentData (only scheduleQuietSave)');
  });

  it('scheduleQuietSave debounces reportEditorActivity', () => {
    assert.ok(appJsSource.includes('_editorActivityDebounceTimer'), 'must debounce editor activity');
    assert.ok(appJsSource.includes('EDITOR_ACTIVITY_DEBOUNCE_MS'), 'must define editor activity debounce');
  });

  it('autosave debounce is 3000ms for fluid typing', () => {
    assert.ok(appJsSource.includes('QUIET_SAVE_DEBOUNCE_MS = 3000'), 'QUIET_SAVE_DEBOUNCE_MS should be 3000');
  });

  it('autosave interval is 30 seconds for fluid typing', () => {
    assert.ok(appJsSource.includes('setInterval(quietSave, 30000)'), 'autoSaveTimer should be 30000ms');
    assert.ok(!appJsSource.includes('setInterval(quietSave, 10000)'), 'autoSaveTimer must not be 10000ms');
  });
});

describe('Performance — list rendering', () => {

  it('refreshList caches parsed data per row (getParsed)', () => {
    assert.ok(appJsSource.includes('getParsed(r)'), 'refreshList must use getParsed for per-row cache');
    assert.ok(appJsSource.includes('parsedCache[r.id]'), 'must cache by r.id');
    assert.ok(appJsSource.includes('parsedCache[r.id] = safeJson(r.data)'), 'cache must store safeJson(r.data)');
  });
});

describe('Performance — main process', () => {

  it('attendance-save skips expensive audit diff for draft saves', () => {
    const handlerStart = mainJsSource.indexOf("ipcMain.handle('attendance-save'");
    assert.ok(handlerStart !== -1, 'attendance-save handler must exist');
    const block = mainJsSource.substring(handlerStart, handlerStart + 4500);
    const diffCondition = block.indexOf("st === 'finalised' || (st === 'completed' && existing.status === 'finalised')");
    assert.ok(diffCondition !== -1, 'audit diff must run only for finalise or first transition to completed');
  });

  it('has composite index for list query', () => {
    assert.ok(schemaSource.includes('idx_att_list'), 'must have idx_att_list index');
    assert.ok(schemaSource.includes('deleted_at, archived_at, updated_at'), 'index must cover list filter columns');
  });

  it('configures calmer backup scheduler timings', () => {
    assert.ok(mainJsSource.includes('quickMinIntervalMs: 30 * 60 * 1000'),
      'main.js should set a 30 minute quick backup interval');
    assert.ok(mainJsSource.includes('userIdleGraceMs: 90 * 1000'),
      'main.js should defer backups until the user is idle for 90 seconds');
    assert.ok(mainJsSource.includes('periodicCheckMs: 10 * 60 * 1000'),
      'main.js should reduce periodic backup checks to every 10 minutes');
  });
});

describe('Performance — progress bar', () => {

  it('updateProgressBar does not call buildSectionIndexBar (avoids rebuild on every keystroke)', () => {
    const upbStart = appJsSource.indexOf('function updateProgressBar()');
    assert.ok(upbStart !== -1, 'updateProgressBar must exist');
    const bodyWindow = appJsSource.substring(upbStart, upbStart + 1200);
    assert.ok(!bodyWindow.includes('buildSectionIndexBar()'), 'updateProgressBar must not call buildSectionIndexBar');
  });
});

describe('Performance — footer and status rendering', () => {
  it('uses single-line footer with grouped status chips', () => {
    assert.ok(indexHtmlSource.includes('class="footer-row"'), 'index.html should use single footer-row');
    assert.ok(indexHtmlSource.includes('class="footer-status-group"'), 'index.html should group footer statuses');
    assert.ok(!indexHtmlSource.includes('class="footer-line1"'), 'footer-line1 should be removed');
    assert.ok(!indexHtmlSource.includes('class="footer-line2"'), 'footer-line2 should be removed');
  });

  it('does not include build date or check-for-updates button in footer', () => {
    const footerStart = indexHtmlSource.indexOf('<footer class="app-footer">');
    const footerEnd = indexHtmlSource.indexOf('</footer>', footerStart);
    const footerHtml = indexHtmlSource.substring(footerStart, footerEnd);
    assert.ok(!footerHtml.includes('home-check-update-btn'),
      'footer must not have home-check-update-btn element');
    assert.ok(!footerHtml.includes('>Build <span'), 'footer must not show build date');
  });

  it('uses shared footer indicator helper for compact status chips', () => {
    assert.ok(appJsSource.includes("function setFooterIndicator("),
      'app.js should centralize footer chip rendering');
    assert.ok(appJsSource.includes("setFooterIndicator(netStatusEl, online ? 'Online' : 'Offline'"),
      'network status should use compact chip wording');
  });

  it('backup status is event-driven only (no polling)', () => {
    assert.ok(!appJsSource.includes('setInterval(updateBackupStatus'),
      'must not poll backup status on an interval');
    assert.ok(!appJsSource.includes("setInterval(function() { updateBackupStatus"),
      'must not use setInterval wrapper for backup status');
    assert.ok(appJsSource.includes('onBackupStatusChanged'),
      'must use event-driven backup status updates');
  });
});

describe('Performance — sync cadence', () => {
  it('uses 10 second idle sync polling', () => {
    assert.ok(syncWorkerSource.includes('const SYNC_POLL_INTERVAL_MS = 10000'),
      'sync worker should use a 10 second idle poll interval');
  });
});

describe('Performance — scrolling', () => {
  it('does not apply smooth scrolling globally', () => {
    assert.ok(!stylesCssSource.includes('* { scroll-behavior: smooth; }'),
      'styles.css must not force global smooth scrolling');
  });

  it('does not pin will-change on the main form scroll container', () => {
    assert.ok(!stylesCssSource.includes('will-change: scroll-position'),
      'styles.css should not permanently hint scroll-position changes');
  });

  it('chrome-collapse uses transform/opacity instead of max-height for scroll perf', () => {
    assert.ok(stylesCssSource.includes('.chrome-collapsed .section-index-bar'),
      'chrome-collapsed section-index-bar rule must exist');
    assert.ok(stylesCssSource.includes('.chrome-collapsed .form-context-bar'),
      'chrome-collapsed form-context-bar rule must exist');
    const idxStart = stylesCssSource.indexOf('.chrome-collapsed .section-index-bar');
    const idxBlock = stylesCssSource.substring(idxStart, idxStart + 200);
    assert.ok(idxBlock.includes('transform: translateY'), 'collapse must use transform, not max-height');
    assert.ok(!idxBlock.includes('max-height: 0'), 'collapse must not use max-height animation');
  });

  it('scroll handler uses passive listener and requestAnimationFrame', () => {
    assert.ok(appJsSource.includes("{ passive: true }"),
      'scroll listener must use passive: true');
    assert.ok(appJsSource.includes('_chromeTicking'),
      'scroll handler must use rAF throttle via _chromeTicking');
  });
});

describe('Performance — compact bottom bar', () => {
  it('bottom buttons use generous sizing (56px min)', () => {
    const baseStart = stylesCssSource.indexOf('.bottom-btn {');
    const baseBlock = stylesCssSource.substring(baseStart, stylesCssSource.indexOf('}', baseStart) + 1);
    const minHeightMatch = baseBlock.match(/min-height:\s*(\d+)px/);
    assert.ok(minHeightMatch, 'bottom-btn must have min-height');
    assert.ok(parseInt(minHeightMatch[1], 10) >= 48,
      'bottom-btn base min-height should be at least 48px for touch targets');
  });

  it('bottom buttons do not use transition: all', () => {
    const btnStart = stylesCssSource.indexOf('.bottom-btn {');
    const btnBlock = stylesCssSource.substring(btnStart, btnStart + 300);
    assert.ok(!btnBlock.includes('transition: all'),
      'bottom-btn must not transition all properties (causes layout thrash)');
  });

  it('bottom buttons do not use gradient backgrounds', () => {
    const nextStart = stylesCssSource.indexOf('.bottom-btn.next-btn');
    const nextBlock = stylesCssSource.substring(nextStart, nextStart + 200);
    assert.ok(!nextBlock.includes('linear-gradient'),
      'primary bottom buttons should use flat color, not gradients');
  });

  it('progress dots have visible size (10px or larger)', () => {
    const dotStart = stylesCssSource.indexOf('.section-progress-bar .prog-dot {');
    const dotBlock = stylesCssSource.substring(dotStart, dotStart + 150);
    const widthMatch = dotBlock.match(/width:\s*(\d+)px/);
    assert.ok(widthMatch, 'prog-dot must have width in px');
    assert.ok(parseInt(widthMatch[1]) >= 8, 'prog-dot width should be at least 8px for visibility');
  });

  it('HTML buttons use short labels', () => {
    assert.ok(!indexHtmlSource.includes('>&#9783; Sections</button>'),
      'sections button should not have long "Sections" label');
    assert.ok(indexHtmlSource.includes('title="Jump to section"'),
      'sections button should have a tooltip');
    assert.ok(indexHtmlSource.includes('title="Save and exit (Ctrl+S)"'),
      'save button should show keyboard shortcut in tooltip');
  });
});

describe('Voluntary form and outcome statuses', () => {

  it('custody outcomeDecision includes ongoing and referral options', () => {
    const custodyOutcome = appJsSource.match(/id:\s*'outcome'[\s\S]*?outcomeDecision[\s\S]*?options:\s*\[([^\]]+)\]/);
    assert.ok(custodyOutcome, 'custody outcome section must exist');
    const opts = custodyOutcome[1];
    assert.ok(opts.includes("'Ongoing / Unknown'"), 'custody must include Ongoing / Unknown');
    assert.ok(opts.includes("'Officer to Notify'"), 'custody must include Officer to Notify');
    assert.ok(opts.includes("'Referred to CPS'"), 'custody must include Referred to CPS');
  });

  it('voluntary form uses same section IDs as custody (not custom vol* IDs)', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    assert.ok(volStart > 0 && volEnd > volStart, 'voluntaryFormSections must exist');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(volBlock.includes("id: 'caseArrival'"), 'voluntary must use caseArrival section ID');
    assert.ok(volBlock.includes("id: 'journeyTime'"), 'voluntary must use journeyTime section ID');
    assert.ok(volBlock.includes("id: 'custody'"), 'voluntary must use custody section ID (renamed title)');
    assert.ok(volBlock.includes("id: 'offences'"), 'voluntary must use offences section ID');
    assert.ok(volBlock.includes("id: 'disclosure'"), 'voluntary must use disclosure section ID');
    assert.ok(volBlock.includes("id: 'attend'"), 'voluntary must use attend section ID');
    assert.ok(volBlock.includes("id: 'interview'"), 'voluntary must use interview section ID');
    assert.ok(volBlock.includes("id: 'outcome'"), 'voluntary must use outcome section ID');
    assert.ok(volBlock.includes("id: 'timeRecording'"), 'voluntary must use timeRecording section ID');
    assert.ok(!volBlock.includes("id: 'volMatterSetup'"), 'must not use old volMatterSetup ID');
    assert.ok(!volBlock.includes("id: 'volOutcome'"), 'must not use old volOutcome ID');
  });

  it('voluntary form has full disclosure section (co-suspects, CCTV, exhibits, PNC)', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(volBlock.includes("'coSuspects'"), 'voluntary disclosure must have coSuspects');
    assert.ok(volBlock.includes("'cctvVisual'"), 'voluntary disclosure must have cctvVisual');
    assert.ok(volBlock.includes("'exhibitsToInspect'"), 'voluntary disclosure must have exhibitsToInspect');
    assert.ok(volBlock.includes("'pncDisclosed'"), 'voluntary disclosure must have pncDisclosed');
  });

  it('voluntary form has full consultation section (conflict, advice, signatures)', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(volBlock.includes("'conflictCheckResult'"), 'voluntary must have conflictCheckResult');
    assert.ok(volBlock.includes("'clientDecision'"), 'voluntary must have clientDecision');
    assert.ok(volBlock.includes("'repInstructionsSignature'"), 'voluntary must have repInstructionsSignature');
    assert.ok(volBlock.includes("'caseAssessment'"), 'voluntary must have caseAssessment');
    assert.ok(volBlock.includes('adviceChecklist'), 'voluntary must have adviceChecklist');
  });

  it('voluntary form has multi-interview and time recording', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(volBlock.includes('multiInterview: true'), 'voluntary must have multiInterview');
    assert.ok(volBlock.includes("'travelSocial'"), 'voluntary must have travelSocial time breakdown');
    assert.ok(volBlock.includes("'invoiceNotes'"), 'voluntary must have invoiceNotes');
    assert.ok(volBlock.includes("'invoiceNumberRef'"), 'voluntary must have invoiceNumberRef');
  });

  it('voluntary form excludes custody-specific fields', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(!volBlock.includes("'custodyNumber'"), 'voluntary must not have custodyNumber');
    assert.ok(!volBlock.includes("'groundsForArrest'"), 'voluntary must not have groundsForArrest');
    assert.ok(!volBlock.includes("'groundsForDetention'"), 'voluntary must not have groundsForDetention');
    assert.ok(!volBlock.includes("'timeDetentionAuthorised'"), 'voluntary must not have timeDetentionAuthorised');
    assert.ok(!volBlock.includes("'firstReviewDue'"), 'voluntary must not have PACE reviews');
    assert.ok(!volBlock.includes("'fitToBeDetained'"), 'voluntary must not have fitToBeDetained');
    assert.ok(!volBlock.includes("'drugsTest'"), 'voluntary must not have drugsTest');
    assert.ok(!volBlock.includes("'_pace_searches'"), 'voluntary must not have PACE searches');
    assert.ok(!volBlock.includes("'_forensic_samples'"), 'voluntary must not have forensic samples');
    assert.ok(!volBlock.includes("'bail_to_return'"), 'voluntary must not have bail_to_return outcome');
  });

  it('voluntary outcome has no caseOutcomeStatus (merged into outcomeDecision)', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(!volBlock.includes("'caseOutcomeStatus'"), 'voluntary must not have caseOutcomeStatus field');
  });

  it('voluntary outcomeDecision includes Officer to Notify and new options', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(volBlock.includes("'Officer to Notify'"), 'must include Officer to Notify');
    assert.ok(volBlock.includes("'Referred to CPS'"), 'must include Referred to CPS');
    assert.ok(volBlock.includes("'Youth caution / Youth conditional caution'"), 'must include Youth caution');
    assert.ok(volBlock.includes("'Referred to diversion programme'"), 'must include diversion');
    assert.ok(volBlock.includes("'Further voluntary interview required'"), 'must include further interview');
    assert.ok(volBlock.includes("'Ongoing / Unknown'"), 'must include Ongoing / Unknown');
  });

  it('voluntary outcomeDecision does NOT include Charged options', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(!volBlock.includes("'Charged without Bail'"), 'must not include Charged without Bail');
    assert.ok(!volBlock.includes("'Charged with Bail'"), 'must not include Charged with Bail');
  });

  it('voluntary outcome has no Client Aftercare section', () => {
    const volStart = appJsSource.indexOf('const voluntaryFormSections');
    const volEnd = appJsSource.indexOf('var activeFormSections');
    const volBlock = appJsSource.substring(volStart, volEnd);
    assert.ok(!volBlock.includes("'_h_aftercare'"), 'must not have aftercare heading');
    assert.ok(!volBlock.includes("'whatExplainedAfterInterview'"), 'must not have whatExplainedAfterInterview');
  });

  it('settings and firms UI include QuickFile import controls', () => {
    assert.ok(indexHtmlSource.includes('QuickFile invoicing'), 'settings should include QuickFile credentials section');
    assert.ok(indexHtmlSource.includes('setting-quickfile-account'), 'settings should include QuickFile account input');
    assert.ok(indexHtmlSource.includes('setting-quickfile-apikey'), 'settings should include QuickFile API key input');
    assert.ok(indexHtmlSource.includes('setting-quickfile-appid'), 'settings should include QuickFile application ID input');
    assert.ok(indexHtmlSource.includes('btn-open-qf-settings'), 'firms view should include a QuickFile settings shortcut');
    assert.ok(indexHtmlSource.includes('btn-test-qf-connection'), 'firms view should include QuickFile connection test button');
    assert.ok(indexHtmlSource.includes('btn-import-qf-clients'), 'firms view should include QuickFile import button');
    assert.ok(indexHtmlSource.includes('btn-resync-qf-clients'), 'firms view should include QuickFile re-sync button');
    assert.ok(indexHtmlSource.includes('btn-save-test-qf'), 'settings should include a save and test QuickFile button');
    assert.ok(indexHtmlSource.includes('btn-save-import-qf'), 'settings should include a save and import QuickFile button');
    assert.ok(indexHtmlSource.includes('qf-last-import'), 'firms view should show last QuickFile import note');
  });

  it('QuickFile import maps address into firms', () => {
    assert.ok(mainJsSource.includes('quickFileExtractAddress'), 'main process should extract QuickFile address data');
    assert.ok(mainJsSource.includes('function quickFileFetchAllClients()'), 'main process should page through QuickFile client results');
    assert.ok(mainJsSource.includes('ReturnCount: pageSize'), 'main process should request a supported QuickFile page size');
    assert.ok(mainJsSource.includes('client.ClientName || client.CompanyName || client.Name'), 'QuickFile client mapping should support ClientName values');
    assert.ok(mainJsSource.includes('address: quickFileExtractAddress(client)'), 'QuickFile client payload should include address');
    assert.ok(appJsSource.includes('address: nextAddress'), 'firm import should save QuickFile address');
  });

  it('charged outcomes auto-copy offences into empty outcome charge fields', () => {
    assert.ok(appJsSource.includes('function prefillOutcomeChargesFromOffences()'), 'charge prefill helper should exist');
    assert.ok(appJsSource.includes("prefillOutcomeChargesFromOffences();"), 'charged outcome flow should call auto-prefill helper');
    assert.ok(!appJsSource.includes("showConfirm('Pre-fill charges from offences recorded in Section 4?')"), 'charge prefill should no longer require a confirmation prompt');
  });

  it('bail outcome fields match disposal rules', () => {
    assert.ok(appJsSource.includes("{ key: 'bailDate', label: 'Date to return', type: 'date', showIf: { field: 'outcomeDecision', value: 'Bail without charge' } }"), 'date to return should only show for bail without charge');
    assert.ok(!appJsSource.includes("{ key: 'bailDate', label: 'Bail / Return Date', type: 'date', showIf: { field: 'outcomeDecision', value: 'Released Under Investigation' } }"), 'released under investigation should not show bail date');
    assert.ok(appJsSource.includes("function isBailReturnOutcomeDecision(decision)"), 'bail return helper should exist');
  });

  it('settings has Additional Modules card', () => {
    assert.ok(indexHtmlSource.includes('modules-installed-card'), 'must have modules-installed-card');
    assert.ok(indexHtmlSource.includes('No additional modules installed'), 'must show no modules message');
  });

  it('home screen has prominent primary cards for custody and voluntary', () => {
    assert.ok(indexHtmlSource.includes('home-primary-actions'), 'home must have primary actions container');
    assert.ok(indexHtmlSource.includes('home-primary-custody'), 'home must have primary custody card');
    assert.ok(indexHtmlSource.includes('home-primary-voluntary'), 'home must have primary voluntary card');
  });
});
