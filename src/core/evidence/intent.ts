import type { JobModel, PipelineModel, StepModel } from '../model.js';
import type { RemoteContext, RunEvidence } from './run-evidence.js';
import type { CheckResult, EvidenceRef, Verdict } from './verdict.js';
import { redactSecrets } from '../../security/redact.js';

/** Workspace-relative location of the intent contract. */
export const INTENT_CONTRACT_PATH = '.orquestivo/intent.json';
const MAX_CRITERIA = 100;
const MAX_STRING = 200;

// ---------------------------------------------------------------- contract types

interface CriterionBase {
  readonly description?: string;
}
export type IntentCriterion = CriterionBase &
  (
    | { readonly kind: 'run-tests' }
    | { readonly kind: 'block-merge-on-build-failure' }
    | { readonly kind: 'produce-artifacts' }
    | { readonly kind: 'publish-only-from-branch'; readonly branch: string }
    | { readonly kind: 'deploy-requires-approval'; readonly environment: string }
    | { readonly kind: 'min-coverage'; readonly percent: number }
    | { readonly kind: 'security-scan-present' }
    | { readonly kind: 'no-secret-exposure' }
    | { readonly kind: 'deploy-confirmed'; readonly job: string; readonly branch?: string }
  );
export type IntentKind = IntentCriterion['kind'];

export interface IntentContract {
  readonly version: 1;
  readonly criteria: readonly IntentCriterion[];
}

export interface IntentIssue {
  readonly path: string;
  readonly message: string;
}

export class IntentContractError extends Error {
  constructor(readonly issues: readonly IntentIssue[]) {
    super(`Invalid intent contract: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'IntentContractError';
  }
}

// ---------------------------------------------------------------- validation (strict, hand-written)

type FieldSpec = 'string' | 'percent';
interface KindSpec {
  readonly required: Readonly<Record<string, FieldSpec>>;
  readonly optional: Readonly<Record<string, FieldSpec>>;
}

/** Single source of truth for which kinds exist and which fields they accept. */
const KIND_SPECS: Readonly<Record<IntentKind, KindSpec>> = {
  'run-tests': { required: {}, optional: {} },
  'block-merge-on-build-failure': { required: {}, optional: {} },
  'produce-artifacts': { required: {}, optional: {} },
  'publish-only-from-branch': { required: { branch: 'string' }, optional: {} },
  'deploy-requires-approval': { required: { environment: 'string' }, optional: {} },
  'min-coverage': { required: { percent: 'percent' }, optional: {} },
  'security-scan-present': { required: {}, optional: {} },
  'no-secret-exposure': { required: {}, optional: {} },
  'deploy-confirmed': { required: { job: 'string' }, optional: { branch: 'string' } },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKind = (value: unknown): value is IntentKind =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(KIND_SPECS, value);

function checkField(spec: FieldSpec, value: unknown): string | undefined {
  if (spec === 'string') {
    if (typeof value !== 'string' || value.trim() === '') return 'must be a non-empty string';
    if (value.length > MAX_STRING) return `must be at most ${MAX_STRING} characters`;
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
    return 'must be a number greater than 0 and at most 100';
  }
  return undefined;
}

function validateCriterion(raw: unknown, path: string, issues: IntentIssue[]): IntentCriterion | undefined {
  if (!isRecord(raw)) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  const kind = raw['kind'];
  if (!isKind(kind)) {
    issues.push({ path: `${path}.kind`, message: `must be one of: ${Object.keys(KIND_SPECS).join(', ')}` });
    return undefined;
  }
  const spec = KIND_SPECS[kind];
  const before = issues.length;
  const allowed = new Set(['kind', 'description', ...Object.keys(spec.required), ...Object.keys(spec.optional)]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) issues.push({ path: `${path}.${key}`, message: 'unknown property' });
  }
  const checkAll = (fields: Readonly<Record<string, FieldSpec>>, mandatory: boolean): void => {
    for (const [key, fieldSpec] of Object.entries(fields)) {
      if (!(key in raw)) {
        if (mandatory) issues.push({ path: `${path}.${key}`, message: 'is required' });
        continue;
      }
      const problem = checkField(fieldSpec, raw[key]);
      if (problem) issues.push({ path: `${path}.${key}`, message: problem });
    }
  };
  checkAll(spec.required, true);
  checkAll(spec.optional, false);
  checkAll({ description: 'string' }, false);
  // Fields were validated individually above, so the shape is now known to match the union.
  return issues.length === before ? (raw as unknown as IntentCriterion) : undefined;
}

export function validateIntentContract(raw: unknown): IntentContract {
  const issues: IntentIssue[] = [];
  if (!isRecord(raw)) throw new IntentContractError([{ path: '$', message: 'must be an object' }]);
  for (const key of Object.keys(raw)) {
    if (key !== 'version' && key !== 'criteria') issues.push({ path: `$.${key}`, message: 'unknown property' });
  }
  if (raw['version'] !== 1) issues.push({ path: '$.version', message: 'must be the number 1' });
  const list = raw['criteria'];
  const criteria: IntentCriterion[] = [];
  if (!Array.isArray(list)) issues.push({ path: '$.criteria', message: 'must be an array' });
  else if (list.length === 0) issues.push({ path: '$.criteria', message: 'must not be empty' });
  else if (list.length > MAX_CRITERIA) issues.push({ path: '$.criteria', message: `at most ${MAX_CRITERIA} criteria` });
  else {
    list.forEach((item: unknown, index) => {
      const criterion = validateCriterion(item, `$.criteria[${index}]`, issues);
      if (criterion) criteria.push(criterion);
    });
  }
  if (issues.length > 0) throw new IntentContractError(issues);
  return { version: 1, criteria };
}

export function parseIntentContract(text: string): IntentContract {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new IntentContractError([{ path: '$', message: `invalid JSON: ${reason}` }]);
  }
  return validateIntentContract(raw);
}

// ---------------------------------------------------------------- evaluation

export interface IntentResult extends CheckResult {
  readonly kind: IntentKind;
  readonly index: number;
}

interface EvalContext {
  readonly model: PipelineModel;
  readonly remote: RemoteContext | undefined;
}

type Outcome = Pick<CheckResult, 'verdict' | 'basis' | 'message' | 'evidence'>;
type Evaluator<K extends IntentKind> = (
  criterion: Extract<IntentCriterion, { kind: K }>,
  ctx: EvalContext,
) => Outcome;

interface Located {
  readonly job: JobModel;
  readonly step: StepModel;
}

const staticOutcome = (verdict: Verdict, message: string, evidence: readonly EvidenceRef[] = []): Outcome => ({
  verdict,
  basis: 'static-inference',
  message,
  evidence,
});

const remoteOutcome = (verdict: Verdict, message: string, evidence: readonly EvidenceRef[] = []): Outcome => ({
  verdict,
  basis: 'remote-evidence',
  message,
  evidence,
});

/** Facts the static model cannot establish: INCONCLUSIVE, or BLOCKED when the connector is known to be down. */
function unprovable(remote: RemoteContext | undefined, what: string): Outcome {
  if (remote?.status === 'unavailable') {
    return staticOutcome('BLOCKED', `${what} Remote verification is blocked: ${redactSecrets(remote.reason)}`);
  }
  return staticOutcome('INCONCLUSIVE', `${what} Not provable from the workflow file alone; needs remote evidence.`);
}

const jobRef = (job: JobModel): EvidenceRef => ({ kind: 'job', ref: job.id });
const stepRef = ({ job, step }: Located): EvidenceRef => ({
  kind: 'workflow-line',
  ref: `${job.id}#${step.index} (line ${step.line})`,
});
const runRef = (run: RunEvidence): EvidenceRef => ({ kind: 'run', ref: String(run.runId) });

function locatedSteps(model: PipelineModel): Located[] {
  return model.jobs.flatMap((job) => job.steps.map((step) => ({ job, step })));
}

const CONSTANT_FALSE = /^\s*(?:\$\{\{\s*)?false(?:\s*\}\})?\s*$/i;
const isDisabled = (l: Located): boolean =>
  CONSTANT_FALSE.test(l.step.condition ?? 'x') || CONSTANT_FALSE.test(l.job.condition ?? 'x');
const isConditional = (l: Located): boolean => l.step.condition !== undefined || l.job.condition !== undefined;

/** Command lines of a step, ignoring comments and echo-only lines. */
function commandLines(step: StepModel): string[] {
  return (step.run ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !/^echo\b/.test(line));
}

const matchesCommand = (step: StepModel, pattern: RegExp): boolean =>
  commandLines(step).some((line) => pattern.test(line));
const matchesUses = (step: StepModel, pattern: RegExp): boolean => step.uses !== undefined && pattern.test(step.uses);

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?\b|\b(?:jest|vitest|mocha|phpunit|pytest|tox|nosetests|rspec)\b|\bplaywright\s+test\b|\bgo\s+test\b|\b(?:mvnw?|\.\/mvnw)\s+[^\n]*\b(?:test|verify)\b|\bgradlew?\s+[^\n]*\btest\b|\bdotnet\s+test\b|\bcargo\s+test\b|\bmake\s+test\b|\bnode\s+--test\b/;
const SCAN_COMMAND = /\b(?:npm\s+audit|pip-audit|trivy|semgrep|gitleaks|snyk\s+test|trufflehog|bandit|osv-scanner)\b/;
const SCAN_ACTION =
  /^(?:github\/codeql-action\/(?:init|analyze)|aquasecurity\/trivy-action|snyk\/actions|returntocorp\/semgrep-action|semgrep\/|ossf\/scorecard-action|actions\/dependency-review-action|gitleaks\/gitleaks-action|trufflesecurity\/trufflehog|anchore\/)/;
const PUBLISH_COMMAND =
  /\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b|\bmvnw?\s+[^\n]*\bdeploy\b|\b(?:vsce|ovsx)\s+publish\b|\bgem\s+push\b|\bnuget\s+push\b/;
const PUBLISH_ACTION =
  /^(?:pypa\/gh-action-pypi-publish|softprops\/action-gh-release|actions\/deploy-pages|JS-DevTools\/npm-publish)/;
const UPLOAD_ARTIFACT = /^actions\/(?:upload-artifact|upload-pages-artifact)\b/;
const COVERAGE_RUN = /--coverage\b|--cov\b|\bcoverage\s+run\b|\bnyc\b|\bc8\b|\bjacoco\b|-coverprofile/;
const COVERAGE_THRESHOLDS: readonly RegExp[] = [
  /--cov-fail-under[=\s]+(\d+(?:\.\d+)?)/g,
  /--fail-under[=\s]+(\d+(?:\.\d+)?)/g,
  /--check-coverage[^\n]*?--(?:lines|statements|branches|functions)[=\s]+(\d+(?:\.\d+)?)/g,
];
const SECRET_INTERPOLATION = /\$\{\{\s*secrets\.[^}]*\}\}/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const evaluators: { readonly [K in IntentKind]: Evaluator<K> } = {
  'run-tests': (_c, { model }) => {
    const all = locatedSteps(model).filter((l) => !isDisabled(l));
    const hits = all.filter((l) => matchesCommand(l.step, TEST_COMMAND));
    if (hits.length === 0) {
      return model.jobs.some((j) => j.uses !== undefined)
        ? staticOutcome('INCONCLUSIVE', 'No test command visible; a reusable workflow may run tests.')
        : staticOutcome('FAIL', 'No recognized test command in any enabled step.');
    }
    const evidence = hits.map(stepRef);
    return hits.every(isConditional)
      ? staticOutcome('WARN', 'Test steps are configured but all are conditional; configuration only, nothing was executed.', evidence)
      : staticOutcome('PASS', 'A test step is configured unconditionally. This proves configuration, not that tests ran or passed.', evidence);
  },

  'block-merge-on-build-failure': (_c, { model, remote }) => {
    const triggersPr = model.triggers.some((t) => t.event === 'pull_request' || t.event === 'pull_request_target');
    if (!triggersPr) {
      return staticOutcome('FAIL', 'The workflow does not run on pull requests, so it cannot gate merges.');
    }
    return unprovable(remote, 'The workflow runs on pull requests, but branch protection (required status checks) is repository configuration.');
  },

  'produce-artifacts': (_c, { model }) => {
    const hits = locatedSteps(model).filter((l) => !isDisabled(l) && matchesUses(l.step, UPLOAD_ARTIFACT));
    if (hits.length === 0) return staticOutcome('FAIL', 'No artifact upload step found.');
    return hits.every(isConditional)
      ? staticOutcome('WARN', 'Artifact upload exists but is always conditional.', hits.map(stepRef))
      : staticOutcome('PASS', 'An artifact upload step is configured. Existence of the artifact needs a run.', hits.map(stepRef));
  },

  'publish-only-from-branch': ({ branch }, { model }) => {
    const publishers = locatedSteps(model).filter(
      (l) => !isDisabled(l) && (matchesCommand(l.step, PUBLISH_COMMAND) || matchesUses(l.step, PUBLISH_ACTION)),
    );
    if (publishers.length === 0) return staticOutcome('SKIP', 'No publishing step detected.');
    const branchOnly =
      model.triggers.length > 0 &&
      model.triggers.every(
        (t) => t.event === 'push' && t.branches?.length === 1 && t.branches[0] === branch && !t.tags?.length,
      );
    const guard = [
      new RegExp(`github\\.ref\\s*==\\s*['"]refs/heads/${escapeRegExp(branch)}['"]`),
      new RegExp(`github\\.ref_name\\s*==\\s*['"]${escapeRegExp(branch)}['"]`),
    ];
    const classify = (l: Located): 'restricted' | 'unrestricted' | 'unclear' => {
      if (branchOnly) return 'restricted';
      const guarded = [l.job.condition, l.step.condition]
        .filter((c): c is string => c !== undefined)
        .filter((c) => guard.some((g) => g.test(c)));
      if (guarded.length === 0) return 'unrestricted';
      return guarded.some((c) => !/\|\||!=|!\s*\(/.test(c)) ? 'restricted' : 'unclear';
    };
    const states = publishers.map((l) => ({ l, state: classify(l) }));
    const bad = states.filter((s) => s.state === 'unrestricted').map((s) => stepRef(s.l));
    if (bad.length > 0) return staticOutcome('FAIL', `Publishing step is not restricted to branch "${branch}".`, bad);
    const unclear = states.filter((s) => s.state === 'unclear').map((s) => stepRef(s.l));
    if (unclear.length > 0) return staticOutcome('INCONCLUSIVE', 'Branch condition is too complex to prove.', unclear);
    return staticOutcome('PASS', `Every publishing step is restricted to branch "${branch}".`, publishers.map(stepRef));
  },

  'deploy-requires-approval': ({ environment }, { model, remote }) => {
    const jobs = model.jobs.filter((j) => j.environment === environment);
    if (jobs.length === 0) return staticOutcome('FAIL', `No job targets environment "${environment}".`);
    return {
      ...unprovable(remote, `Job targets environment "${environment}", but required reviewers are repository settings.`),
      evidence: jobs.map(jobRef),
    };
  },

  'min-coverage': ({ percent }, { model }) => {
    const steps = locatedSteps(model).filter((l) => !isDisabled(l));
    const thresholds = steps.flatMap((l) =>
      COVERAGE_THRESHOLDS.flatMap((re) =>
        commandLines(l.step).flatMap((line) => [...line.matchAll(re)].map((m) => ({ l, value: Number(m[1]) }))),
      ),
    );
    if (thresholds.length > 0) {
      const best = Math.max(...thresholds.map((t) => t.value));
      const evidence = thresholds.map((t) => stepRef(t.l));
      return best >= percent
        ? staticOutcome('PASS', `A coverage threshold of ${best}% is enforced (required ${percent}%).`, evidence)
        : staticOutcome('FAIL', `Highest enforced coverage threshold is ${best}%, below the required ${percent}%.`, evidence);
    }
    const measured = steps.filter((l) => matchesCommand(l.step, COVERAGE_RUN));
    return measured.length > 0
      ? staticOutcome('WARN', 'Coverage is measured but no threshold is enforced in the workflow.', measured.map(stepRef))
      : staticOutcome('INCONCLUSIVE', 'No coverage threshold visible; it may live in tool configuration.');
  },

  'security-scan-present': (_c, { model }) => {
    const hits = locatedSteps(model).filter(
      (l) => !isDisabled(l) && (matchesCommand(l.step, SCAN_COMMAND) || matchesUses(l.step, SCAN_ACTION)),
    );
    if (hits.length === 0) return staticOutcome('FAIL', 'No security scanning step found.');
    return hits.every(isConditional)
      ? staticOutcome('WARN', 'Security scan exists but is always conditional.', hits.map(stepRef))
      : staticOutcome('PASS', 'A security scan is configured. Its findings need a run.', hits.map(stepRef));
  },

  'no-secret-exposure': (_c, { model }) => {
    const offenders = locatedSteps(model).filter((l) => {
      const run = l.step.run ?? '';
      return SECRET_INTERPOLATION.test(run) || redactSecrets(run) !== run;
    });
    if (offenders.length > 0) {
      return staticOutcome('FAIL', 'Secrets are interpolated into or hard-coded in a shell script.', offenders.map(stepRef));
    }
    return staticOutcome('INCONCLUSIVE', 'No static exposure indicators found; absence of runtime leaks cannot be proven statically.');
  },

  'deploy-confirmed': ({ job, branch }, { remote }) => {
    if (remote === undefined) {
      return staticOutcome('INCONCLUSIVE', 'Deployment outcome requires remote evidence, which was not requested.');
    }
    if (remote.status === 'unavailable') {
      return staticOutcome('BLOCKED', `Remote evidence unavailable: ${redactSecrets(remote.reason)}`);
    }
    const latest = [...remote.runs]
      .filter((r) => branch === undefined || r.branch === branch)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (latest === undefined) return remoteOutcome('INCONCLUSIVE', 'No matching run observed.');
    const observed = latest.jobs.find((j) => j.name === job || j.name.startsWith(`${job} (`));
    if (observed === undefined) return remoteOutcome('INCONCLUSIVE', `Job "${job}" not observed in the latest run.`, [runRef(latest)]);
    const evidence: EvidenceRef[] = [runRef(latest), { kind: 'job', ref: String(observed.id) }];
    if (observed.status !== 'completed') return remoteOutcome('INCONCLUSIVE', `Job "${job}" has not completed.`, evidence);
    switch (observed.conclusion) {
      case 'success':
        return remoteOutcome('PASS', `Job "${job}" succeeded in run ${latest.runId}.`, evidence);
      case 'skipped':
        return remoteOutcome('SKIP', `Job "${job}" was skipped; deployment is not confirmed.`, evidence);
      case 'failure':
      case 'timed_out':
      case 'cancelled':
      case 'startup_failure':
      case 'action_required':
        return remoteOutcome('FAIL', `Job "${job}" concluded ${observed.conclusion}.`, evidence);
      default:
        return remoteOutcome('INCONCLUSIVE', `Job "${job}" has an unrecognized conclusion.`, evidence);
    }
  },
};

function evaluateCriterion(criterion: IntentCriterion, ctx: EvalContext): Outcome {
  // The mapped evaluator type is keyed by kind; the lookup is correlated by construction.
  const evaluator = evaluators[criterion.kind] as Evaluator<typeof criterion.kind>;
  return evaluator(criterion, ctx);
}

export function evaluateIntent(
  contract: IntentContract,
  model: PipelineModel,
  remote?: RemoteContext,
): readonly IntentResult[] {
  return contract.criteria.map((criterion, index) => ({
    id: `${index}:${criterion.kind}`,
    kind: criterion.kind,
    index,
    ...evaluateCriterion(criterion, { model, remote }),
  }));
}
