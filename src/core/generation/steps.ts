import { PINNED_ACTIONS } from './actions.js';
import type { ResolvedOptions } from './options.js';
import type { PackageManager } from './types.js';

/** A workflow step as data; `with` values are already valid YAML scalars. */
export interface Step {
  readonly name: string;
  readonly uses?: string;
  readonly run?: string | readonly string[];
  readonly with?: Readonly<Record<string, string>>;
  readonly if?: string;
}

/** YAML double-quoted scalar (JSON strings are valid YAML). */
export const quote = (value: string): string => JSON.stringify(value);
/** Matrix expressions are built by concatenation so no template-literal lint rule trips on them. */
export const expression = (body: string): string => '$' + '{{ ' + body + ' }}';
export const MATRIX_RUNTIME = expression('matrix.runtime');

export const checkoutStep: Step = {
  name: 'Check out source', uses: PINNED_ACTIONS.checkout, with: { 'persist-credentials': 'false' },
};

const LOCKFILES: Readonly<Record<PackageManager, string>> = {
  npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock',
};
const INSTALL: Readonly<Record<PackageManager, string>> = {
  npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --immutable',
};
const AUDIT: Readonly<Record<PackageManager, string>> = {
  npm: 'npm audit --audit-level=high', pnpm: 'pnpm audit --audit-level high', yarn: 'yarn npm audit --severity high',
};

const corepackStep: Step = { name: 'Enable Corepack', run: 'corepack enable' };
const runtime = (o: ResolvedOptions): string =>
  o.runtimeVersions.length > 1 ? MATRIX_RUNTIME : quote(o.runtimeVersions[0] ?? '');

export interface PresetSteps {
  readonly steps: readonly Step[];
  /** Human-visible notes rendered as header comments (things deliberately left out). */
  readonly notes: readonly string[];
}

function nodeSteps(o: ResolvedOptions): PresetSteps {
  const pm = o.packageManager;
  const notes: string[] = [];
  const steps: Step[] = [
    ...(pm === 'npm' ? [] : [corepackStep]),
    {
      name: 'Set up Node.js', uses: PINNED_ACTIONS.setupNode,
      with: { 'node-version': runtime(o), ...(o.cache ? { cache: pm } : {}) },
    },
    { name: 'Install locked dependencies', run: INSTALL[pm] },
  ];
  if (o.preset === 'next' && o.cache) {
    const pin = o.actionPins.cache;
    if (pin === undefined) notes.push('.next/cache is not cached: supply actionPins.cache (a verified SHA) to enable it.');
    else {
      steps.push({
        name: 'Cache Next.js build', uses: 'actions/cache@' + pin,
        with: {
          path: '.next/cache',
          key: quote(expression('runner.os') + '-next-' + expression("hashFiles('" + LOCKFILES[pm] + "')")),
        },
      });
    }
  }
  if (o.lint) steps.push(o.preset === 'typescript'
    ? { name: 'Type-check', run: 'npx --no-install tsc --noEmit' }
    : { name: 'Lint', run: pm + ' run lint' });
  if (o.build) steps.push({ name: 'Build', run: pm + ' run build' });
  if (o.test) steps.push({ name: 'Run project tests', run: pm + ' test' });
  return { steps, notes };
}

function goSteps(o: ResolvedOptions): PresetSteps {
  const versionInput = o.runtimeVersions.length === 0 ? { 'go-version-file': 'go.mod' } : { 'go-version': runtime(o) };
  const steps: Step[] = [
    { name: 'Set up Go', uses: PINNED_ACTIONS.setupGo, with: { ...versionInput, ...(o.cache ? {} : { cache: 'false' }) } },
  ];
  if (o.lint) steps.push({ name: 'Vet', run: 'go vet ./...' });
  if (o.build) steps.push({ name: 'Build', run: 'go build ./...' });
  if (o.test) steps.push({ name: 'Run project tests', run: 'go test ./...' });
  return { steps, notes: [] };
}

function pythonSteps(o: ResolvedOptions): PresetSteps {
  const steps: Step[] = [
    {
      name: 'Set up Python', uses: PINNED_ACTIONS.setupPython,
      with: { 'python-version': runtime(o), ...(o.cache ? { cache: 'pip' } : {}) },
    },
    {
      name: 'Install test dependencies',
      run: ['python -m pip install --upgrade pip pytest', 'if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi'],
    },
  ];
  if (o.lint) steps.push({ name: 'Lint', run: 'python -m ruff check .' });
  if (o.test) steps.push({ name: 'Run project tests', run: 'python -m pytest' });
  return { steps, notes: [] };
}

function javaSteps(o: ResolvedOptions): PresetSteps {
  const maven = o.preset === 'java-maven';
  const tool = maven ? 'maven' : 'gradle';
  const steps: Step[] = [{
    name: 'Set up Java', uses: PINNED_ACTIONS.setupJava,
    with: { distribution: 'temurin', 'java-version': runtime(o), ...(o.cache ? { cache: tool } : {}) },
  }];
  if (o.build) steps.push({ name: 'Build', run: maven ? 'mvn --batch-mode -DskipTests package' : 'sh ./gradlew --no-daemon assemble' });
  if (o.test) steps.push(maven
    ? { name: 'Verify Maven project', run: 'mvn --batch-mode verify' }
    : { name: 'Run project tests', run: 'sh ./gradlew --no-daemon test' });
  return { steps, notes: o.preset === 'java-gradle' ? ['Gradle wrapper validation is not added (no verified pinned action).'] : [] };
}

function phpSteps(o: ResolvedOptions): PresetSteps {
  const steps: Step[] = [];
  if (o.lint) steps.push({ name: 'Validate composer.json', run: 'composer validate --strict' });
  steps.push({ name: 'Install locked dependencies', run: 'composer install --no-interaction --prefer-dist --no-progress' });
  if (o.test) steps.push({ name: 'Run project tests', run: 'vendor/bin/phpunit' });
  return { steps, notes: ['PHP and Composer come from the runner image; no setup action is used.'] };
}

const dockerSteps: PresetSteps = {
  steps: [{ name: 'Build image (not pushed)', run: 'docker buildx build --load --tag orquestivo-ci:ci .' }],
  notes: [],
};

/** Steps of the main verify job (after checkout). */
export function presetSteps(o: ResolvedOptions): PresetSteps {
  switch (o.preset) {
    case 'node': case 'typescript': case 'react': case 'next': return nodeSteps(o);
    case 'go': return goSteps(o);
    case 'python': return pythonSteps(o);
    case 'java-maven': case 'java-gradle': return javaSteps(o);
    case 'php': return phpSteps(o);
    case 'docker': return dockerSteps;
  }
}

/** Dependency audit commands run in the dedicated security job. */
export function auditSteps(o: ResolvedOptions): readonly Step[] {
  if (o.preset === 'php') return [{ name: 'Audit dependencies', run: 'composer audit' }];
  const pm = o.packageManager;
  return [...(pm === 'npm' ? [] : [corepackStep]), { name: 'Audit dependencies', run: AUDIT[pm] }];
}
