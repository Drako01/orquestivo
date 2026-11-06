const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeWorkflow } = require('../dist/analyzer.cjs');
const pinned = 'a'.repeat(40);
const valid = `name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${pinned}
      - run: npm test
`;
const codes = source => analyzeWorkflow(source).findings.map(item => item.code);

test('accepts a simple pinned workflow as static-only', () => {
  const result=analyzeWorkflow(valid);
  assert.equal(result.syntaxValid,true);
  assert.equal(result.executionVerified,false);
  assert.deepEqual(result.findings,[]);
});
test('reports malformed YAML', () => {
  const result=analyzeWorkflow('name: [oops\njobs: {}');
  assert.equal(result.syntaxValid,false);
  assert.ok(result.findings.some(f=>f.code==='YAML_INVALID' && f.line>=1));
});
test('missing event and jobs are errors', () => {
  assert.ok(codes('name: CI').includes('EVENT_MISSING'));
  assert.ok(codes('name: CI\non: push').includes('JOBS_MISSING'));
});
test('reports unknown dependency', () => {
  assert.ok(codes('on: push\njobs:\n  verify:\n    needs: unknown\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok').includes('NEEDS_UNKNOWN'));
});
test('reports a dependency cycle', () => {
  const s='on: push\njobs:\n  a:\n    needs: b\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo b';
  assert.ok(codes(s).includes('NEEDS_CYCLE'));
});
test('warns on unpinned actions',()=>assert.ok(codes(valid.replace(pinned,'v4')).includes('ACTION_NOT_PINNED')));
test('warns on broad permissions',()=>assert.ok(codes(valid+'permissions: write-all\n').includes('PERMISSIONS_WRITE_ALL')));
test('warns on privileged PR trigger',()=>assert.ok(codes('on:\n  pull_request_target:\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok').includes('PR_TARGET_REVIEW')));
test('detects missing step command',()=>assert.ok(codes('on: push\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Nothing').includes('STEP_ACTION_MISSING')));
test('never fabricates runtime proof',()=>{
  const result=analyzeWorkflow(valid);
  assert.equal(result.executionVerified,false);
  assert.ok(result.findings.every(f=>f.evidence==='static'));
});
