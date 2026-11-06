// Shared builders for evidence tests (kept here so no test copies model/run literals).
const step = (index, fields = {}) => ({ index, line: 10 + index, ...fields });
const job = (id, steps = [], fields = {}) => ({
  id, line: 5, needs: [], runsOn: ['ubuntu-latest'], steps: steps.map((s, i) => step(i, s)), ...fields,
});
const model = (jobs, fields = {}) => ({
  provider: 'github-actions',
  triggers: [{ event: 'push', branches: ['main'] }, { event: 'pull_request' }],
  hasConcurrency: false,
  jobs,
  ...fields,
});

const run = (runId, fields = {}) => ({
  runId, workflowName: 'CI', branch: 'main', event: 'push', status: 'completed', conclusion: 'success',
  headSha: 'a'.repeat(40), createdAt: new Date(2026, 0, runId).toISOString(), durationMs: 1000,
  htmlUrl: `https://github.com/o/r/actions/runs/${runId}`, logsUrl: `https://api.github.com/repos/o/r/actions/runs/${runId}/logs`,
  jobs: [], artifacts: [], ...fields,
});
const jobEv = (id, name, fields = {}) => ({
  id, name, status: 'completed', conclusion: 'success', durationMs: 1000, htmlUrl: null, steps: [], ...fields,
});
const stepEv = (number, name, durationMs, fields = {}) => ({
  number, name, status: 'completed', conclusion: 'success', durationMs, ...fields,
});

module.exports = { step, job, model, run, jobEv, stepEv };
