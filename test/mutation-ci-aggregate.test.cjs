const { test } = require('node:test');
const assert = require('node:assert/strict');
const WRITE_PLAN = 'src/core/generation/write-plan.ts';
const modulePromise = import('../scripts/mutation/aggregate-ci.mjs');
const config = { maxMutantsPerTarget: 40, targets: [
  { source: 'src/security/redact.ts', minScore: 90 },
  { source: WRITE_PLAN, minScore: 90 },
] };
function fixture() {
  const shards = new Map();
  shards.set('mutation-rest', { results: [{ source: 'src/security/redact.ts',
    status: 'PASS', totalSites: 3, sampledTotal: 3, sliceIndex: 0, sliceCount: 1,
    minScore: 90, tried: 3, killed: 3, survived: 0, invalid: 0 }] });
  for (let i = 0; i < 4; i++) shards.set('mutation-write-plan-' + i, { results: [{
    source: WRITE_PLAN, status: 'PASS', totalSites: 40, sampledTotal: 40,
    sliceIndex: i, sliceCount: 4, minScore: 90,
    tried: 10, killed: 9, survived: 1, invalid: 0 }] });
  return shards;
}
test('mutation CI aggregator preserves source target floors and 40-sample total', async () => {
  const { aggregateMutationReports } = await modulePromise;
  const report = aggregateMutationReports(config, fixture());
  assert.equal(report.status, 'PASS');
  assert.equal(report.results.length, 2);
  assert.equal(report.results[1].tried, 40);
  assert.equal(report.results[1].score, 90);
});
test('mutation CI aggregator rejects missing, repeated or incomplete shards', async () => {
  const { aggregateMutationReports } = await modulePromise;
  let shards = fixture();
  shards.delete('mutation-write-plan-3');
  assert.throws(() => aggregateMutationReports(config, shards));
  shards = fixture();
  shards.get('mutation-write-plan-0').results[0].tried = 9;
  assert.throws(() => aggregateMutationReports(config, shards));
  shards = fixture();
  shards.get('mutation-write-plan-1').results[0].sliceIndex = 0;
  assert.throws(() => aggregateMutationReports(config, shards));
});
test('mutation CI aggregator does not allow per-shard passes to mask failed global score', async () => {
  const { aggregateMutationReports } = await modulePromise;
  const shards = fixture();
  const slice = shards.get('mutation-write-plan-2').results[0];
  slice.killed = 8; slice.survived = 2;
  const report = aggregateMutationReports(config, shards);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.results[1].score, 87.5);
});
