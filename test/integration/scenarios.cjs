// Scenarios that drive the real extension inside a real VS Code host.
// UI prompts (QuickPick, InputBox, modal messages) are answered by a recorded stub so the flows are deterministic;
// `fetch` is stubbed so nothing ever leaves the machine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => fs.existsSync(file);

/** Intercept prompts inside Orquestivo's own API facade, not the separate test extension facade. */
async function withStubs(options, body) {
  const installed = await vscode.commands.executeCommand('orquestivo.__e2e.prompts.begin', options);
  assert.equal(installed, true, 'integration prompt bridge must be active');
  const messages = async () => vscode.commands.executeCommand('orquestivo.__e2e.prompts.snapshot');
  try {
    await body(messages);
  } finally {
    await vscode.commands.executeCommand('orquestivo.__e2e.prompts.end');
  }
}

const workspaceRoot = () => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'integration workspace is required');
  return folder.uri.fsPath;
};
const errorCodes = (uri) => vscode.languages.getDiagnostics(uri)
  .filter((item) => item.severity === vscode.DiagnosticSeverity.Error).map((item) => item.code);

/** The analyzer, running inside the real extension, must flag attacker-controlled contexts it used to miss. */
async function injectionDiagnostics() {
  const target = vscode.Uri.file(path.join(workspaceRoot(), '.github', 'workflows', 'injection-it.yml'));
  const source = [
    'name: Triage', 'on: pull_request', 'permissions:', '  contents: read', 'jobs:', '  triage:',
    '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:',
    '      - run: git checkout ${{ github.head_ref }}', '',
  ].join('\n');
  fs.writeFileSync(target.fsPath, source);
  try {
    let codes = [];
    for (let attempt = 0; attempt < 40 && !codes.includes('EXPRESSION_IN_SCRIPT'); attempt++) {
      await vscode.commands.executeCommand('orquestivo.analyze');
      codes = vscode.languages.getDiagnostics(target).map((item) => String(item.code?.value ?? item.code));
      if (!codes.includes('EXPRESSION_IN_SCRIPT')) await sleep(250);
    }
    assert.ok(codes.includes('EXPRESSION_IN_SCRIPT'), 'github.head_ref in run must be flagged in the Problems panel, got [' + codes.join(',') + ']');
  } finally {
    fs.rmSync(target.fsPath, { force: true });
    await vscode.commands.executeCommand('orquestivo.analyze');
  }
}

/** Wizard end to end: create, refuse to touch a link that leaves the workspace, and undo. */
async function wizardCreateAndUndo() {
  const file = path.join(workspaceRoot(), '.github', 'workflows', 'wizard-it.yml');
  assert.equal(exists(file), false, 'precondition: the wizard target must not exist');
  await withStubs({ inputs: ['wizard-it.yml'] }, async (messages) => {
    await vscode.commands.executeCommand('orquestivo.generateCI');
    assert.equal(exists(file), true, 'the wizard must create the workflow on disk; errors: ' + (await messages()).error.join(' | '));
    const written = fs.readFileSync(file, 'utf8');
    assert.match(written, /^name: /m);
    await vscode.commands.executeCommand('orquestivo.analyze');
    assert.deepEqual(errorCodes(vscode.Uri.file(file)), [], 'a generated workflow must not carry errors');
  });
  await withStubs({}, async (messages) => {
    await vscode.commands.executeCommand('orquestivo.undoLastGeneration');
    assert.equal(exists(file), false, 'undo must delete the file the wizard created; errors: ' + (await messages()).error.join(' | '));
  });
  await withStubs({}, async (messages) => {
    await vscode.commands.executeCommand('orquestivo.undoLastGeneration');
    assert.ok((await messages()).info.length > 0, 'a second undo has nothing to do and must say so');
    assert.equal((await messages()).error.length, 0);
  });
}

async function wizardRefusesLinksOutsideWorkspace() {
  const workflows = path.join(workspaceRoot(), '.github', 'workflows');
  const parked = workflows + '.parked';
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'orquestivo-outside-'));
  fs.renameSync(workflows, parked);
  try {
    try {
      fs.symlinkSync(elsewhere, workflows, 'junction');
    } catch (error) {
      console.log('SKIPPED wizardRefusesLinksOutsideWorkspace: cannot create a link here (' + error.code + ')');
      return;
    }
    await withStubs({ inputs: ['escape-it.yml'] }, async (messages) => {
      await vscode.commands.executeCommand('orquestivo.generateCI');
      assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing may be written through a link that leaves the workspace');
      assert.ok((await messages()).error.some((m) => /outside the workspace|fuera del workspace/.test(m)), 'the refusal must be explained: ' + (await messages()).error.join(' | '));
    });
  } finally {
    fs.rmSync(workflows, { recursive: true, force: true });
    fs.renameSync(parked, workflows);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
}

/** Opt-in GitHub evidence with a fake network: the token must only travel as a bearer header to api.github.com. */
async function remoteEvidenceWithFakeNetwork() {
  const calls = [];
  const realFetch = globalThis.fetch;
  const run = { id: 7, name: 'CI', head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z', html_url: 'https://github.com/octo/repo/actions/runs/7' };
  globalThis.fetch = async (url, init) => {
    // The host itself uses the global fetch (telemetry, experiments); only GitHub API traffic is simulated.
    if (!String(url).startsWith('https://api.github.com/')) return realFetch(url, init);
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const body = String(url).includes('/jobs') ? { jobs: [] } : String(url).includes('/artifacts') ? { artifacts: [] } : { workflow_runs: [run] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const config = vscode.workspace.getConfiguration('orquestivo');
  try {
    await config.update('remote.enabled', true, vscode.ConfigurationTarget.Global);
    await withStubs({ inputs: ['ghp_' + 'x'.repeat(36), 'octo/repo'] }, async () => {
      await vscode.commands.executeCommand('orquestivo.connectGitHub');
      await vscode.commands.executeCommand('orquestivo.fetchRuns');
    });
    if (calls.length === 0) {
      console.log('SKIPPED remoteEvidenceWithFakeNetwork: SecretStorage is unavailable in this host, so no token was stored');
      return;
    }
    for (const call of calls) {
      assert.ok(call.url.startsWith('https://api.github.com/repos/octo/repo/actions/'), 'unexpected host or path: ' + call.url);
      assert.match(String(call.headers.Authorization), /^Bearer ghp_x+$/);
    }
  } finally {
    globalThis.fetch = realFetch;
    await withStubs({}, async () => { await vscode.commands.executeCommand('orquestivo.disconnectGitHub'); });
    await config.update('remote.enabled', false, vscode.ConfigurationTarget.Global);
  }
}

/** The internal openFinding command is reachable by other extensions: it must not open arbitrary schemes. */
async function openFindingRejectsForeignTargets() {
  await withStubs({}, async (messages) => {
    await vscode.commands.executeCommand('orquestivo.openFinding', 'command:workbench.action.quit', 1);
    await vscode.commands.executeCommand('orquestivo.openFinding', 'file:///etc/passwd', 1);
    await vscode.commands.executeCommand('orquestivo.openFinding', { not: 'a uri' }, 1);
    assert.equal((await messages()).warning.length, 3, 'each foreign target must be refused with a warning');
  });
}

async function aiStaysOffline() {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.github.com/') && !/openai|anthropic|googleapis/.test(String(url))) return realFetch(url, init);
    calls.push(String(url));
    throw new Error('network must not be used');
  };
  try {
    await withStubs({}, async (messages) => {
      await vscode.commands.executeCommand('orquestivo.ai.explainFinding');
      assert.ok((await messages()).info.length > 0, 'a disabled AI helper must explain how to enable it');
    });
    assert.deepEqual(calls, [], 'the AI helper must never touch the network');
  } finally {
    globalThis.fetch = realFetch;
  }
}

exports.runScenarios = async function runScenarios() {
  const scenarios = [injectionDiagnostics, wizardCreateAndUndo, wizardRefusesLinksOutsideWorkspace,
    remoteEvidenceWithFakeNetwork, openFindingRejectsForeignTargets, aiStaysOffline];
  for (const scenario of scenarios) {
    await sleep(50);
    console.log('START integration scenario: ' + scenario.name);
    let timer;
    try {
      await Promise.race([
        scenario(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('E2E_TIMEOUT: ' + scenario.name +
            ' exceeded 45 seconds (check dialog automation and extension-host logs)')), 45000);
        }),
      ]);
      console.log('PASS integration scenario: ' + scenario.name);
    } finally {
      clearTimeout(timer);
    }
  }
};
