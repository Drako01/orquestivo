import { layerNodes } from '../../analysis/topology.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { neededJobRefs } from '../expressions.js';
import { meta } from '../rule.js';

const NEEDS_INVALID = meta('NEEDS_INVALID', 'error', 'semantic',
  'needs must be a job id or a non-empty list of job ids.', 'Use needs: job-id or needs: [job-a, job-b].', DOCS.needs);
const NEEDS_SELF = meta('NEEDS_SELF', 'error', 'semantic',
  'A job that needs itself can never start.', 'Remove the self reference from needs.', DOCS.needs);
const NEEDS_UNKNOWN = meta('NEEDS_UNKNOWN', 'error', 'semantic',
  'GitHub rejects workflows whose needs point at jobs that do not exist.', 'Fix the job id or define the missing job.', DOCS.needs);
const NEEDS_CYCLE = meta('NEEDS_CYCLE', 'error', 'semantic',
  'Circular dependencies make the workflow invalid; no job in the cycle can start.', 'Break the cycle by removing one needs edge.', DOCS.needs);
const NEEDS_CONTEXT_UNDECLARED = meta('NEEDS_CONTEXT_UNDECLARED', 'error', 'semantic',
  'The needs context only exposes jobs listed in needs; other references evaluate to empty.',
  'Add the referenced job to needs, or stop reading its outputs.', DOCS.contexts);

export const needsRule: Rule = {
  id: 'needs',
  metas: [NEEDS_INVALID, NEEDS_SELF, NEEDS_UNKNOWN, NEEDS_CYCLE, NEEDS_CONTEXT_UNDECLARED],
  check(ctx) {
    const graph = new Map<string, readonly string[]>();
    for (const { id, job, path, needs } of ctx.jobs) {
      graph.set(id, needs);
      if (job.needs !== undefined && needs.length === 0) {
        ctx.report(NEEDS_INVALID, 'Job "' + id + '" has invalid or empty needs.', [...path, 'needs']);
      }
      for (const name of needs) {
        if (name === id) ctx.report(NEEDS_SELF, 'Job "' + id + '" cannot depend on itself.', [...path, 'needs']);
        else if (!ctx.jobsRaw || !Object.hasOwn(ctx.jobsRaw, name)) {
          ctx.report(NEEDS_UNKNOWN, 'Job "' + id + '" requires unknown job "' + name + '".', [...path, 'needs']);
        }
      }
    }
    if (layerNodes(graph).cyclic.size > 0) ctx.report(NEEDS_CYCLE, 'Job dependency graph contains a cycle.', ['jobs']);

    const byId = new Map(ctx.jobs.map((j) => [j.id, j]));
    for (const site of ctx.sites) {
      const owner = site.jobId === undefined ? undefined : byId.get(site.jobId);
      if (!owner) continue;
      for (const ref of site.exprs.flatMap(neededJobRefs)) {
        if (!owner.needs.includes(ref)) {
          ctx.report(NEEDS_CONTEXT_UNDECLARED,
            'Job "' + owner.id + '" reads needs.' + ref + ' but does not list "' + ref + '" in needs.', site.path);
        }
      }
    }
  },
};
