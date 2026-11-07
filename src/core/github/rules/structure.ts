import { asString } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const EVENT_MISSING = meta('EVENT_MISSING', 'error', 'semantic',
  'Without an event the workflow never runs.', 'Add at least one trigger under on:, for example push or pull_request.', DOCS.events);
const JOBS_MISSING = meta('JOBS_MISSING', 'error', 'semantic',
  'A workflow without jobs has nothing to run.', 'Define at least one job under jobs:.', DOCS.syntax);
const JOB_INVALID = meta('JOB_INVALID', 'error', 'syntax',
  'GitHub rejects jobs that are not mappings.', 'Make the job a mapping with runs-on and steps.', DOCS.syntax);
const RUNNER_MISSING = meta('RUNNER_MISSING', 'error', 'semantic',
  'A job without runs-on cannot be scheduled.', 'Add runs-on, for example ubuntu-latest.', DOCS.syntax);
const STEPS_MISSING = meta('STEPS_MISSING', 'error', 'semantic',
  'A job needs at least one step to do any work.', 'Add a non-empty steps list.', DOCS.syntax);
const REUSABLE_JOB_CONFLICT = meta('REUSABLE_JOB_CONFLICT', 'error', 'semantic',
  'A job that calls a reusable workflow cannot also declare its own runner or steps.',
  'Remove runs-on and steps from the calling job.', DOCS.reusable);
const STEP_INVALID = meta('STEP_INVALID', 'error', 'syntax',
  'GitHub rejects steps that are not mappings.', 'Make each step a mapping with run or uses.', DOCS.syntax);
const STEP_ACTION_MISSING = meta('STEP_ACTION_MISSING', 'error', 'semantic',
  'A step with neither run nor uses does nothing and is rejected by GitHub.', 'Add run: or uses: to the step.', DOCS.syntax);
const STEP_RUN_AND_USES = meta('STEP_RUN_AND_USES', 'error', 'semantic',
  'A step cannot both run a script and use an action.', 'Split the step into two steps.', DOCS.syntax);

export const structureRule: Rule = {
  id: 'structure',
  metas: [EVENT_MISSING, JOBS_MISSING, JOB_INVALID, RUNNER_MISSING, STEPS_MISSING,
    REUSABLE_JOB_CONFLICT, STEP_INVALID, STEP_ACTION_MISSING, STEP_RUN_AND_USES],
  check(ctx) {
    if (ctx.events.size === 0) ctx.report(EVENT_MISSING, 'Define at least one event under on:.', ['on']);
    if (!ctx.jobsRaw || Object.keys(ctx.jobsRaw).length === 0) {
      ctx.report(JOBS_MISSING, 'Define at least one job under jobs:.', ['jobs']);
      return;
    }
    const valid = new Set(ctx.jobs.map((j) => j.id));
    for (const id of Object.keys(ctx.jobsRaw)) {
      if (!valid.has(id)) ctx.report(JOB_INVALID, 'Job "' + id + '" must be a mapping.', ['jobs', id]);
    }
    for (const { id, job, path, reusable, rawSteps } of ctx.jobs) {
      if (reusable) {
        if (job.steps !== undefined || job['runs-on'] !== undefined) {
          ctx.report(REUSABLE_JOB_CONFLICT, 'Reusable job "' + id + '" must not declare runs-on or steps.', path);
        }
      } else {
        if (job['runs-on'] === undefined) ctx.report(RUNNER_MISSING, 'Job "' + id + '" has no runs-on runner.', path);
        if (!rawSteps || rawSteps.length === 0) {
          ctx.report(STEPS_MISSING, 'Job "' + id + '" needs a non-empty steps list.', [...path, 'steps']);
        }
      }
      for (const [index, raw] of (rawSteps ?? []).entries()) {
        const where = [...path, 'steps', index];
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          ctx.report(STEP_INVALID, 'Step ' + (index + 1) + ' of "' + id + '" is not a mapping.', where);
          continue;
        }
        const step = raw as Record<string, unknown>;
        const hasRun = (asString(step.run)?.trim() ?? '') !== '';
        const hasUses = (asString(step.uses)?.trim() ?? '') !== '';
        const background = step.wait !== undefined || step['wait-all'] !== undefined || step.cancel !== undefined;
        if (!hasRun && !hasUses && !background) {
          ctx.report(STEP_ACTION_MISSING, 'Step ' + (index + 1) + ' of "' + id + '" has no run or uses.', where);
        }
        if (hasRun && hasUses) ctx.report(STEP_RUN_AND_USES, 'A step cannot combine run and uses.', where);
      }
    }
  },
};
