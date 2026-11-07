import { actionName, withInputs } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const ARTIFACT_RETENTION_UNSET = meta('ARTIFACT_RETENTION_UNSET', 'information', 'maintainability',
  'Artifacts default to the repository retention (up to 90 days), which inflates storage costs.',
  'Set retention-days to the shortest period you need.', DOCS.artifacts);
const ARTIFACT_NAME_UNSET = meta('ARTIFACT_NAME_UNSET', 'information', 'reliability',
  'Unnamed uploads share the default name, which collides across matrix legs and repeated uploads.',
  'Set an explicit, unique name on every upload.', DOCS.artifacts);
const ARTIFACT_DOWNLOAD_ORPHAN = meta('ARTIFACT_DOWNLOAD_ORPHAN', 'warning', 'reliability',
  'Downloading an artifact that no upstream job uploads fails at runtime.',
  'Upload the artifact in a job this one needs (directly or transitively), or pass run-id for a cross-run download.', DOCS.artifacts);

const isAction = (name: string | undefined, target: string): boolean => name === 'actions/' + target;

export const artifactsRule: Rule = {
  id: 'artifacts',
  metas: [ARTIFACT_RETENTION_UNSET, ARTIFACT_NAME_UNSET, ARTIFACT_DOWNLOAD_ORPHAN],
  check(ctx) {
    const uploadingJobs = new Set<string>();
    for (const { job, step, path } of ctx.steps) {
      if (!isAction(actionName(step), 'upload-artifact')) continue;
      uploadingJobs.add(job.id);
      const inputs = withInputs(step);
      if (inputs.name === undefined) ctx.report(ARTIFACT_NAME_UNSET, 'upload-artifact has no explicit name.', [...path, 'uses']);
      if (inputs['retention-days'] === undefined) {
        ctx.report(ARTIFACT_RETENTION_UNSET, 'upload-artifact has no retention-days.', [...path, 'uses']);
      }
    }
    const needsOf = new Map(ctx.jobs.map((j) => [j.id, j.needs]));
    const upstream = (start: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [...(needsOf.get(start) ?? [])];
      for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...(needsOf.get(id) ?? []));
      }
      return seen;
    };
    for (const { job, step, path } of ctx.steps) {
      if (!isAction(actionName(step), 'download-artifact')) continue;
      const inputs = withInputs(step);
      if (inputs['run-id'] !== undefined || inputs['github-token'] !== undefined) continue;
      if (![...upstream(job.id)].some((id) => uploadingJobs.has(id))) {
        ctx.report(ARTIFACT_DOWNLOAD_ORPHAN, 'download-artifact in "' + job.id + '" has no upstream upload-artifact job.', [...path, 'uses']);
      }
    }
  },
};
