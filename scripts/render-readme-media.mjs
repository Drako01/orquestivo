// Renders the real Control Center HTML (src/ui) for sample data into standalone files
// so README screenshots can be captured reproducibly. Run `npm test` first (builds dist-test).
// Usage: node scripts/render-readme-media.mjs <outDir>
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { githubActionsProvider } = require('../dist-test/core/github/provider.js');
const { buildViewModel, NO_FILTERS } = require('../dist-test/ui/view-model.js');
const { renderControlCenter } = require('../dist-test/ui/render.js');
const { tr } = require('../dist-test/i18n.js');
const { providerRegistry } = require('../dist-test/providers/registry.js');

const outDir = resolve(process.argv[2] ?? 'media-render');
mkdirSync(outDir, { recursive: true });
const nonce = 'cmVhZG1lbWVkaWE=';
copyFileSync('media/icon-128.png', join(outDir, 'icon-128.png'));
const logoUri = 'icon-128.png';

const workflow = `name: Release pipeline
on:
  push:
    branches: [main]
  pull_request:
permissions: write-all
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
  scan:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ github.event.pull_request.title }}
  deploy:
    needs: [build, scan, e2e]
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: ./deploy.sh
`;
const analysis = githubActionsProvider.analyze(workflow);
const model = githubActionsProvider.model(workflow);
const file = {
  id: 0, providerName: 'GitHub Actions', model,
  result: { path: '.github/workflows/release.yml', uri: 'file:///release.yml', provider: 'github-actions', findings: analysis.findings, syntaxValid: true, executionVerified: false },
};
const contract = { version: 1, criteria: [
  { kind: 'run-tests' }, { kind: 'produce-artifacts' }, { kind: 'security-scan-present' },
  { kind: 'publish-only-from-branch', branch: 'main' },
  { kind: 'deploy-requires-approval', environment: 'production' }, { kind: 'no-secret-exposure' },
  { kind: 'deploy-confirmed', job: 'deploy', branch: 'main' },
] };
const base = {
  files: [file], scanned: true, trusted: true, level: 'advanced', filters: NO_FILTERS,
  intent: { status: 'absent' }, remote: { enabled: false, connected: false },
  aiEnabled: false, policy: { maxFiles: 150, maxFileBytes: 1048576 },
};
// Subset of the VS Code "Dark Modern" palette so the standalone page resembles the host.
const theme = `:root{--vscode-font-family:"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-panel-border:#2b2b2b;--vscode-descriptionForeground:#9d9d9d;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-dropdown-background:#313131;--vscode-dropdown-foreground:#cccccc;--vscode-dropdown-border:#3c3c3c;--vscode-focusBorder:#0078d4;--vscode-textLink-foreground:#4daafc;--vscode-textLink-activeForeground:#4daafc;--vscode-badge-background:#616161;--vscode-badge-foreground:#ffffff;--vscode-editorError-foreground:#f85149;--vscode-editorWarning-foreground:#cca700;--vscode-editorInfo-foreground:#3794ff;--vscode-testing-iconPassed:#73c991;--vscode-textCodeBlock-background:#2b2b2b;--vscode-textBlockQuote-background:#222222;--vscode-editor-font-family:Consolas,monospace}body{margin:0}`;

/** Builds one scan entry through the provider that owns `path`, exactly as the extension does. */
function entryFor(id, path, source) {
  const provider = providerRegistry.detectProvider(path);
  const analysis = provider.analyze(source);
  return {
    id, providerName: provider.displayName, model: provider.model(source),
    result: { path, uri: 'file:///' + path, provider: provider.id, findings: analysis.findings, syntaxValid: analysis.syntaxValid, executionVerified: false },
  };
}

const injectionWorkflow = `name: Triage
on:
  pull_request:
  workflow_dispatch:
    inputs:
      label:
        type: string
permissions:
  contents: read
jobs:
  triage:
    runs-on: [self-hosted, linux]
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        with:
          persist-credentials: false
      - run: git checkout \${{ github.head_ref }}
      - run: echo "Label \${{ inputs.label }}"
      - uses: actions/github-script@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        with:
          script: core.info("\${{ github.event.pull_request.body }}")
`;
const gitlabPipeline = `stages: [test, deploy]
test:
  stage: test
  image: node:latest
  script:
    - npm ci
    - npm test
deploy:
  stage: deploy
  script:
    - ./deploy.sh
`;
const jenkinsfile = `pipeline {
  agent any
  stages {
    stage('Build') { steps { sh 'make build' } }
    stage('Test') { steps { sh 'make test' } }
  }
}
`;

const scenes = {
  '04-pipeline-diagram': { ...base, level: 'advanced' },
  '05-intent-verdicts': { ...base, level: 'advanced', intent: { status: 'ready', contract } },
  '07-injection-contexts': {
    ...base, level: 'advanced', filters: { severities: new Set(), categories: new Set(['security']) },
    files: [entryFor(0, '.github/workflows/triage.yml', injectionWorkflow)],
  },
  '08-multi-provider': {
    ...base, level: 'advanced',
    files: [file, entryFor(1, '.gitlab-ci.yml', gitlabPipeline), entryFor(2, 'Jenkinsfile', jenkinsfile)],
  },
  '06-beginner-security': { ...base, level: 'beginner', filters: { severities: new Set(), categories: new Set(['security']) } },
};
for (const [name, input] of Object.entries(scenes)) {
  const html = renderControlCenter(buildViewModel(input), {
    nonce, cspSource: "'self'", language: 'en', logoUri, t: (key, params) => tr(key, 'en', params),
  }).replace('</head>', `<style nonce="${nonce}">${theme}</style></head>`);
  writeFileSync(join(outDir, `${name}.html`), html, 'utf8');
  console.log(name, input.files.reduce((n, f) => n + f.result.findings.length, 0) + ' findings');
}
