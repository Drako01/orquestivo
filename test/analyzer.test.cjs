const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeWorkflow } = require('../dist/analyzer.cjs');
const { generateCI } = require('../dist/generator.cjs');
const pin = 'a'.repeat(40);
const base = 'name: CI\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@' + pin + '\n      - run: npm test\n';
const codes = value => analyzeWorkflow(value).findings.map(f => f.code);
test('healthy static workflow never claims runtime proof',()=>{
  const result=analyzeWorkflow(base);
  assert.equal(result.syntaxValid,true);
  assert.equal(result.executionVerified,false);
  assert.deepEqual(result.findings,[]);
});
test('malformed YAML produces a line',()=>{
  const result=analyzeWorkflow('name: CI\njobs:\n  broken: [');
  assert.equal(result.syntaxValid,false);
  assert.ok(result.findings.some(f=>f.code==='YAML_INVALID'&&f.line>=1));
});
test('event and jobs required',()=>{
  assert.ok(codes('name: CI').includes('EVENT_MISSING'));
  assert.ok(codes('name: CI\non: push').includes('JOBS_MISSING'));
});
test('needs unknown, self and cycle',()=>{
  assert.ok(codes(base.replace('    runs-on:', '    needs: missing\n    runs-on:')).includes('NEEDS_UNKNOWN'));
  assert.ok(codes(base.replace('    runs-on:', '    needs: verify\n    runs-on:')).includes('NEEDS_SELF'));
  const graph=base.replace('  verify:\n','  verify:\n    needs: other\n')+
    '  other:\n    needs: verify\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n';
  assert.ok(codes(graph).includes('NEEDS_CYCLE'));
});
test('mutable actions get line-accurate warning',()=>{
  const hit=analyzeWorkflow(base.replace(pin,'v4')).findings.find(f=>f.code==='ACTION_NOT_PINNED');
  assert.ok(hit);
  assert.equal(hit.line,10);
});
test('broad permissions and privileged trigger',()=>{
  assert.ok(codes(base.replace('permissions:\n  contents: read','permissions: write-all')).includes('PERMISSIONS_WRITE_ALL'));
  assert.ok(codes(base.replace('on: [push, pull_request]','on:\n  pull_request_target:')).includes('PR_TARGET_REVIEW'));
});
test('bad timeout and malformed steps are errors',()=>{
  assert.ok(codes(base.replace('timeout-minutes: 10','timeout-minutes: -1')).includes('TIMEOUT_INVALID'));
  assert.ok(codes(base.replace('      - run: npm test','      - name: empty')).includes('STEP_ACTION_MISSING'));
  assert.ok(codes(base.replace('      - run: npm test','      - uses: actions/checkout@'+pin+'\n        run: npm test')).includes('STEP_RUN_AND_USES'));
});
test('reusable workflow calls need no runner',()=>{
  const value='on: workflow_dispatch\npermissions:\n  contents: read\njobs:\n  call:\n    uses: org/repo/.github/workflows/test.yml@'+pin+'\n';
  assert.deepEqual(analyzeWorkflow(value).findings,[]);
});
test('shell interpolation of untrusted event fields is flagged',()=>{
  const unsafe='run: echo ' + '$' + '{{ github.event.pull_request.title }}';
  assert.ok(codes(base.replace('run: npm test',unsafe)).includes('EXPRESSION_IN_SCRIPT'));
});
for(const preset of ['node','go','python','maven']) {
  test('generated '+preset+' workflow has zero static findings',()=>{
    const value=generateCI({preset,trigger:'push-and-pr'});
    const result=analyzeWorkflow(value);
    assert.equal(result.syntaxValid,true);
    assert.equal(result.executionVerified,false);
    assert.deepEqual(result.findings,[]);
    assert.ok(value.includes('permissions:\n  contents: read'));
    assert.ok(value.includes('timeout-minutes: 20'));
  });
}
test('PR-only generator does not include push',()=>{
  const value=generateCI({preset:'node',trigger:'pr-only'});
  assert.ok(value.includes('on: [pull_request]'));
  assert.ok(!value.includes('on: [push,'));
});
