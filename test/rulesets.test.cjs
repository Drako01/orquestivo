const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const read = (file) => JSON.parse(
  readFileSync(resolve(root,'.github/rulesets/'+file+'.json'),'utf8'),
);
const main = read('protect-main');
const tags = read('protect-release-tags');

test('main ruleset inherits Probato PR safeguards', () => {
  assert.equal(main.enforcement,'active');
  assert.deepEqual(main.conditions.ref_name.include,['~DEFAULT_BRANCH']);
  assert.deepEqual(main.rules.map((x) => x.type), [
    'deletion','non_fast_forward','required_linear_history','pull_request','required_status_checks',
  ]);
  assert.deepEqual(main.bypass_actors,[
    {actor_id:5,actor_type:'RepositoryRole',bypass_mode:'pull_request'},
  ]);
  const review = main.rules.find((x) => x.type === 'pull_request').parameters;
  assert.equal(review.required_approving_review_count,1);
  assert.equal(review.require_code_owner_review,true);
  assert.equal(review.require_last_push_approval,true);
  assert.equal(review.dismiss_stale_reviews_on_push,true);
  assert.equal(review.required_review_thread_resolution,true);
  assert.deepEqual(review.allowed_merge_methods,['squash']);
  const checks = main.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks,[
    {context:'Verify (ubuntu-latest)',integration_id:15368},
    {context:'Verify (windows-latest)',integration_id:15368},
    {context:'Verify (macos-latest)',integration_id:15368},
  ]);
});

test('release tags ruleset matches both reference repositories', () => {
  assert.equal(tags.target,'tag');
  assert.deepEqual(tags.conditions.ref_name.include,['refs/tags/v*']);
  assert.deepEqual(tags.rules.map((x) => x.type),['update','deletion','non_fast_forward']);
  assert.deepEqual(tags.bypass_actors,[
    {actor_id:5,actor_type:'RepositoryRole',bypass_mode:'always'},
  ]);
});

test('offline policy validation does not need credentials or make remote changes', () => {
  const out = execFileSync(process.execPath,['scripts/rulesets.mjs','--check'],{
    cwd:root,encoding:'utf8',
  });
  assert.match(out,/Ruleset definitions validated/);
});
