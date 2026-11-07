// Perf helpers: median-of-N timing and optional JSON report emission (ORQUESTIVO_REPORT_DIR).
const fs = require('node:fs');
const path = require('node:path');

const PIN = 'a'.repeat(40);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const round = (ms) => Math.round(ms * 10) / 10;

/** Runs `fn` `runs` times and returns { value (last result), medianMs, samples }. */
function timed(fn, runs = 3) {
  const samples = [];
  let value;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    value = fn();
    samples.push(round(performance.now() - start));
  }
  return { value, medianMs: median(samples), samples };
}

async function timedAsync(fn, runs = 3) {
  const samples = [];
  let value;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    value = await fn();
    samples.push(round(performance.now() - start));
  }
  return { value, medianMs: median(samples), samples };
}

function emitReport(name, data) {
  const dir = process.env.ORQUESTIVO_REPORT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `perf-${name}.json`), JSON.stringify(data, null, 2) + '\n');
}

function chainedWorkflow(jobs, name = 'Big') {
  const lines = [`name: ${name}`, 'on: [push, pull_request]', 'permissions:', '  contents: read', 'jobs:'];
  for (let i = 0; i < jobs; i++) {
    lines.push(`  job${i}:`, '    runs-on: ubuntu-latest', '    timeout-minutes: 10');
    if (i > 0) lines.push(`    needs: job${i - 1}`);
    lines.push('    steps:', `      - uses: actions/checkout@${PIN}`, `      - run: echo ${i}`);
  }
  return lines.join('\n') + '\n';
}

function smallWorkflow(i) {
  return `name: W${i}\non: push\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@${PIN}\n      - run: npm test -- ${i}\n`;
}

function matrixExpressionWorkflow(axes, values) {
  const matrix = [];
  for (let a = 0; a < axes; a++) matrix.push(`        a${a}: [${Array.from({ length: values }, (_, v) => v).join(', ')}]`);
  const interpolated = Array.from({ length: axes }, (_, a) => '${{ matrix.a' + a + ' }}').join('-');
  const deep = Array.from({ length: 50 }, (_, n) => `(github.ref == 'refs/heads/m${n}' || matrix.a0 == ${n})`).join(' && ');
  return ['name: Deep', 'on: push', 'permissions:', '  contents: read', 'jobs:', '  m:', '    runs-on: ubuntu-latest', '    timeout-minutes: 10',
    '    strategy:', '      matrix:', ...matrix, '    steps:', `      - uses: actions/checkout@${PIN}`,
    '      - if: ${{ ' + deep + ' }}', `        run: echo "${interpolated}"`].join('\n') + '\n';
}

module.exports = { PIN, median, timed, timedAsync, emitReport, chainedWorkflow, smallWorkflow, matrixExpressionWorkflow };
