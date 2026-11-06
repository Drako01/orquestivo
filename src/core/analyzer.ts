import { parseDocument } from 'yaml';
import type { Analysis, Finding, Severity } from './types.js';

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as RecordValue;
}

function stringList(value: unknown): string[] {
  return typeof value === 'string'
    ? [value]
    : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function offsetLine(source: string, offset: number): number {
  return source.slice(0, Math.max(0, offset)).split('\n').length;
}

export function analyzeWorkflow(source: string): Analysis {
  const findings: Finding[] = [];
  const add = (code: string, severity: Severity, message: string, line = 1): void => {
    findings.push({ code, severity, message, line, evidence: 'static' });
  };
  const doc = parseDocument(source, { uniqueKeys: true, strict: true });
  if (doc.errors.length > 0) {
    for (const issue of doc.errors) {
      add('YAML_INVALID', 'error', issue.message, offsetLine(source, issue.pos[0]));
    }
    return { findings, syntaxValid: false, executionVerified: false };
  }
  const root = object(doc.toJS());
  if (!root) {
    add('WORKFLOW_ROOT_INVALID', 'error', 'The workflow must contain a YAML mapping.');
    return { findings, syntaxValid: false, executionVerified: false };
  }
  if (root.on === undefined || root.on === null || (typeof root.on === 'string' && root.on.trim() === '')) {
    add('EVENT_MISSING', 'error', 'No workflow event is defined (on:).');
  }
  if (object(root.permissions)?.['write-all'] === true || root.permissions === 'write-all') {
    add('PERMISSIONS_WRITE_ALL', 'warning', 'Broad write-all permissions should be replaced with least-privilege scopes.');
  }
  const jobs = object(root.jobs);
  if (!jobs || Object.keys(jobs).length === 0) {
    add('JOBS_MISSING', 'error', 'The workflow must contain at least one job.');
  } else {
    const dependencies = new Map<string, string[]>();
    for (const [name, value] of Object.entries(jobs)) {
      const job = object(value);
      if (!job) {
        add('JOB_INVALID', 'error', `Job "${name}" must be a mapping.`);
        continue;
      }
      const needs = stringList(job.needs);
      dependencies.set(name, needs);
      for (const need of needs) {
        if (!(need in jobs)) add('NEEDS_UNKNOWN', 'error', `Job "${name}" requires unknown job "${need}".`);
        if (need === name) add('NEEDS_SELF', 'error', `Job "${name}" cannot depend on itself.`);
      }
      const reusable = typeof job.uses === 'string';
      if (!reusable && job['runs-on'] === undefined) add('RUNNER_MISSING', 'error', `Job "${name}" has no runs-on runner.`);
      if (!reusable && !Array.isArray(job.steps)) add('STEPS_MISSING', 'error', `Job "${name}" must define a steps array.`);
      if (reusable && job.steps !== undefined) add('REUSABLE_STEPS', 'error', `Reusable workflow job "${name}" cannot also declare steps.`);
      if (typeof job.timeout_minutes !== 'number' && job['timeout-minutes'] === undefined && !reusable) {
        add('TIMEOUT_UNSET', 'information', `Job "${name}" does not define timeout-minutes.`);
      }
      if (Array.isArray(job.steps)) {
        for (const [index, raw] of job.steps.entries()) {
          const step = object(raw);
          if (!step) { add('STEP_INVALID', 'error', `Step ${index + 1} in "${name}" is not a mapping.`); continue; }
          const uses = typeof step.uses === 'string' ? step.uses : undefined;
          if (step.run === undefined && !uses) add('STEP_ACTION_MISSING', 'error', `Step ${index + 1} in "${name}" has neither run nor uses.`);
          if (uses && !uses.startsWith('./') && !uses.startsWith('docker://')) {
            const version = uses.split('@')[1];
            if (!version || !/^[a-f0-9]{40}$/i.test(version)) {
              add('ACTION_NOT_PINNED', 'warning', `Step ${index + 1} in "${name}" references an action without an immutable commit SHA.`);
            }
          }
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (name: string): boolean => {
      if (visiting.has(name)) return true;
      if (visited.has(name)) return false;
      visiting.add(name);
      for (const need of dependencies.get(name) ?? []) {
        if (dependencies.has(need) && walk(need)) return true;
      }
      visiting.delete(name);
      visited.add(name);
      return false;
    };
    if ([...dependencies.keys()].some(walk)) add('NEEDS_CYCLE', 'error', 'Job dependency graph contains a cycle.');
  }
  const permissions = object(root.permissions);
  if (permissions && Object.values(permissions).some(p => p === 'write')) {
    add('WRITE_PERMISSIONS_REVIEW', 'information', 'Workflow requests write permissions; verify that every requested scope is necessary.');
  }
  if (root.on && 'pull_request_target' in (object(root.on) ?? {})) {
    add('PR_TARGET_REVIEW', 'warning', 'pull_request_target is privileged; inspect checkouts, scripts, and untrusted PR data before execution.');
  }
  return { findings, syntaxValid: true, executionVerified: false };
}
