import { actionName, asMap, withInputs } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

/** Webhook events accepted under `on:` (GitHub docs: events that trigger workflows). */
export const KNOWN_EVENTS: ReadonlySet<string> = new Set([
  'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status',
  'discussion', 'discussion_comment', 'fork', 'gollum', 'issue_comment', 'issues', 'label', 'merge_group',
  'milestone', 'page_build', 'public', 'pull_request', 'pull_request_review', 'pull_request_review_comment',
  'pull_request_target', 'push', 'registry_package', 'release', 'repository_dispatch', 'schedule', 'status',
  'watch', 'workflow_call', 'workflow_dispatch', 'workflow_run',
]);

const EVENT_UNKNOWN = meta('EVENT_UNKNOWN', 'error', 'semantic',
  'An unknown event name never fires, so the workflow silently does nothing.',
  'Use an event from the GitHub documentation (check spelling and underscores).', DOCS.events);
const BRANCHES_CONFLICT = meta('BRANCHES_CONFLICT', 'error', 'semantic',
  'branches and branches-ignore cannot be combined for the same event; GitHub rejects the file.',
  'Keep only branches, using negated patterns (!pattern) to exclude.', DOCS.branchFilters);
const TAGS_CONFLICT = meta('TAGS_CONFLICT', 'error', 'semantic',
  'tags and tags-ignore cannot be combined for the same event; GitHub rejects the file.',
  'Keep only tags, using negated patterns (!pattern) to exclude.', DOCS.branchFilters);
const PATHS_CONFLICT = meta('PATHS_CONFLICT', 'error', 'semantic',
  'paths and paths-ignore cannot be combined for the same event; GitHub rejects the file.',
  'Keep only paths, using negated patterns (!pattern) to exclude.', DOCS.pathFilters);
const CRON_INVALID = meta('CRON_INVALID', 'error', 'semantic',
  'An invalid cron expression makes the scheduled trigger fail or never run.',
  'Use five POSIX cron fields (minute hour day-of-month month day-of-week) within valid ranges.', DOCS.schedule);
const PR_TARGET_REVIEW = meta('PR_TARGET_REVIEW', 'warning', 'security',
  'pull_request_target runs with a write token and secrets in the context of the base branch.',
  'Prefer pull_request; if required, never check out or execute untrusted pull-request code.', DOCS.hardening);
const PR_TARGET_CHECKOUT_REVIEW = meta('PR_TARGET_CHECKOUT_REVIEW', 'warning', 'security',
  'Checking out an explicit ref under pull_request_target can execute attacker-controlled code with secrets.',
  'Do not check out the pull-request head here, or isolate it in an unprivileged workflow_run job.', DOCS.hardening);
const SELF_HOSTED_PR_TARGET = meta('SELF_HOSTED_PR_TARGET', 'error', 'security',
  'A privileged trigger on a self-hosted runner lets pull-request code persist on your infrastructure.',
  'Use GitHub-hosted ephemeral runners for pull_request_target workflows.', DOCS.selfHosted);

interface FieldRange { readonly min: number; readonly max: number; readonly names?: readonly string[] }
const CRON_FIELDS: readonly FieldRange[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
  { min: 0, max: 6, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
];

function cronValue(token: string, field: FieldRange): number | undefined {
  const named = field.names?.indexOf(token.toUpperCase()) ?? -1;
  if (named >= 0) return named + field.min;
  if (!/^\d{1,2}$/.test(token)) return undefined;
  const value = Number(token);
  return value >= field.min && value <= field.max ? value : undefined;
}

function cronItemValid(item: string, field: FieldRange): boolean {
  const [range = '', step, extra] = item.split('/');
  if (extra !== undefined) return false;
  if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
  if (range === '*') return true;
  const [from = '', to, more] = range.split('-');
  if (more !== undefined) return false;
  const start = cronValue(from, field);
  if (start === undefined) return false;
  if (to === undefined) return true;
  const end = cronValue(to, field);
  return end !== undefined && start <= end;
}

/** Validates a five-field POSIX cron expression as accepted by GitHub `schedule`. */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5 && parts.every((part, i) =>
    part.split(',').every((item) => cronItemValid(item, CRON_FIELDS[i] as FieldRange)));
}

const CONFLICTS = [
  ['branches', 'branches-ignore', BRANCHES_CONFLICT],
  ['tags', 'tags-ignore', TAGS_CONFLICT],
  ['paths', 'paths-ignore', PATHS_CONFLICT],
] as const;

export const triggersRule: Rule = {
  id: 'triggers',
  metas: [EVENT_UNKNOWN, BRANCHES_CONFLICT, TAGS_CONFLICT, PATHS_CONFLICT, CRON_INVALID,
    PR_TARGET_REVIEW, PR_TARGET_CHECKOUT_REVIEW, SELF_HOSTED_PR_TARGET],
  check(ctx) {
    for (const [event, config] of ctx.events) {
      if (!KNOWN_EVENTS.has(event)) {
        ctx.report(EVENT_UNKNOWN, 'Unknown event "' + event + '" under on:.', ['on', event]);
      }
      const options = asMap(config);
      for (const [a, b, rule] of CONFLICTS) {
        if (options && options[a] !== undefined && options[b] !== undefined) {
          ctx.report(rule, 'Event "' + event + '" cannot define both ' + a + ' and ' + b + '.', ['on', event, b]);
        }
      }
    }
    if (ctx.events.has('schedule')) {
      const entries = ctx.events.get('schedule');
      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) ctx.report(CRON_INVALID, 'schedule needs a list of cron entries.', ['on', 'schedule']);
      for (const [index, entry] of list.entries()) {
        const cron = asMap(entry)?.cron;
        if (typeof cron !== 'string' || !isValidCron(cron)) {
          ctx.report(CRON_INVALID, 'Invalid cron expression' + (typeof cron === 'string' ? ' "' + cron + '"' : '') + '.',
            ['on', 'schedule', index], typeof cron === 'string' ? { snippet: cron } : {});
        }
      }
    }
    if (!ctx.privileged) return;
    ctx.report(PR_TARGET_REVIEW,
      'pull_request_target is privileged; never execute untrusted pull-request code with elevated permissions.', ['on']);
    for (const { step, path } of ctx.steps) {
      if (actionName(step)?.endsWith('/checkout') && withInputs(step).ref !== undefined) {
        ctx.report(PR_TARGET_CHECKOUT_REVIEW,
          'Review explicit checkout ref in a privileged pull_request_target workflow.', path);
      }
    }
    for (const { id, job, path } of ctx.jobs) {
      const runsOn = JSON.stringify(job['runs-on'] ?? '');
      if (/\bself-hosted\b/i.test(runsOn)) {
        ctx.report(SELF_HOSTED_PR_TARGET,
          'Job "' + id + '" uses a self-hosted runner under pull_request_target.', [...path, 'runs-on']);
      }
    }
  },
};
