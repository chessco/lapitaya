'use strict';

// La Pitaya Foundation v0.1 — the contracts the fork adds on top of the
// upstream runtime: one brand source, agent names per locale, the CIMA rules,
// the autonomy policy, the Alicia seam and the three-way locale split.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const brand = loadTs('src/shared/lapitaya/brand.ts');
const agents = loadTs('src/shared/lapitaya/agents.ts');
const cima = loadTs('src/shared/lapitaya/cima.ts');
const autonomy = loadTs('src/shared/lapitaya/autonomy.ts');
const locales = loadTs('src/shared/lapitaya/locales.ts');
const alicia = loadTs('src/shared/lapitaya/alicia/index.ts');
const { CIMA_GOD_BRIEFING } = loadTs('src/shared/lapitaya/cimaBriefing.ts');
const { DEFAULT_GOD_NAME } = loadTs('src/shared/godIdentity.ts');

// --- identity -------------------------------------------------------------

test('the brand has one source and the expected identity', () => {
  assert.equal(brand.LA_PITAYA_NAME, 'La Pitaya');
  assert.equal(brand.LA_PITAYA_TAGLINE, 'Sonoran Multi-Agent AI Harness');
  assert.equal(brand.LA_PITAYA_ORGANIZATION, 'PitayaCode');
  assert.equal(brand.LA_PITAYA_ORIGIN, 'Sonora, Mexico');
  assert.match(brand.LA_PITAYA_VERSION, /^\d+\.\d+\.\d+/);
  // Attribution to the MIT upstream is kept, not erased.
  assert.equal(brand.LA_PITAYA_UPSTREAM.license, 'MIT');
});

test('visible surfaces read the brand constant instead of a literal', () => {
  assert.match(read('src/main/index.ts'), /title: isFloor \? `\$\{LA_PITAYA_NAME\} — Floor` : LA_PITAYA_NAME/);
  assert.match(read('src/renderer/src/App.tsx'), /alt=\{LA_PITAYA_NAME\}/);
  assert.match(read('src/renderer/index.html'), /<title>La Pitaya<\/title>/);
});

test('the updater polls the La Pitaya repository, never the upstream one', () => {
  const { REPO, installerUrl } = loadTs('src/shared/updateState.ts');
  assert.equal(REPO, 'chessco/lapitaya');
  assert.match(installerUrl('0.1.0', 'win32', 'x64'), /\/chessco\/lapitaya\/releases\/download\/v0\.1\.0\/La-Pitaya-0\.1\.0-win-x64-setup\.exe$/);
  const yml = read('electron-builder.yml');
  assert.match(yml, /owner: chessco/);
  assert.match(yml, /repo: lapitaya/);
  assert.match(yml, /artifactName: La-Pitaya-\$\{version\}-win-x64-setup\.exe/);
});

// --- agents ---------------------------------------------------------------

test('the orchestrator defaults to El Inge', () => {
  assert.equal(DEFAULT_GOD_NAME, 'El Inge');
  assert.equal(agents.EL_INGE_NAME, 'El Inge');
});

test('an upstream hive that persisted "Michael" migrates to El Inge; real renames survive', () => {
  const { resolveGodName } = loadTs('src/shared/godIdentity.ts');
  assert.equal(resolveGodName('Michael'), 'El Inge');
  assert.equal(resolveGodName('  Michael  '), 'El Inge');
  assert.equal(resolveGodName('Savvas'), 'Savvas');
  assert.equal(resolveGodName('michael scott'), 'michael scott', 'only the exact legacy default migrates');
});

test('the full roster is present with the right roles', () => {
  const byRole = Object.fromEntries(agents.LA_PITAYA_AGENTS.map((a) => [a.role, a.id]));
  assert.deepEqual(byRole, {
    orchestrator: 'el-inge',
    architect: 'valentin',
    builder: 'el-beni',
    tester: 'margarito',
    auditor: 'jose-juan',
    learner: 'el-tutu',
    companion: 'alicia'
  });
});

test('es-MX keeps the accents; en-US uses the exact ASCII spelling', () => {
  const es = agents.LA_PITAYA_AGENTS.map((a) => agents.agentDisplayName(a.id, 'es-MX'));
  const en = agents.LA_PITAYA_AGENTS.map((a) => agents.agentDisplayName(a.id, 'en-US'));
  assert.deepEqual(es, ['El Inge', 'Valentín', 'El Beni', 'Margarito', 'José Juan', 'El Tutú', 'Alicia']);
  assert.deepEqual(en, ['El Inge', 'Valentin', 'El Beni', 'Margarito', 'Jose Juan', 'El Tutu', 'Alicia']);
  for (const name of en) assert.match(name, /^[\x20-\x7e]+$/, `${name} is not ASCII`);
});

test('a typed name resolves in either spelling', () => {
  assert.equal(agents.agentByName('Valentín').id, 'valentin');
  assert.equal(agents.agentByName('valentin').id, 'valentin');
  assert.equal(agents.agentByName('JOSE JUAN').id, 'jose-juan');
  assert.equal(agents.agentByName('Michael'), undefined);
});

test('hire presets carry a briefing and the CIMA hard rules', () => {
  const presets = agents.LA_PITAYA_HIRE_PRESETS.map((a) => a.id);
  assert.deepEqual(presets, ['valentin', 'el-beni', 'margarito', 'jose-juan', 'el-tutu']);
  for (const a of agents.LA_PITAYA_HIRE_PRESETS) {
    assert.ok(a.description && a.goal, `${a.id} has no briefing`);
    assert.match(a.goal, /Builder != Auditor/);
    assert.match(a.goal, /Evidence First/);
    assert.ok(a.character, `${a.id} has no sprite`);
  }
  // The auditor must be told it cannot touch what it audits.
  assert.match(agents.LA_PITAYA_AGENT_BY_ID['jose-juan'].goal, /NEVER modify the code you audit/);
});

test('Alicia is a capability, not a hive agent or a replacement', () => {
  const a = agents.LA_PITAYA_AGENT_BY_ID.alicia;
  assert.equal(a.runtime, 'capability');
  assert.equal(a.character, undefined);
  assert.ok(!agents.LA_PITAYA_HIRE_PRESETS.includes(a));
});

test('agentLocale adds a language line only for non-English locales', () => {
  assert.equal(agents.agentLanguageDirective('en-US'), '');
  assert.match(agents.agentLanguageDirective('es-MX'), /es-MX/);
  assert.match(agents.agentLanguageDirective('es-MX'), /verbatim, untranslated/);
});

test('El Inge is briefed on CIMA and the autonomy policy', () => {
  const src = read('src/renderer/src/hooks/useHive.ts');
  assert.match(src, /initialGodPrompt\(godName\)/, 'the orientation prompt must use the live name');
  assert.doesNotMatch(src, /You're online as Michael/);
  assert.match(CIMA_GOD_BRIEFING, /Valentin \(Architect, ARCHITECT\)/);
  assert.match(CIMA_GOD_BRIEFING, /Builder != Auditor/);
});

// --- CIMA -----------------------------------------------------------------

test('CIMA phases are stable uppercase ids in workflow order', () => {
  assert.deepEqual([...cima.CIMA_CORE], ['BUILD', 'TEST', 'LEARN', 'ITERATE']);
  assert.deepEqual([...cima.CIMA_WORKFLOW],
    ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE']);
  assert.equal(cima.nextPhase('BUILD'), 'TEST');
  assert.equal(cima.nextPhase('ITERATE'), 'CONTEXT');
  assert.equal(cima.isCimaPhase('build'), false, 'ids are case-sensitive');
});

test('Builder != Auditor', () => {
  assert.equal(cima.canApprove({ builderId: 'el-beni-1', approverId: 'jose-juan-1' }), true);
  assert.equal(cima.canApprove({ builderId: 'el-beni-1', approverId: 'el-beni-1' }), false);
  assert.equal(cima.canApprove({ builderId: 'El-Beni-1', approverId: ' el-beni-1 ' }), false);
  assert.equal(cima.canApprove({ builderId: 'el-beni-1', approverId: '' }), false);
});

test('Evidence First: no PASS without raw evidence or with a failing exit', () => {
  const ok = { kind: 'test-output', source: 'npm test', raw: 'ℹ pass 3', exitCode: 0 };
  const bad = { kind: 'exit-code', source: 'npm run build', raw: '1', exitCode: 1 };
  assert.equal(cima.isVerdictBacked('PASS', []), false);
  assert.equal(cima.isVerdictBacked('PASS', [{ ...ok, raw: '   ' }]), false);
  assert.equal(cima.isVerdictBacked('PASS', [ok]), true);
  assert.equal(cima.isVerdictBacked('FAIL', []), true);
  assert.equal(cima.evidenceAllowsPass([ok]), true);
  assert.equal(cima.evidenceAllowsPass([ok, bad]), false);
});

// --- autonomy -------------------------------------------------------------

test('risk maps to mode: LOW→AUTO, MEDIUM→SUPERVISED, HIGH→HUMAN_APPROVAL', () => {
  assert.equal(autonomy.modeFor('run-tests'), 'AUTO');
  assert.equal(autonomy.modeFor('api-change'), 'SUPERVISED');
  assert.equal(autonomy.modeFor('production'), 'HUMAN_APPROVAL');
  assert.equal(autonomy.modeFor('data-deletion'), 'HUMAN_APPROVAL');
});

test('unknown actions are HIGH risk', () => {
  assert.equal(autonomy.riskOf('rm -rf'), 'HIGH');
  assert.equal(autonomy.requiresHuman('something-new'), true);
});

test('no autonomy stage can switch off Human Governance', () => {
  for (const stage of autonomy.AUTONOMY_STAGES) {
    assert.equal(autonomy.modeFor('auth', stage), 'HUMAN_APPROVAL', stage);
    assert.equal(autonomy.modeFor('infrastructure', stage), 'HUMAN_APPROVAL', stage);
  }
  assert.equal(autonomy.modeFor('lint', 'HUMAN_CONTROLLED'), 'HUMAN_APPROVAL');
  assert.equal(autonomy.modeFor('broad-refactor', 'SEMI_AUTONOMOUS'), 'AUTO');
});

// --- Alicia ---------------------------------------------------------------

test('Alicia is disabled by default and her calls are no-ops', () => {
  assert.equal(alicia.alicia().enabled, false);
  assert.doesNotThrow(() => alicia.alicia().notify({ type: 'error', ts: 0, source: 'hive' }));
});

test('a registered Alicia receives events, and a throwing one cannot break the caller', () => {
  const seen = [];
  const restore = alicia.registerAlicia({ id: 'test', enabled: true, notify: (e) => seen.push(e.type) });
  alicia.alicia().notify({ type: 'cima.phase.changed', ts: 0, source: 'cima-runtime', phase: 'TEST' });
  restore();
  assert.deepEqual(seen, ['cima.phase.changed']);
  assert.equal(alicia.alicia().id, 'none');

  const restoreBad = alicia.registerAlicia({ id: 'bad', enabled: true, notify: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => alicia.alicia().notify({ type: 'error', ts: 0, source: 'hive' }));
  restoreBad();
});

// --- i18n -----------------------------------------------------------------

test('es-MX is the default and en-US the fallback; future locales are declared, not active', () => {
  assert.equal(locales.DEFAULT_LOCALE, 'es-MX');
  assert.equal(locales.FALLBACK_LOCALE, 'en-US');
  assert.deepEqual([...locales.ACTIVE_LOCALES], ['es-MX', 'en-US']);
  for (const l of ['pt-BR', 'fr-FR', 'de-DE', 'ja-JP', 'zh-CN']) assert.ok(locales.PLANNED_LOCALES.includes(l), l);
});

test('uiLocale, agentLocale and notificationLocale resolve independently', () => {
  assert.deepEqual(locales.resolveLocaleSettings(null),
    { uiLocale: 'es-MX', agentLocale: 'en-US', notificationLocale: 'es-MX' });
  assert.deepEqual(locales.resolveLocaleSettings({ uiLocale: 'en-US' }),
    { uiLocale: 'en-US', agentLocale: 'en-US', notificationLocale: 'es-MX' },
    'changing the UI language must not move the other two');
  assert.equal(locales.resolveLocaleSettings({ uiLocale: 'en' }).uiLocale, 'en-US', 'legacy upstream code migrates');
});

test('the La Pitaya namespace exists for es-MX and en-US with identical keys', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
  const es = JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/es-MX.json'));
  const en = JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/en-US.json'));
  assert.deepEqual(flat(es).sort(), flat(en).sort());
  // CIMA ids are keys (never translated); only labels are.
  for (const p of cima.CIMA_WORKFLOW) {
    assert.ok(es.cima.phases[p] && en.cima.phases[p], p);
  }
  assert.equal(es.cima.phases.BUILD, 'Construir');
  assert.equal(en.cima.phases.BUILD, 'Build');
});

test('the en-US La Pitaya strings contain no accented characters', () => {
  const text = read('src/renderer/src/i18n/locales/lapitaya/en-US.json');
  assert.doesNotMatch(text, /[À-ÿ]/);
});

test('es-MX translates every key of en.json (none left as a copied English string of note)', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]);
  const en = Object.fromEntries(flat(JSON.parse(read('src/renderer/src/i18n/locales/en.json'))));
  const es = Object.fromEntries(flat(JSON.parse(read('src/renderer/src/i18n/locales/es-MX.json'))));
  // Long sentences identical to English mean an untranslated string.
  const copied = Object.keys(en).filter((k) =>
    typeof en[k] === 'string' && en[k].split(' ').length > 5 && en[k] === es[k]);
  assert.deepEqual(copied, []);
});
