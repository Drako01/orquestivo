const { test, assert, NONCE, hostileFinding, scanFile, input, render, decode, githubActionsProvider, WORKFLOW } = require('./helpers.cjs');

const hostileInput = (level) => input({
  level, aiEnabled: true,
  files: [scanFile(0, '.github/<b>x</b>.yml', [hostileFinding()], githubActionsProvider.model(WORKFLOW))],
});

for (const level of ['beginner', 'advanced', 'expert']) {
  test(`render(${level}): hostile finding text is escaped everywhere`, () => {
    const html = render(hostileInput(level));
    assert.ok(!html.includes('<img src=x'), 'raw <img> injected');
    assert.ok(!html.includes('<script>alert'), 'raw <script> injected');
    assert.ok(!html.includes('<b>x</b>'), 'raw path markup injected');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped text is present');
    assert.ok(!/href="javascript:/i.test(html), 'javascript: docs URL must be dropped');
  });
}

test('render: CSP is present, strict and nonce based', () => {
  const html = render();
  const csp = decode(/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1]);
  assert.match(csp, /default-src 'none'/);
  assert.ok(csp.includes(`script-src 'nonce-${NONCE}'`));
  assert.ok(csp.includes(`style-src 'nonce-${NONCE}'`));
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), csp);
});

test('render: no script, style or handler without the nonce', () => {
  const html = render(hostileInput('expert'));
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert.ok(scripts.length >= 1);
  for (const tag of scripts) assert.equal(tag, `<script nonce="${NONCE}">`);
  for (const tag of html.match(/<style\b[^>]*>/g) ?? []) assert.equal(tag, `<style nonce="${NONCE}">`);
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g)) {
    const attributes = tag.replace(/"[^"]*"/g, '""');
    assert.ok(!/\son[a-z]+\s*=/i.test(attributes), 'inline event handler in ' + tag);
    assert.ok(!/\sstyle\s*=/i.test(attributes), 'style attribute is blocked by the CSP: ' + tag);
  }
});

test('render: levels share data but differ in presentation', () => {
  const finding = hostileFinding({ code: 'RULE_X', message: 'Plain message', snippet: 'uses: a/b@v1', fix: 'with:\n  k: v', docs: 'https://docs.example.com/rule', impact: 'Impact text', recommendation: 'Do this' });
  const make = (level) => render(input({ level, files: [scanFile(0, 'ci.yml', [finding])] }));
  const [b, a, e] = ['beginner', 'advanced', 'expert'].map(make);
  for (const html of [b, a, e]) {
    assert.ok(html.includes('Plain message') && html.includes('Impact text') && html.includes('Do this'));
  }
  assert.ok(!b.includes('RULE_X') && !b.includes('uses: a/b@v1'), 'beginner hides codes and evidence');
  assert.ok(a.includes('RULE_X') && a.includes('uses: a/b@v1') && a.includes('Security') && a.includes('href="https://docs.example.com/rule"'));
  assert.ok(!a.includes('Raw metadata') && !a.includes('Verification state'));
  assert.ok(e.includes('Raw metadata') && e.includes('Verification state') && e.includes('Suggested fix') && e.includes('Active policies'));
  assert.ok(!a.includes('Active policies') && !b.includes('Active policies'));
});

test('render: filters narrow the list and are exposed with aria-pressed', () => {
  const findings = [hostileFinding({ code: 'A', severity: 'error', category: 'security', message: 'first' }), hostileFinding({ code: 'B', severity: 'warning', category: 'syntax', message: 'second' })];
  const html = render(input({ files: [scanFile(0, 'ci.yml', findings)], filters: { severities: new Set(['warning']), categories: new Set() } }));
  assert.ok(html.includes('second') && !html.includes('>first<'));
  assert.match(html, /id="f-severity-warning"[^>]*aria-pressed="true"/);
  assert.match(html, /id="f-severity-error"[^>]*aria-pressed="false"/);
  assert.ok(html.includes('Showing 1 of 2 findings.'));
});

test('render: pipeline diagram is an accessible SVG with a text alternative and no execution state', () => {
  const html = render();
  const svg = /<svg[\s\S]*?<\/svg>/.exec(html)[0];
  assert.match(svg, /role="group" aria-label="Job dependency graph"/);
  const nodes = svg.match(/<g class="node[^>]*>/g);
  assert.equal(nodes.length, 3);
  for (const node of nodes) {
    assert.match(node, /tabindex="0"/);
    assert.match(node, /role="button"/);
    assert.match(node, /aria-label="Job [^"]+, line \d+, depends on \d+ job\(s\)\. Press Enter/);
    assert.match(node, /data-file="0" data-line="\d+"/);
  }
  assert.match(html, /<details><summary>Text alternative of the diagram<\/summary><pre>3 job\(s\)/);
  assert.match(html, /role="region" aria-label="Pipeline diagram of /);
  assert.ok(!/running|queued|succeeded|in progress/i.test(svg), 'diagram must not invent execution states');
});

test('render: live region, landmarks and language', () => {
  const html = render({}, 'es');
  assert.match(html, /<html lang="es">/);
  assert.match(html, /id="live" class="sr-only" role="status" aria-live="polite"/);
  assert.match(html, /data-announce="Análisis completo: 1 archivos/);
  assert.match(html, /<label for="level">Nivel de experiencia<\/label><select id="level">/);
  assert.ok(html.includes('Solo análisis estático'));
});

test('render: untrusted and empty states', () => {
  assert.ok(render({ trusted: false, scanned: false, files: [] }).includes('Trust this workspace'));
  assert.ok(render({ scanned: false, files: [] }).includes('No scan yet'));
  assert.ok(render({ files: [] }).includes('No CI/CD pipeline files were found'));
});

test('render: severity is never conveyed by color alone', () => {
  const html = render(input({ files: [scanFile(0, 'ci.yml', [hostileFinding({ code: 'E', severity: 'error' }), hostileFinding({ code: 'W', severity: 'warning' }), hostileFinding({ code: 'I', severity: 'information' })])] }));
  for (const [icon, label] of [['✖', 'Error'], ['▲', 'Warning'], ['ℹ', 'Information']]) {
    assert.ok(html.includes(`<span aria-hidden="true">${icon}</span> ${label}</span>`), label);
  }
});
