const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { messages, tr, resolveLanguage } = require('../dist-test/i18n.js');

const root = path.join(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('i18n: English and Spanish catalogs have exactly the same keys', () => {
  assert.deepEqual(Object.keys(messages.es).sort(), Object.keys(messages.en).sort());
});

test('i18n: every message is non-empty and keeps its placeholders in both languages', () => {
  for (const key of Object.keys(messages.en)) {
    assert.ok(messages.en[key].trim() !== '' && messages.es[key].trim() !== '', key);
    assert.deepEqual(placeholders(messages.es[key]), placeholders(messages.en[key]), key);
  }
});

test('i18n: tr interpolates, falls back to English and resolves Spanish variants', () => {
  assert.equal(tr('lineLabel', 'en', { line: 4 }), 'Line 4');
  assert.equal(tr('lineLabel', 'es-AR', { line: 4 }), 'Línea 4');
  assert.equal(tr('lineLabel', 'fr', { line: 4 }), 'Line 4');
  assert.equal(resolveLanguage('ES'), 'es');
  assert.ok(tr('lineLabel', 'en').includes('{line}'), 'missing params stay visible instead of becoming "undefined"');
});

test('i18n: package.nls.json and package.nls.es.json have the same keys', () => {
  assert.deepEqual(Object.keys(readJson('package.nls.es.json')).sort(), Object.keys(readJson('package.nls.json')).sort());
});

test('i18n: every %key% used in package.json exists in both nls files and none is unused', () => {
  const used = new Set();
  const visit = (value) => {
    if (typeof value === 'string') { const m = /^%(.+)%$/.exec(value); if (m) used.add(m[1]); }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(readJson('package.json'));
  const en = readJson('package.nls.json');
  const es = readJson('package.nls.es.json');
  assert.ok(used.size > 10);
  for (const key of used) assert.ok(key in en && key in es, `missing nls key ${key}`);
  for (const key of Object.keys(en)) assert.ok(used.has(key), `unused nls key ${key}`);
});

test('i18n: package.json user-facing contributes text is localized', () => {
  const pkg = readJson('package.json');
  const check = (value, where) => assert.match(String(value), /^%.+%$/, where);
  for (const c of pkg.contributes.commands) check(c.title, c.command);
  for (const [key, prop] of Object.entries(pkg.contributes.configuration.properties)) {
    check(prop.description, key);
    (prop.enumDescriptions ?? []).forEach((d) => check(d, key));
  }
  for (const view of pkg.contributes.views.orquestivo) check(view.name, view.id);
  check(pkg.capabilities.untrustedWorkspaces.description, 'untrusted');
  check(pkg.capabilities.virtualWorkspaces.description, 'virtual');
});

test('i18n: every t(...) key used in src exists in the catalog', () => {
  const known = new Set(Object.keys(messages.en));
  let seen = 0;
  for (const file of walk(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/\bt\(\s*'([A-Za-z]+)'/g)) {
      seen += 1;
      assert.ok(known.has(m[1]), `${path.relative(root, file)}: unknown key ${m[1]}`);
    }
  }
  assert.ok(seen > 50);
});

test('i18n: no hardcoded user-facing literals in src/vscode or extension.ts (heuristic)', () => {
  const files = [...walk(path.join(root, 'src', 'vscode')), path.join(root, 'src', 'extension.ts')];
  const lit = '(?:\'[^\']*[A-Za-z]{2,}[^\']*\'|"[^"]*[A-Za-z]{2,}[^"]*"|`[^`]*[A-Za-z]{2,}[^`]*`)';
  const patterns = [
    new RegExp('show(?:Information|Warning|Error)Message\\(\\s*' + lit),
    new RegExp('(?:placeHolder|prompt|label|description|detail)\\s*:\\s*' + lit),
    new RegExp('new vscode\\.TreeItem\\(\\s*' + lit),
    new RegExp('\\btitle\\s*:\\s*' + lit),
  ];
  const allowed = /createWebviewPanel|createOutputChannel|getConfiguration|HOME_VIEW_TYPE/;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || allowed.test(line)) return;
      const code = line.replace(/\$\{[^}]*\}/g, '');
      for (const re of patterns) assert.ok(!re.test(code), `${path.relative(root, file)}:${i + 1} looks like a hardcoded user-facing string: ${line.trim()}`);
    });
  }
});

test('i18n: heuristic really catches hardcoded strings', () => {
  const re = /show(?:Information|Warning|Error)Message\(\s*(?:'[^']*[A-Za-z]{2,}[^']*')/;
  assert.ok(re.test("vscode.window.showInformationMessage('Hello world')"));
  assert.ok(!re.test("vscode.window.showInformationMessage(t('aiDisabled'))"));
});

test('i18n: src/vscode and extension.ts are the only places importing vscode', () => {
  for (const file of walk(path.join(root, 'src'))) {
    const rel = path.relative(path.join(root, 'src'), file).split(path.sep).join('/');
    if (rel === 'extension.ts' || rel.startsWith('vscode/')) continue;
    assert.ok(!/from\s+['"]vscode['"]/.test(fs.readFileSync(file, 'utf8')), `${rel} must not import vscode`);
  }
});
