const { dist, ruleTable, hostileTests, fixtureTests, codesOf, test, assert } = require('./helpers.cjs');
const { jenkinsProvider: jk } = dist('jenkins/provider.js');

/** Builds a Jenkinsfile; each section can be overridden (use '' to drop it). */
const jf = ({
  agent = "agent { label 'x' }",
  options = "options {\n    timeout(time: 5, unit: 'MINUTES')\n    buildDiscarder(logRotator(numToKeepStr: '5'))\n  }",
  environment = '',
  stages = "stages {\n    stage('Build') {\n      steps { sh 'make' }\n    }\n  }",
  post = "post { always { echo 'done' } }",
} = {}) => `pipeline {\n  ${[agent, options, environment, stages, post].filter(Boolean).join('\n  ')}\n}\n`;
const stagesOf = (body) => `stages {\n${body}\n  }`;
const stepStage = (name, steps, extra = '') => `    stage('${name}') {\n      ${extra}\n      steps { ${steps} }\n    }\n`;

test('jenkins: matches Jenkinsfile variants only', () => {
  assert.ok(jk.matches('Jenkinsfile') && jk.matches('svc/Jenkinsfile.prod') && jk.matches('ci/build.jenkinsfile'));
  assert.ok(!jk.matches('jenkins.yml') && !jk.matches('MyJenkinsfile'));
});

ruleTable(jk, [
  ['JENKINS_UNPARSEABLE_SCRIPTED', "node('linux') {\n  stage('Build') { sh 'make' }\n}\n", jf()],
  ['JENKINS_UNPARSEABLE_SCRIPTED', "@Library('shared') _\ndef x = 1\nnode { echo 'a' }\n", jf()],
  ['JENKINS_SYNTAX_ERROR', 'pipeline {', jf()],
  ['JENKINS_SYNTAX_ERROR', jf() + '}\n', jf()],
  ['JENKINS_SYNTAX_ERROR', "pipeline { agent any\n  stages { stage('a') { steps { sh 'oops } } } }", jf()],
  ['JENKINS_SYNTAX_ERROR', '/* never closed\npipeline { }', jf()],
  ['JENKINS_SYNTAX_ERROR', '{'.repeat(200), jf()],
  ['JENKINS_NO_PIPELINE', '', jf()],
  ['JENKINS_NO_PIPELINE', '// nothing here\n/* nor here */\n', jf()],
  ['JENKINS_NO_STAGES', jf({ stages: '' }), jf()],
  ['JENKINS_NO_STAGES', jf({ stages: 'stages { }' }), jf()],
  ['JENKINS_STAGE_NO_STEPS', jf({ stages: stagesOf("    stage('Empty') { }") }), jf()],
  ['JENKINS_STAGE_NO_STEPS', jf({ stages: stagesOf("    stage('W') { when { branch 'a' } }") }), jf({ stages: stagesOf("    stage('M') { matrix { axes { axis { name 'A'; values 'a' } } stages { stage('x') { steps { echo 'x' } } } } }") })],
  ['JENKINS_DUPLICATE_STAGE', jf({ stages: stagesOf(stepStage('A', "echo 'a'") + stepStage('A', "echo 'b'")) }), jf({ stages: stagesOf(stepStage('A', "echo 'a'") + stepStage('B', "echo 'b'")) })],
  ['JENKINS_NO_AGENT', jf({ agent: '' }), jf()],
  ['JENKINS_NO_AGENT', jf({ agent: '', stages: stagesOf(stepStage('A', "echo 'a'", "agent { label 'x' }") + stepStage('B', "echo 'b'")) }), jf({ agent: '', stages: stagesOf(stepStage('A', "echo 'a'", "agent { label 'x' }") + stepStage('B', "echo 'b'", 'agent none')) })],
  ['JENKINS_NO_AGENT', jf({ agent: '' }), jf({ agent: 'agent none', stages: stagesOf(stepStage('A', "echo 'a'", 'agent any')) })],
  ['JENKINS_AGENT_ANY', jf({ agent: 'agent any' }), jf()],
  ['JENKINS_AGENT_ANY', jf({ agent: 'agent none', stages: stagesOf(stepStage('A', "echo 'a'", 'agent any')) }), jf({ agent: 'agent none', stages: stagesOf(stepStage('A', "echo 'a'", "agent { label 'x' }")) })],
  ['JENKINS_NO_TIMEOUT', jf({ options: '' }), jf()],
  ['JENKINS_NO_TIMEOUT', jf({ options: "options { buildDiscarder(logRotator(numToKeepStr: '5')) }" }), jf({ options: "options { timeout(time: 1, unit: 'HOURS') }" })],
  ['JENKINS_NO_TIMEOUT', jf({ options: '' }), jf({ options: '', stages: stagesOf(stepStage('A', "echo 'a'", "options { timeout(time: 5, unit: 'MINUTES') }")) })],
  ['JENKINS_NO_BUILD_DISCARDER', jf({ options: "options { timeout(time: 5, unit: 'MINUTES') }" }), jf()],
  ['JENKINS_NO_POST', jf({ post: '' }), jf()],
  ['JENKINS_DOCKER_IMAGE_UNPINNED', jf({ agent: "agent { docker 'node' }" }), jf({ agent: "agent { docker 'node:22.11' }" })],
  ['JENKINS_DOCKER_IMAGE_UNPINNED', jf({ agent: "agent {\n docker {\n image 'node:latest'\n }\n }" }), jf({ agent: "agent {\n docker {\n image 'node:22'\n }\n }" })],
  ['JENKINS_DOCKER_IMAGE_UNPINNED', jf({ agent: 'agent { docker { image "maven" } }' }), jf({ agent: "agent { docker { image 'maven@sha256:" + 'b'.repeat(64) + "' } }" })],
  ['JENKINS_SH_INTERPOLATION', jf({ stages: stagesOf(stepStage('A', 'sh "echo ${params.NAME}"')) }), jf({ stages: stagesOf(stepStage('A', "sh 'echo ${params.NAME}'")) })],
  ['JENKINS_SH_INTERPOLATION', jf({ stages: stagesOf(stepStage('A', 'sh "git checkout $BRANCH_NAME"')) }), jf({ stages: stagesOf(stepStage('A', 'sh "echo static"')) })],
  ['JENKINS_SH_INTERPOLATION', jf({ stages: stagesOf(stepStage('A', 'sh(script: "echo ${env.USER}", returnStdout: true)')) }), jf({ stages: stagesOf(stepStage('A', "sh(script: 'echo ${env.USER}', returnStdout: true)")) })],
  ['JENKINS_CREDENTIAL_INTERPOLATION', jf({ environment: "environment { TOKEN_X = credentials('t') }", stages: stagesOf(stepStage('A', 'sh "curl -u $TOKEN_X_USR:$TOKEN_X_PSW x"')) }), jf({ environment: "environment { TOKEN_X = credentials('t') }", stages: stagesOf(stepStage('A', "sh 'curl -u $TOKEN_X_USR:$TOKEN_X_PSW x'")) })],
  ['JENKINS_CREDENTIAL_INTERPOLATION', jf({ environment: "environment { SVC = credentials('t') }", stages: stagesOf(stepStage('A', 'sh "echo ${SVC}"')) }), jf({ environment: "environment { SVC = credentials('t') }", stages: stagesOf(stepStage('A', 'sh "echo $SVCX"')) })],
  ['JENKINS_HARDCODED_SECRET', jf({ environment: "environment { API_KEY = 'abc123' }" }), jf({ environment: "environment { API_KEY = credentials('api-key') }" })],
  ['JENKINS_HARDCODED_SECRET', jf({ environment: "environment { DB_PASSWORD = 'hunter2' }" }), jf({ environment: "environment { NODE_ENV = 'production' }" })],
  ['JENKINS_HARDCODED_SECRET', jf({ environment: 'environment { TOKEN = "abc" }' }), jf({ environment: 'environment { TOKEN = "${params.T}" }' })],
  ['JENKINS_DEPLOY_NO_APPROVAL', jf({ stages: stagesOf(stepStage('Deploy', "sh './d.sh'")) }), jf({ stages: stagesOf(stepStage('Deploy', "input 'Go?'; sh './d.sh'")) })],
  ['JENKINS_DEPLOY_NO_APPROVAL', jf({ stages: stagesOf(stepStage('Release to prod', "sh './r.sh'")) }), jf({ stages: stagesOf(stepStage('Build', "sh './b.sh'")) })],
  ['JENKINS_DEPLOY_NO_APPROVAL', jf({ stages: stagesOf(stepStage('Deploy', "sh './d.sh'")) }), jf({ stages: stagesOf(stepStage('Deploy', "sh './d.sh'", "input { message 'Go?' }")) })],
  ['JENKINS_PARALLEL_NO_FAILFAST', jf({ stages: stagesOf("    stage('P') {\n parallel {\n" + stepStage('a', "echo 'a'") + stepStage('b', "echo 'b'") + ' }\n }') }), jf({ stages: stagesOf("    stage('P') {\n failFast true\n parallel {\n" + stepStage('a', "echo 'a'") + stepStage('b', "echo 'b'") + ' }\n }') })],
  ['JENKINS_PARALLEL_NO_FAILFAST', jf({ stages: stagesOf("    stage('P') {\n parallel {\n" + stepStage('a', "echo 'a'") + ' }\n }') }), jf({ options: "options { timeout(time: 5, unit: 'MINUTES')\n parallelsAlwaysFailFast()\n buildDiscarder(logRotator(numToKeepStr: '5')) }", stages: stagesOf("    stage('P') {\n parallel {\n" + stepStage('a', "echo 'a'") + ' }\n }') })],
  ['JENKINS_CURL_PIPE_SHELL', jf({ stages: stagesOf(stepStage('A', "sh 'curl -sL https://x | sh'")) }), jf({ stages: stagesOf(stepStage('A', "sh 'curl -sL -o x.sh https://x'")) })],
  ['JENKINS_CURL_PIPE_SHELL', jf({ stages: stagesOf(stepStage('A', "sh '''\n  wget -qO- https://x | bash\n'''")) }), jf({ stages: stagesOf(stepStage('A', "echo 'curl x | sh'")) })],
]);

test('jenkins: a well formed declarative pipeline has no findings but scripted blocks inside are tolerated', () => {
  const src = jf({ stages: stagesOf(stepStage('A', "script { def x = [a: 1, b: { -> 2 }]\n if (x) { echo 'ok' } else { echo 'no' } }")) });
  assert.deepEqual(codesOf(jk, src), []);
  assert.equal(jk.analyze(src).syntaxValid, true);
});

test('jenkins: comments and line continuations do not confuse the parser', () => {
  const src = "// header { unbalanced\npipeline {\n  agent { label 'x' } /* } */\n  options { timeout(time: 5,\n      unit: 'MINUTES')\n    buildDiscarder(logRotator(numToKeepStr: '5')) }\n  stages {\n    stage('A') {\n      steps {\n        sh 'a' +\n          'b'\n      }\n    }\n  }\n  post { always { echo 'x' } }\n}\n";
  assert.deepEqual(codesOf(jk, src), []);
});

test('jenkins: scripted pipelines are reported, never guessed', () => {
  const result = jk.analyze("node {\n  stage('x') { sh \"echo ${params.X}\" }\n}\n");
  assert.deepEqual(result.findings.map((f) => f.code), ['JENKINS_UNPARSEABLE_SCRIPTED']);
  assert.equal(result.findings[0].severity, 'information');
  assert.equal(result.syntaxValid, true);
  assert.equal(jk.model("node { echo 'x' }"), undefined);
});

test('jenkins: syntax errors are not valid syntax and carry the line', () => {
  const result = jk.analyze("pipeline {\n  agent any\n  stages {\n");
  assert.equal(result.syntaxValid, false);
  assert.equal(result.findings[0].code, 'JENKINS_SYNTAX_ERROR');
  assert.ok(result.findings[0].line >= 1);
});

test('jenkins: model maps stages, sequence, parallel branches, agents and conditions', () => {
  const src = jf({
    options: "options { timeout(time: 30, unit: 'MINUTES')\n disableConcurrentBuilds() }",
    stages: stagesOf([
      stepStage('Build', "sh 'make'\n echo 'x'"),
      "    stage('Checks') {\n parallel {\n" + stepStage('Unit', "sh 'make test'") + stepStage('Lint', "sh 'make lint'", "agent { label 'lint' }") + ' }\n }\n',
      stepStage('Deploy', "sh './d.sh'", "when { branch 'main' }\n options { timeout(time: 10, unit: 'MINUTES') }"),
    ].join('')),
  });
  const model = jk.model(src);
  assert.equal(model.provider, 'jenkins');
  assert.equal(model.hasConcurrency, true);
  assert.deepEqual(model.jobs.map((j) => j.id), ['Build', 'Unit', 'Lint', 'Deploy']);
  const byId = Object.fromEntries(model.jobs.map((j) => [j.id, j]));
  assert.deepEqual(byId.Build.needs, []);
  assert.deepEqual(byId.Unit.needs, ['Build']);
  assert.deepEqual(byId.Lint.needs, ['Build']);
  assert.deepEqual(byId.Deploy.needs, ['Unit', 'Lint']);
  assert.deepEqual(byId.Lint.runsOn, ['lint']);
  assert.deepEqual(byId.Build.runsOn, ['x']);
  assert.equal(byId.Deploy.condition, 'branch main');
  assert.equal(byId.Deploy.timeoutMinutes, 10);
  assert.equal(byId.Build.steps[0].run, 'make');
  assert.equal(jk.model('pipeline {'), undefined);
});

test('jenkins: deeply nested and token-heavy inputs are bounded', () => {
  assert.equal(jk.analyze('a {'.repeat(100)).findings[0].code, 'JENKINS_SYNTAX_ERROR');
  const heavy = jk.analyze('x '.repeat(250_000));
  assert.ok(heavy.findings.length >= 1);
});

hostileTests(jk, ["pipeline { agent any; stages { stage('a') { steps { sh \"${\" } } } }", 'pipeline { environment { A = } }', "pipeline { stages { stage('a') { parallel { } } } }", "pipeline { stages { stage('a') { stages { stage('b') { steps { sh } } } } } }"]);
fixtureTests(jk, ['Jenkinsfile.maven', 'Jenkinsfile.docker', 'Jenkinsfile.parallel']);
