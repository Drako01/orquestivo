import type { ResolvedOptions, ResolvedTriggers } from './options.js';
import { auditSteps, checkoutStep, expression, MATRIX_RUNTIME, presetSteps, quote, type Step } from './steps.js';
import type { OperatingSystem } from './types.js';

const RUNNER: Readonly<Record<OperatingSystem, string>> = {
  ubuntu: 'ubuntu-latest', windows: 'windows-latest', macos: 'macos-latest',
};
const MATRIX_OS = expression('matrix.os');
const DEPLOY_TIMEOUT_MINUTES = 15;
const VERIFY_TIMEOUT_MINUTES = 20;
const SECURITY_TIMEOUT_MINUTES = 20;

const indent = (lines: readonly string[], spaces: number): string[] =>
  lines.map((line) => (line === '' ? line : ' '.repeat(spaces) + line));
const flow = (items: readonly string[]): string => '[' + items.map(quote).join(', ') + ']';

function renderStep(step: Step): string[] {
  const lines = ['- name: ' + step.name];
  if (step.if) lines.push('  if: ' + step.if);
  if (step.uses) lines.push('  uses: ' + step.uses);
  if (step.with && Object.keys(step.with).length > 0) {
    lines.push('  with:', ...Object.entries(step.with).map(([key, value]) => '    ' + key + ': ' + value));
  }
  if (step.run !== undefined) {
    if (typeof step.run === 'string') lines.push('  run: ' + step.run);
    else lines.push('  run: |', ...step.run.map((line) => '    ' + line));
  }
  return lines;
}

const renderSteps = (steps: readonly Step[]): string[] => ['steps:', ...indent(steps.flatMap(renderStep), 2)];

function renderTriggers(t: ResolvedTriggers): string[] {
  if (t.legacy) return [t.push ? 'on: [push, pull_request]' : 'on: [pull_request]'];
  const branchLines = t.branches.length > 0 ? ['  branches: ' + flow(t.branches)] : [];
  return [
    'on:',
    ...(t.push ? ['  push:', ...indent(branchLines, 2)] : []),
    ...(t.pullRequest ? ['  pull_request:', ...indent(branchLines, 2)] : []),
    ...(t.schedule === undefined ? [] : ['  schedule:', '    - cron: ' + quote(t.schedule)]),
    ...(t.manualDispatch ? ['  workflow_dispatch:'] : []),
  ];
}

function jobHeader(id: string, name: string, runsOn: string, timeout: number, permissions: readonly string[]): string[] {
  return [
    id + ':', '  name: ' + name, '  runs-on: ' + runsOn, '  timeout-minutes: ' + timeout,
    ...(permissions.length > 0 ? ['  permissions:', ...indent(permissions, 4)] : []),
  ];
}

function renderVerify(o: ResolvedOptions, steps: readonly Step[]): string[] {
  const multiOs = o.operatingSystems.length > 1;
  const multiVersion = o.runtimeVersions.length > 1;
  const runsOn = multiOs ? MATRIX_OS : RUNNER[o.operatingSystems[0] ?? 'ubuntu'];
  const lines = jobHeader('verify', 'Verify', runsOn, VERIFY_TIMEOUT_MINUTES, []);
  if (multiOs || multiVersion) {
    lines.push(
      '  strategy:', '    fail-fast: false', '    matrix:',
      ...(multiOs ? ['      os: ' + '[' + o.operatingSystems.map((os) => RUNNER[os]).join(', ') + ']'] : []),
      ...(multiVersion ? ['      runtime: ' + flow(o.runtimeVersions)] : []),
    );
  }
  if (o.operatingSystems.includes('windows')) lines.push('  defaults:', '    run:', '      shell: bash');
  const all: Step[] = [checkoutStep, ...steps];
  if (o.artifacts && o.actionPins.uploadArtifact) {
    const suffix = [multiOs ? MATRIX_OS : '', multiVersion ? MATRIX_RUNTIME : ''].filter(Boolean).join('-');
    all.push({
      name: 'Upload build artifacts', uses: 'actions/upload-artifact@' + o.actionPins.uploadArtifact,
      with: {
        name: quote(suffix === '' ? 'build' : 'build-' + suffix), path: quote(o.artifacts.path),
        'if-no-files-found': 'error', ...(o.artifacts.retentionDays ? { 'retention-days': String(o.artifacts.retentionDays) } : {}),
      },
    });
  }
  return [...lines, ...indent(renderSteps(all), 2)];
}

/** Security job: audit, dependency review or CodeQL. Returns undefined when none is requested. */
function renderSecurity(o: ResolvedOptions): string[] | undefined {
  if (o.securityScan === 'none') return undefined;
  const needs = o.sequentialJobs ? ['  needs: [verify]'] : [];
  if (o.securityScan === 'audit') {
    return [...jobHeader('security', 'Dependency audit', RUNNER.ubuntu, SECURITY_TIMEOUT_MINUTES, ['contents: read']), ...needs,
      ...indent(renderSteps([checkoutStep, ...auditSteps(o)]), 2)];
  }
  if (o.securityScan === 'dependency-review') {
    const pin = o.actionPins.dependencyReview ?? '';
    return [...jobHeader('security', 'Dependency review', RUNNER.ubuntu, SECURITY_TIMEOUT_MINUTES, ['contents: read']), ...needs,
      "  if: github.event_name == 'pull_request'",
      ...indent(renderSteps([checkoutStep, { name: 'Review dependency changes', uses: 'actions/dependency-review-action@' + pin }]), 2)];
  }
  const pin = o.actionPins.codeqlAction ?? '';
  const codeql = (path: string): string => 'github/codeql-action/' + path + '@' + pin;
  const steps: Step[] = [
    checkoutStep,
    { name: 'Initialize CodeQL', uses: codeql('init'), with: { languages: o.capabilities.codeqlLanguage ?? '' } },
    ...(o.capabilities.codeqlNeedsBuild ? [{ name: 'Autobuild', uses: codeql('autobuild') }] : []),
    { name: 'Analyze', uses: codeql('analyze') },
  ];
  return [...jobHeader('security', 'CodeQL analysis', RUNNER.ubuntu, 30,
    ['actions: read', 'contents: read', 'security-events: write']), ...needs, ...indent(renderSteps(steps), 2)];
}

/** Deploy job template. The only step is a placeholder that always fails (fails closed). */
function renderDeploy(o: ResolvedOptions, needs: readonly string[]): string[] | undefined {
  if (!o.deploy) return undefined;
  const { environment, branch } = o.deploy;
  const placeholder: Step = {
    name: 'Deploy placeholder (fails closed)',
    run: [
      'echo "No deploy command is configured. Replace this step with your own."',
      'echo "Configure required reviewers on the GitHub environment before enabling."',
      'exit 1',
    ],
  };
  return [
    ...jobHeader('deploy', 'Deploy (placeholder)', RUNNER.ubuntu, DEPLOY_TIMEOUT_MINUTES, ['contents: read', 'id-token: write']),
    '  needs: [' + needs.join(', ') + ']',
    "  if: github.ref == 'refs/heads/" + branch + "' && github.event_name != 'pull_request'",
    '  environment: ' + environment,
    '  concurrency:', '    group: ' + quote('deploy-' + environment), '    cancel-in-progress: false',
    ...indent(renderSteps([checkoutStep, placeholder]), 2),
  ];
}

/** Renders a validated option set to workflow YAML. */
export function renderWorkflow(o: ResolvedOptions): string {
  const { steps, notes } = presetSteps(o);
  const security = renderSecurity(o);
  const deploy = renderDeploy(o, security ? ['verify', 'security'] : ['verify']);
  const jobs = [renderVerify(o, steps), security, deploy].filter((job): job is string[] => job !== undefined);
  return [
    '# Generated by Orquestivo — review before committing.',
    '# Static validation is not evidence that CI will pass.',
    ...notes.map((note) => '# Note: ' + note),
    'name: CI', ...renderTriggers(o.triggers), '',
    'permissions:', '  contents: read', '',
    'concurrency:', '  group: ' + quote(expression('github.workflow') + '-' + expression('github.ref')),
    '  cancel-in-progress: true', '',
    'jobs:', ...jobs.flatMap((job, index) => [...(index > 0 ? [''] : []), ...indent(job, 2)]), '',
  ].join('\n');
}
