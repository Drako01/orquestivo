import type { GeneratorOptions, PackageManager, Preset } from './types.js';

export interface PresetRecommendation {
  readonly preset: Preset;
  readonly options: Omit<GeneratorOptions, 'preset'>;
  readonly reasons: readonly string[];
}

export interface StackDetection {
  /** Best single starting point, if any marker file was found. */
  readonly primary?: PresetRecommendation | undefined;
  /** Every applicable preset, primary first. */
  readonly recommendations: readonly PresetRecommendation[];
  readonly warnings: readonly string[];
}

type Mapping = Readonly<Record<string, unknown>>;
const asMap = (value: unknown): Mapping | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Mapping : undefined;

/** Lockfile precedence when several exist and `packageManager` does not decide. */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
];

function declaredManager(pkg: Mapping | undefined): PackageManager | undefined {
  const field = pkg?.packageManager;
  if (typeof field !== 'string') return undefined;
  const name = field.split('@')[0];
  return name === 'npm' || name === 'pnpm' || name === 'yarn' ? name : undefined;
}

function hasDependency(pkg: Mapping | undefined, name: string): boolean {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => {
    const group = asMap(pkg?.[key]);
    return group !== undefined && name in group;
  });
}

function nodeRecommendation(files: ReadonlySet<string>, pkg: Mapping | undefined, warnings: string[]): PresetRecommendation {
  const reasons = ['package.json found'];
  const locks = LOCKFILES.filter(([file]) => files.has(file));
  if (locks.length > 1) warnings.push('Several lockfiles found (' + locks.map(([f]) => f).join(', ') + '); set "packageManager" in package.json.');
  const manager = declaredManager(pkg) ?? locks[0]?.[1];
  if (manager === undefined) warnings.push('No lockfile found; "npm ci" and cached installs need one.');
  else reasons.push('package manager: ' + manager);

  const isNext = files.has('next.config.js') || files.has('next.config.mjs') || files.has('next.config.ts') || hasDependency(pkg, 'next');
  const isReact = !isNext && hasDependency(pkg, 'react');
  const isTypescript = files.has('tsconfig.json') || hasDependency(pkg, 'typescript');
  const preset: Preset = isNext ? 'next' : isReact ? 'react' : isTypescript ? 'typescript' : 'node';
  if (preset !== 'node') reasons.push('detected ' + preset);

  const scripts = asMap(pkg?.scripts);
  const has = (name: string): boolean => typeof scripts?.[name] === 'string';
  const options: Omit<GeneratorOptions, 'preset'> = {
    ...(manager && manager !== 'npm' ? { packageManager: manager } : {}),
    ...(scripts ? { test: has('test'), build: has('build'), lint: has('lint') || (preset === 'typescript') } : {}),
  };
  return { preset, options, reasons };
}

/**
 * Recommends presets from the root-level file names of a workspace. Only entries
 * without a directory component count, because workflows run from the repository root.
 */
export function detectStack(fileNames: readonly string[], packageJson?: unknown): StackDetection {
  const files = new Set(fileNames.map((n) => n.replace(/\\/g, '/')).filter((n) => !n.includes('/')));
  const warnings: string[] = [];
  const found: PresetRecommendation[] = [];
  const add = (preset: Preset, reason: string): void => { found.push({ preset, options: {}, reasons: [reason] }); };

  if (files.has('package.json')) found.push(nodeRecommendation(files, asMap(packageJson), warnings));
  if (files.has('go.mod')) add('go', 'go.mod found');
  if (files.has('requirements.txt') || files.has('pyproject.toml')) add('python', files.has('pyproject.toml') ? 'pyproject.toml found' : 'requirements.txt found');
  if (files.has('pom.xml')) add('java-maven', 'pom.xml found');
  if (files.has('build.gradle') || files.has('build.gradle.kts')) {
    if (files.has('gradlew')) add('java-gradle', 'Gradle build file and wrapper found');
    else warnings.push('Gradle build file found without gradlew; commit the wrapper to use the java-gradle preset.');
  }
  if (files.has('composer.json')) add('php', 'composer.json found');
  if (files.has('Dockerfile')) add('docker', 'Dockerfile found');

  return { primary: found[0], recommendations: found, warnings };
}
