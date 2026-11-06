const { dist, ruleTable, hostileTests, fixtureTests, codesOf, test, assert } = require('./helpers.cjs');
const { azurePipelinesProvider: az } = dist('azure-pipelines/provider.js');

const head = 'trigger: none\npr: none\n';
const ok = head + 'jobs:\n  - job: a\n    timeoutInMinutes: 5\n    steps:\n      - script: echo\n';
const jobs = (body) => head + 'jobs:\n' + body;
const stage = (id, extra = '') => `  - stage: ${id}\n${extra}    jobs:\n      - job: j${id}\n        timeoutInMinutes: 5\n        steps:\n          - script: echo\n`;
const stages = (...items) => head + 'stages:\n' + items.join('');
const deployment = (env) => jobs(`  - deployment: d\n${env}    timeoutInMinutes: 5\n    strategy:\n      runOnce:\n        deploy:\n          steps:\n            - script: echo\n`);
const withSteps = (steps) => jobs(`  - job: a\n    timeoutInMinutes: 5\n    steps:\n${steps}`);

test('azure-pipelines: matches azure-pipelines.yml only', () => {
  assert.ok(az.matches('azure-pipelines.yml') && az.matches('svc/azure-pipelines.yaml'));
  assert.ok(!az.matches('pipelines.yml') && !az.matches('azure-pipelines.yml.bak'));
});

ruleTable(az, [
  ['AZURE_NO_WORK', head + 'name: x\n', ok],
  ['AZURE_NO_WORK', head + 'variables:\n  a: b\n', head + 'extends:\n  template: t.yml\n'],
  ['AZURE_MIXED_STRUCTURE', head + 'jobs:\n  - job: a\nsteps:\n  - script: x\n', ok],
  ['AZURE_DUPLICATE_ID', jobs('  - job: a\n    steps: []\n  - job: a\n    steps: []\n'), jobs('  - job: a\n    steps: []\n  - job: b\n    steps: []\n')],
  ['AZURE_DUPLICATE_ID', stages(stage('A'), stage('A')), stages(stage('A'), stage('B'))],
  ['AZURE_STAGE_DEPENDS_UNKNOWN', stages(stage('A', '    dependsOn: Ghost\n')), stages(stage('B'), stage('A', '    dependsOn: B\n'))],
  ['AZURE_STAGE_DEPENDS_UNKNOWN', stages(stage('A', '    dependsOn: [Ghost]\n')), stages(stage('A', '    dependsOn: []\n'))],
  ['AZURE_STAGE_DEPENDS_CYCLE', stages(stage('A', '    dependsOn: B\n'), stage('B', '    dependsOn: A\n')), stages(stage('A'), stage('B', '    dependsOn: A\n'))],
  ['AZURE_STAGE_DEPENDS_CYCLE', stages(stage('A', '    dependsOn: A\n')), stages(stage('A'))],
  ['AZURE_JOB_DEPENDS_UNKNOWN', jobs('  - job: a\n    dependsOn: ghost\n    steps: []\n'), jobs('  - job: b\n    steps: []\n  - job: a\n    dependsOn: b\n    steps: []\n')],
  ['AZURE_JOB_DEPENDS_CYCLE', jobs('  - job: a\n    dependsOn: b\n    steps: []\n  - job: b\n    dependsOn: a\n    steps: []\n'), jobs('  - job: a\n    steps: []\n  - job: b\n    dependsOn: a\n    steps: []\n')],
  ['AZURE_JOB_DEPENDS_CYCLE', jobs('  - job: a\n    dependsOn: [a]\n    steps: []\n'), ok],
  ['AZURE_STEP_INVALID', withSteps('      - foo: bar\n'), withSteps('      - script: bar\n')],
  ['AZURE_STEP_INVALID', withSteps('      - displayName: x\n'), withSteps('      - template: steps/x.yml\n')],
  ['AZURE_TASK_VERSION_MISSING', withSteps('      - task: NodeTool\n'), withSteps('      - task: NodeTool@0\n')],
  ['AZURE_TASK_VERSION_MISSING', withSteps('      - task: Foo@\n'), withSteps('      - task: Foo@1.*\n')],
  ['AZURE_TASK_VERSION_MISSING', withSteps('      - task: Foo@latest\n'), withSteps('      - task: Foo@2.1\n')],
  ['AZURE_POOL_IMAGE_LATEST', head + 'pool:\n  vmImage: ubuntu-latest\n' + ok.slice(head.length), head + 'pool:\n  vmImage: ubuntu-24.04\n' + ok.slice(head.length)],
  ['AZURE_POOL_IMAGE_LATEST', jobs('  - job: a\n    pool:\n      vmImage: latest\n    steps: []\n'), jobs('  - job: a\n    pool:\n      name: Default\n    steps: []\n')],
  ['AZURE_TRIGGER_MISSING', 'pr: none\njobs:\n  - job: a\n    steps: []\n', ok],
  ['AZURE_PR_TRIGGER_MISSING', 'trigger: none\njobs:\n  - job: a\n    steps: []\n', ok],
  ['AZURE_TRIGGER_WILDCARD', "trigger:\n  - '*'\npr: none\n" + ok.slice(head.length), 'trigger:\n  - main\npr: none\n' + ok.slice(head.length)],
  ['AZURE_TRIGGER_WILDCARD', "trigger:\n  branches:\n    include:\n      - '*'\npr: none\n" + ok.slice(head.length), 'trigger:\n  branches:\n    include:\n      - main\npr: none\n' + ok.slice(head.length)],
  ['AZURE_SECRET_IN_VARIABLES', head + 'variables:\n  apiKey: abc123\n' + ok.slice(head.length), head + 'variables:\n  apiKey: $(KeyVaultKey)\n' + ok.slice(head.length)],
  ['AZURE_SECRET_IN_VARIABLES', head + 'variables:\n  - name: dbPassword\n    value: hunter2\n' + ok.slice(head.length), head + 'variables:\n  - group: secrets\n  - name: region\n    value: eu\n' + ok.slice(head.length)],
  ['AZURE_SECRET_IN_VARIABLES', jobs('  - job: a\n    variables:\n      TOKEN: abc\n    steps: []\n'), jobs('  - job: a\n    variables:\n      TOKEN: ${{ parameters.token }}\n    steps: []\n')],
  ['AZURE_CURL_PIPE_SHELL', withSteps('      - script: curl -sL https://x | bash\n'), withSteps('      - script: curl -sL -o x.sh https://x\n')],
  ['AZURE_CURL_PIPE_SHELL', withSteps('      - bash: wget -qO- https://x | sh\n'), withSteps('      - bash: echo ok\n')],
  ['AZURE_DEPLOYMENT_NO_ENVIRONMENT', deployment(''), deployment('    environment: prod\n')],
  ['AZURE_DEPLOYMENT_NO_ENVIRONMENT', deployment(''), deployment('    environment:\n      name: prod\n')],
  ['AZURE_DEPLOY_JOB_NOT_DEPLOYMENT', jobs('  - job: DeployWeb\n    steps: []\n'), deployment('    environment: prod\n')],
  ['AZURE_NO_TIMEOUT', jobs('  - job: a\n    steps: []\n'), ok],
  ['AZURE_CONDITION_ALWAYS', jobs('  - job: a\n    condition: always()\n    steps: []\n'), jobs('  - job: a\n    condition: succeededOrFailed()\n    steps: []\n')],
  ['AZURE_CONDITION_ALWAYS', withSteps('      - script: x\n        condition: always()\n'), withSteps('      - script: x\n        condition: succeeded()\n')],
  ['AZURE_REPO_RESOURCE_UNPINNED', head + 'resources:\n  repositories:\n    - repository: t\n      type: git\n      name: p/t\n      ref: refs/heads/main\n' + ok.slice(head.length), head + 'resources:\n  repositories:\n    - repository: t\n      type: git\n      name: p/t\n      ref: refs/tags/v1\n' + ok.slice(head.length)],
  ['AZURE_REPO_RESOURCE_UNPINNED', head + 'resources:\n  repositories:\n    - repository: t\n      type: git\n      name: p/t\n' + ok.slice(head.length), ok],
  ['AZURE_CONTAINER_UNPINNED', head + 'resources:\n  containers:\n    - container: c\n      image: ubuntu\n' + ok.slice(head.length), head + 'resources:\n  containers:\n    - container: c\n      image: ubuntu:22.04\n' + ok.slice(head.length)],
  ['AZURE_CONTAINER_UNPINNED', head + 'resources:\n  containers:\n    - container: c\n      image: node:latest\n' + ok.slice(head.length), ok],
  ['YAML_INVALID', 'trigger: [\n', ok],
  ['PIPELINE_ROOT_INVALID', '- a\n', ok],
]);

test('azure-pipelines: deployment strategy steps are scanned at any depth', () => {
  const src = jobs('  - deployment: d\n    environment: prod\n    timeoutInMinutes: 5\n    strategy:\n      canary:\n        increments: [10]\n        deploy:\n          steps:\n            - script: curl x | sh\n            - task: Bad\n');
  const codes = codesOf(az, src);
  assert.ok(codes.includes('AZURE_CURL_PIPE_SHELL') && codes.includes('AZURE_TASK_VERSION_MISSING'));
});

test('azure-pipelines: top-level steps form one implicit job', () => {
  const src = head + 'steps:\n  - script: echo\n';
  assert.ok(!codesOf(az, src).includes('AZURE_NO_WORK'));
  assert.equal(az.model(src).jobs.length, 1);
});

test('azure-pipelines: dependency graphs of 300 stages stay linear and cycle-free', () => {
  const chain = stages(...Array.from({ length: 300 }, (_, i) => stage(`S${i}`, i > 0 ? `    dependsOn: S${i - 1}\n` : '')));
  assert.ok(!codesOf(az, chain).includes('AZURE_STAGE_DEPENDS_CYCLE'));
});

test('azure-pipelines: model maps stages, needs, environment, conditions and triggers', () => {
  const model = az.model([
    'name: ci', 'trigger:', '  branches:', '    include: [main]', 'pr:', '  - main', 'pool:', '  vmImage: ubuntu-24.04',
    'stages:', '  - stage: Build', '    jobs:', '      - job: Compile', '        timeoutInMinutes: 12',
    '        steps:', '          - script: make', '            displayName: Make',
    '  - stage: Ship', '    dependsOn: Build', '    jobs:',
    '      - deployment: Web', '        environment: prod', '        condition: succeeded()',
    '        strategy:', '          runOnce:', '            deploy:', '              steps:', '                - task: Foo@1', '',
  ].join('\n'));
  assert.equal(model.provider, 'azure-pipelines');
  assert.equal(model.name, 'ci');
  assert.deepEqual(model.triggers.map((t) => [t.event, t.branches]), [['push', ['main']], ['pull_request', ['main']]]);
  const [compile, web] = model.jobs;
  assert.equal(compile.id, 'Build.Compile');
  assert.equal(compile.timeoutMinutes, 12);
  assert.deepEqual(compile.runsOn, ['ubuntu-24.04']);
  assert.equal(compile.steps[0].run, 'make');
  assert.equal(compile.steps[0].name, 'Make');
  assert.deepEqual(web.needs, ['Build.Compile']);
  assert.equal(web.environment, 'prod');
  assert.equal(web.condition, 'succeeded()');
  assert.equal(web.steps[0].uses, 'Foo@1');
  assert.equal(az.model('a: ['), undefined);
});

hostileTests(az, ['stages:\n  - stage: [x]\n    jobs: 4\n', 'jobs:\n  - job: a\n    dependsOn: {x: y}\n    steps: [1, null, "s"]\n', 'resources: [1]\ntrigger: {branches: 5}\nvariables: 7\n']);
fixtureTests(az, ['azure-dotnet.yml', 'azure-node-jobs.yml', 'azure-container-resources.yml']);
