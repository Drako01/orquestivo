import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Finding, Analysis, Severity } from './types.js';

type Mapping = Record<string, unknown>;
const asMap = (value: unknown): Mapping | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Mapping : undefined;
const refs = (value: unknown): string[] =>
  typeof value === 'string' ? [value] :
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
const positiveInt = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value > 0;
const mutable = (value: string): boolean => {
  if (value.startsWith('./')) return false;
  if (value.startsWith('docker://')) return !/@sha256:[a-f0-9]{64}$/i.test(value);
  return !/@[a-f0-9]{40}$/i.test(value);
};

/** Deterministic, read-only analysis. Findings never constitute execution evidence. */
export function analyzeWorkflow(source: string): Analysis {
  const findings: Finding[] = [];
  const counter = new LineCounter();
  const doc = parseDocument(source, { uniqueKeys: true, strict: true, lineCounter: counter });
  const lineAt = (...path: (string | number)[]): number => {
    let node: unknown = doc.contents;
    let last: unknown = node;
    for (const key of path) {
      if (typeof key === 'string' && isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
        if (!pair) break;
        node = pair.value ?? pair.key;
      } else if (typeof key === 'number' && isSeq(node)) {
        node = node.items[key];
      } else break;
      last = node;
    }
    const range = last !== null && typeof last === 'object' && 'range' in last
      ? (last as { range?: readonly number[] }).range : undefined;
    return counter.linePos(range?.[0] ?? 0).line;
  };
  const add = (code: string, severity: Severity, message: string, ...path: (string | number)[]): void => {
    findings.push({ code, severity, message, line: lineAt(...path), evidence: 'static' });
  };

  if (doc.errors.length) {
    for (const issue of doc.errors) {
      findings.push({
        code: 'YAML_INVALID', severity: 'error', message: issue.message,
        line: counter.linePos(issue.pos[0]).line, evidence: 'static',
      });
    }
    return { findings, syntaxValid: false, executionVerified: false };
  }
  const root = asMap(doc.toJS());
  if (!root) {
    add('WORKFLOW_ROOT_INVALID', 'error', 'The workflow must contain a YAML mapping.');
    return { findings, syntaxValid: false, executionVerified: false };
  }
  const on = root.on;
  if (on === undefined || on === null || on === '' ||
      (Array.isArray(on) && on.length === 0) ||
      (asMap(on) && Object.keys(asMap(on) ?? {}).length === 0)) {
    add('EVENT_MISSING', 'error', 'Define at least one event under on:.', 'on');
  }
  if (!Object.hasOwn(root, 'permissions')) {
    add('PERMISSIONS_UNDECLARED', 'information',
      'Explicit minimal GITHUB_TOKEN permissions improve security auditability.', 'jobs');
  }
  if (root.permissions === 'write-all') {
    add('PERMISSIONS_WRITE_ALL', 'warning', 'Replace write-all with least-privilege token scopes.', 'permissions');
  }
  if (Object.values(asMap(root.permissions) ?? {}).includes('write')) {
    add('PERMISSIONS_WRITE_REVIEW', 'information',
      'Review workflow token write scopes for least privilege.', 'permissions');
  }
  const privileged = asMap(on)
    ? Object.hasOwn(asMap(on) ?? {}, 'pull_request_target')
    : refs(on).includes('pull_request_target');
  if (privileged) {
    add('PR_TARGET_REVIEW', 'warning',
      'pull_request_target is privileged; never execute untrusted pull-request code with elevated permissions.', 'on');
  }
  const jobs = asMap(root.jobs);
  if (!jobs || Object.keys(jobs).length === 0) {
    add('JOBS_MISSING', 'error', 'Define at least one job under jobs:.', 'jobs');
    return { findings, syntaxValid: true, executionVerified: false };
  }

  const graph = new Map<string, string[]>();
  for (const [id, value] of Object.entries(jobs)) {
    const job = asMap(value);
    if (!job) {
      add('JOB_INVALID', 'error', 'Job "' + id + '" must be a mapping.', 'jobs', id);
      continue;
    }
    const needs = refs(job.needs);
    graph.set(id, needs);
    if (job.needs !== undefined && needs.length === 0) {
      add('NEEDS_INVALID', 'error', 'Job "' + id + '" has invalid or empty needs.', 'jobs', id, 'needs');
    }
    for (const name of needs) {
      if (name === id) {
        add('NEEDS_SELF', 'error', 'Job "' + id + '" cannot depend on itself.', 'jobs', id, 'needs');
      } else if (!Object.hasOwn(jobs, name)) {
        add('NEEDS_UNKNOWN', 'error', 'Job "' + id + '" requires unknown job "' + name + '".', 'jobs', id, 'needs');
      }
    }
    const reusable = typeof job.uses === 'string';
    if (reusable) {
      if (job.steps !== undefined || job['runs-on'] !== undefined) {
        add('REUSABLE_JOB_CONFLICT', 'error', 'Reusable job "' + id + '" must not declare runs-on or steps.', 'jobs', id);
      }
      if (mutable(job.uses as string)) {
        add('REUSABLE_WORKFLOW_UNPINNED', 'warning', 'Reusable workflow "' + id + '" is not SHA-pinned.', 'jobs', id, 'uses');
      }
      if (job.secrets === 'inherit') {
        add('SECRETS_INHERIT_REVIEW', 'warning', 'Review secret inheritance for reusable job "' + id + '".', 'jobs', id, 'secrets');
      }
    } else {
      if (job['runs-on'] === undefined) {
        add('RUNNER_MISSING', 'error', 'Job "' + id + '" has no runs-on runner.', 'jobs', id);
      }
      if (!Array.isArray(job.steps) || !job.steps.length) {
        add('STEPS_MISSING', 'error', 'Job "' + id + '" needs a non-empty steps list.', 'jobs', id, 'steps');
      }
    }
    if (job['timeout-minutes'] === undefined && !reusable) {
      add('TIMEOUT_UNSET', 'information', 'Job "' + id + '" lacks an explicit timeout.', 'jobs', id);
    } else if (job['timeout-minutes'] !== undefined && !positiveInt(job['timeout-minutes'])) {
      add('TIMEOUT_INVALID', 'error', 'Job "' + id + '" timeout-minutes must be a positive integer.', 'jobs', id, 'timeout-minutes');
    }
    if (job.permissions === 'write-all') {
      add('PERMISSIONS_WRITE_ALL', 'warning', 'Job "' + id + '" requests write-all permissions.', 'jobs', id, 'permissions');
    }
    if (Object.values(asMap(job.permissions) ?? {}).includes('write')) {
      add('PERMISSIONS_WRITE_REVIEW', 'information', 'Review write permissions for job "' + id + '".', 'jobs', id, 'permissions');
    }
    const container = asMap(job.container);
    if (typeof container?.image === 'string' && !container.image.includes('@sha256:')) {
      add('CONTAINER_MUTABLE_TAG', 'warning', 'Job "' + id + '" container is not digest-pinned.', 'jobs', id, 'container');
    }
    if (!Array.isArray(job.steps)) continue;
    for (const [index, raw] of job.steps.entries()) {
      const step = asMap(raw);
      const where: (string | number)[] = ['jobs', id, 'steps', index];
      if (!step) {
        add('STEP_INVALID', 'error', 'Step ' + (index + 1) + ' of "' + id + '" is not a mapping.', ...where);
        continue;
      }
      const hasRun = typeof step.run === 'string' && step.run.trim() !== '';
      const hasUses = typeof step.uses === 'string' && step.uses.trim() !== '';
      const backgroundStep = step.wait !== undefined || step['wait-all'] !== undefined || step.cancel !== undefined;
      if (!hasRun && !hasUses && !backgroundStep) {
        add('STEP_ACTION_MISSING', 'error', 'Step ' + (index + 1) + ' of "' + id + '" has no run or uses.', ...where);
      }
      if (hasRun && hasUses) {
        add('STEP_RUN_AND_USES', 'error', 'A step cannot combine run and uses.', ...where);
      }
      if (hasUses && mutable(step.uses as string)) {
        add('ACTION_NOT_PINNED', 'warning', 'External action is not pinned to an immutable SHA.', ...where, 'uses');
      }
      if (hasRun && /\$\{\{\s*github\.event\.(?:pull_request|issue|comment|head_commit|commits)\b/i.test(step.run as string)) {
        add('EXPRESSION_IN_SCRIPT', 'warning',
          'Event-derived expressions in shell scripts may permit command injection; use a quoted environment variable.', ...where, 'run');
      }
      if (hasUses && /(?:^|\/)checkout@/i.test(step.uses as string) &&
          privileged && asMap(step.with)?.ref !== undefined) {
        add('PR_TARGET_CHECKOUT_REVIEW', 'warning',
          'Review explicit checkout ref in a privileged pull_request_target workflow.', ...where);
      }
      if (step['continue-on-error'] === true) {
        add('CONTINUE_ON_ERROR_REVIEW', 'information',
          'This step ignores failures; verify downstream quality gates.', ...where, 'continue-on-error');
      }
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let cycle = false;
  const walk = (id: string): void => {
    if (cycle || visited.has(id)) return;
    if (visiting.has(id)) { cycle = true; return; }
    visiting.add(id);
    for (const name of graph.get(id) ?? []) if (graph.has(name)) walk(name);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) walk(id);
  if (cycle) add('NEEDS_CYCLE', 'error', 'Job dependency graph contains a cycle.', 'jobs');

  return { findings, syntaxValid: true, executionVerified: false };
}
