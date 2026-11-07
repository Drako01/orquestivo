const { dist, ruleTable, hostileTests, fixtureTests, codesOf, test, assert } = require('./helpers.cjs');
const { gitlabCiProvider: gl } = dist('gitlab-ci/provider.js');

const ok = 'build:\n  script: [echo]\n';
const sha = 'a'.repeat(64);

test('gitlab-ci: matches only .gitlab-ci.yml files', () => {
  assert.ok(gl.matches('.gitlab-ci.yml') && gl.matches('svc/.gitlab-ci.yaml') && gl.matches('a\\.gitlab-ci.yml'));
  assert.ok(!gl.matches('gitlab-ci.yml') && !gl.matches('.gitlab-ci.yml.bak') && !gl.matches('ci/x.yml'));
});

ruleTable(gl, [
  ['GITLAB_NO_JOBS', 'variables:\n  A: b\n', ok],
  ['GITLAB_NO_JOBS', '.hidden:\n  script: [x]\n', 'include: local.yml\n'],
  ['GITLAB_JOB_NO_SCRIPT', 'a:\n  stage: test\n', ok],
  ['GITLAB_JOB_NO_SCRIPT', 'a:\n  image: node:22\n', 'a:\n  trigger: group/p\n'],
  ['GITLAB_JOB_NO_SCRIPT', 'a:\n  stage: test\n', '.t:\n  image: node:22\n'],
  ['GITLAB_JOB_NO_SCRIPT', 'a:\n  extends: .t\n.t:\n  image: x:1\n', 'a:\n  extends: .t\n.t:\n  script: [x]\n'],
  ['GITLAB_STAGE_UNDEFINED', 'stages: [build]\na:\n  stage: deploy\n  script: [x]\n', 'stages: [build]\na:\n  stage: build\n  script: [x]\n'],
  ['GITLAB_STAGE_UNDEFINED', 'a:\n  stage: ship\n  script: [x]\n', 'a:\n  stage: .pre\n  script: [x]\n'],
  ['GITLAB_STAGE_UNUSED', 'stages: [build, test]\na:\n  stage: build\n  script: [x]\n', 'stages: [build]\na:\n  stage: build\n  script: [x]\n'],
  ['GITLAB_NEEDS_UNKNOWN', 'a:\n  needs: [ghost]\n  script: [x]\n', 'a:\n  needs: [b]\n  script: [x]\nb:\n  script: [x]\n'],
  ['GITLAB_NEEDS_UNKNOWN', 'a:\n  needs:\n    - job: ghost\n  script: [x]\n', 'a:\n  needs:\n    - job: ghost\n      optional: true\n  script: [x]\n'],
  ['GITLAB_NEEDS_UNKNOWN', 'a:\n  needs: [.t]\n  script: [x]\n.t:\n  script: [x]\n', 'a:\n  needs:\n    - project: g/p\n      job: j\n      ref: main\n  script: [x]\n'],
  ['GITLAB_NEEDS_CYCLE', 'a:\n  needs: [b]\n  script: [x]\nb:\n  needs: [a]\n  script: [x]\n', 'a:\n  script: [x]\nb:\n  needs: [a]\n  script: [x]\n'],
  ['GITLAB_NEEDS_CYCLE', 'a:\n  needs: [a]\n  script: [x]\n', ok],
  ['GITLAB_NEEDS_CYCLE', 'a:\n  needs: [b]\n  script: x\nb:\n  needs: [c]\n  script: x\nc:\n  needs: [a]\n  script: x\n', 'a:\n  needs: [b]\n  script: x\nb:\n  needs: [c]\n  script: x\nc:\n  script: x\n'],
  ['GITLAB_NEEDS_LATER_STAGE', 'stages: [build, test]\na:\n  stage: build\n  needs: [b]\n  script: x\nb:\n  stage: test\n  script: x\n', 'stages: [build, test]\na:\n  stage: test\n  needs: [b]\n  script: x\nb:\n  stage: build\n  script: x\n'],
  ['GITLAB_EXTENDS_UNKNOWN', 'a:\n  extends: .ghost\n  script: x\n', 'a:\n  extends: .t\n  script: x\n.t:\n  image: x:1\n'],
  ['GITLAB_EXTENDS_CYCLE', '.a:\n  extends: .b\n.b:\n  extends: .a\nj:\n  extends: .a\n  script: x\n', '.a:\n  extends: .b\n.b:\n  image: x:1\nj:\n  extends: .a\n  script: x\n'],
  ['GITLAB_EXTENDS_CYCLE', 'j:\n  extends: j\n  script: x\n', ok],
  ['GITLAB_TRIGGER_WITH_SCRIPT', 'a:\n  trigger: g/p\n  script: x\n', 'a:\n  trigger: g/p\n'],
  ['GITLAB_RULES_AND_ONLY', 'a:\n  script: x\n  rules:\n    - if: $A\n  only: [main]\n', 'a:\n  script: x\n  rules:\n    - if: $A\n'],
  ['GITLAB_ONLY_EXCEPT_DEPRECATED', 'a:\n  script: x\n  only: [main]\n', ok],
  ['GITLAB_ONLY_EXCEPT_DEPRECATED', 'a:\n  script: x\n  except: [tags]\n', ok],
  ['GITLAB_IMAGE_UNPINNED', 'image: node\n' + ok, 'image: node:22\n' + ok],
  ['GITLAB_IMAGE_UNPINNED', 'a:\n  image: node:latest\n  script: x\n', 'a:\n  image: node:22.1\n  script: x\n'],
  ['GITLAB_IMAGE_UNPINNED', 'a:\n  image:\n    name: localhost:5000/app\n  script: x\n', 'a:\n  image:\n    name: localhost:5000/app:1.2\n  script: x\n'],
  ['GITLAB_IMAGE_UNPINNED', 'a:\n  image: node\n  script: x\n', 'a:\n  image: node@sha256:' + sha + '\n  script: x\n'],
  ['GITLAB_IMAGE_UNPINNED', 'a:\n  image: node\n  script: x\n', 'a:\n  image: $CI_REGISTRY_IMAGE\n  script: x\n'],
  ['GITLAB_SECRET_IN_VARIABLES', 'variables:\n  API_TOKEN: abc123\n' + ok, 'variables:\n  API_TOKEN: $VAULT_TOKEN\n' + ok],
  ['GITLAB_SECRET_IN_VARIABLES', 'a:\n  script: x\n  variables:\n    DB_PASSWORD:\n      value: hunter2\n', 'variables:\n  NODE_ENV: production\n' + ok],
  ['GITLAB_SECRET_IN_VARIABLES', 'variables:\n  PRIVATE_KEY: abc\n' + ok, 'variables:\n  PRIVATE_KEY: ""\n' + ok],
  ['GITLAB_CURL_PIPE_SHELL', 'a:\n  script:\n    - curl -sSL https://x.sh | sh\n', 'a:\n  script:\n    - curl -sSL -o i.sh https://x.sh\n'],
  ['GITLAB_CURL_PIPE_SHELL', 'a:\n  before_script:\n    - wget -qO- https://x | sudo bash\n  script: x\n', ok],
  ['GITLAB_CURL_PIPE_SHELL', 'before_script:\n  - curl https://x | bash\n' + ok, ok],
  ['GITLAB_DEPLOY_UNGUARDED', 'deploy:\n  stage: deploy\n  script: x\n', 'deploy:\n  stage: deploy\n  script: x\n  rules:\n    - if: $CI_COMMIT_TAG\n'],
  ['GITLAB_DEPLOY_UNGUARDED', 'a:\n  script: x\n  environment: prod\n', 'a:\n  script: x\n  environment: prod\n  when: manual\n'],
  ['GITLAB_DEPLOY_UNGUARDED', 'a:\n  script: x\n  environment: prod\n', 'a:\n  script: x\n  environment:\n    name: prod\n    action: stop\n'],
  ['GITLAB_ALLOW_FAILURE_DEPLOY', 'd:\n  stage: deploy\n  script: x\n  allow_failure: true\n  only: [main]\n', 'd:\n  stage: deploy\n  script: x\n  allow_failure: false\n  only: [main]\n'],
  ['GITLAB_ARTIFACT_NO_EXPIRY', 'a:\n  script: x\n  artifacts:\n    paths: [dist]\n', 'a:\n  script: x\n  artifacts:\n    paths: [dist]\n    expire_in: 1 day\n'],
  ['GITLAB_CACHE_NO_KEY', 'a:\n  script: x\n  cache:\n    paths: [node_modules]\n', 'a:\n  script: x\n  cache:\n    key: k\n    paths: [node_modules]\n'],
  ['GITLAB_CACHE_NO_KEY', 'a:\n  script: x\n  cache:\n    - paths: [a]\n    - key: k\n      paths: [b]\n', 'a:\n  script: x\n  cache:\n    - key: k\n      paths: [b]\n'],
  ['GITLAB_NO_TIMEOUT', ok, 'default:\n  timeout: 10 minutes\n' + ok],
  ['GITLAB_NO_TIMEOUT', ok, 'build:\n  script: x\n  timeout: 5 minutes\n'],
  ['GITLAB_INCLUDE_UNPINNED', 'include:\n  - project: g/p\n    file: /a.yml\n' + ok, 'include:\n  - project: g/p\n    ref: v1.0.0\n    file: /a.yml\n' + ok],
  ['GITLAB_INCLUDE_UNPINNED', 'include:\n  - project: g/p\n    ref: main\n    file: /a.yml\n' + ok, 'include:\n  - local: /a.yml\n' + ok],
  ['GITLAB_INCLUDE_UNPINNED', 'include:\n  - component: gitlab.com/g/c/x@~latest\n' + ok, 'include:\n  - component: gitlab.com/g/c/x@1.2.0\n' + ok],
  ['GITLAB_INCLUDE_INSECURE', 'include: http://x.example/a.yml\n' + ok, 'include: https://x.example/a.yml\n' + ok],
  ['GITLAB_INCLUDE_INSECURE', 'include:\n  - remote: http://x/a.yml\n' + ok, 'include:\n  - remote: https://x/a.yml\n' + ok],
  ['YAML_INVALID', 'a: [\n', ok],
  ['YAML_INVALID', 'a: 1\na: 2\n', ok],
  ['PIPELINE_ROOT_INVALID', '- a\n- b\n', ok],
  ['PIPELINE_ROOT_INVALID', '', ok],
]);

test('gitlab-ci: findings carry the line of the offending key', () => {
  const finding = gl.analyze('stages: [build]\n\na:\n  stage: deploy\n  script: x\n').findings.find((f) => f.code === 'GITLAB_STAGE_UNDEFINED');
  assert.equal(finding.line, 4);
  assert.equal(finding.severity, 'error');
});

test('gitlab-ci: YAML merge keys and anchors resolve', () => {
  const src = '.defaults: &d\n  image: node:22\n  script: [x]\njob:\n  <<: *d\n';
  assert.ok(!codesOf(gl, src).includes('GITLAB_JOB_NO_SCRIPT'));
});

test('gitlab-ci: long needs chains are handled', () => {
  const chain = Array.from({ length: 300 }, (_, i) => `j${i}:\n  script: x\n` + (i > 0 ? `  needs: [j${i - 1}]\n` : '')).join('');
  assert.ok(!codesOf(gl, chain).includes('GITLAB_NEEDS_CYCLE'));
  assert.ok(codesOf(gl, chain.replace('j0:\n  script: x\n', 'j0:\n  script: x\n  needs: [j299]\n')).includes('GITLAB_NEEDS_CYCLE'));
});

test('gitlab-ci: model maps jobs, needs, environment, conditions and steps', () => {
  const model = gl.model([
    'default:', '  image: node:22', '  timeout: 1h', 'stages: [build, deploy]',
    '.t:', '  before_script: [echo hi]',
    'build:', '  extends: .t', '  stage: build', '  script: [npm ci, npm test]',
    'deploy:', '  stage: deploy', '  needs: [build]', '  script: ./d.sh', '  environment:', '    name: prod',
    '  rules:', '    - if: $CI_COMMIT_BRANCH == "main"', '',
  ].join('\n'));
  assert.equal(model.provider, 'gitlab-ci');
  assert.deepEqual(model.jobs.map((j) => j.id), ['build', 'deploy']);
  const [build, deploy] = model.jobs;
  assert.deepEqual(build.steps.map((s) => s.run), ['echo hi', 'npm ci', 'npm test']);
  assert.deepEqual(deploy.needs, ['build']);
  assert.equal(deploy.environment, 'prod');
  assert.equal(deploy.condition, '$CI_COMMIT_BRANCH == "main"');
  assert.deepEqual(deploy.runsOn, ['node:22']);
  assert.equal(deploy.timeoutMinutes, 60);
  assert.equal(gl.model('a: ['), undefined);
  assert.equal(gl.model('- x'), undefined);
});

hostileTests(gl, ['a:\n  extends: [a, a, a]\n  needs: 5\n  script: 7\n', 'stages: 3\na: {stage: [x], needs: [[], {}, null]}\n', 'include: [1, null, [x]]\n']);
fixtureTests(gl, ['gitlab-node.yml', 'gitlab-docker.yml', 'gitlab-include-trigger.yml']);
