import { type CanonicalPreset, type Preset, PRESETS } from './types.js';

/** Marker groups: every group must be satisfied by at least one of its files. */
export interface PresetRequirement {
  readonly label: string;
  readonly markers: readonly (readonly string[])[];
  readonly recommended: readonly string[];
  /** What static generation cannot prove; only a real CI run confirms these. */
  readonly needsRealExecution: readonly string[];
}

/** Single source of truth for preset prerequisites (consumed by the UI and the docs). */
export const PRESET_REQUIREMENTS: Readonly<Record<CanonicalPreset, PresetRequirement>> = {
  node: {
    label: 'Node.js',
    markers: [['package.json'], ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']],
    recommended: [],
    needsRealExecution: ['The test script exists and passes', 'The lockfile matches the chosen package manager'],
  },
  typescript: {
    label: 'TypeScript',
    markers: [['package.json'], ['tsconfig.json'], ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']],
    recommended: [],
    needsRealExecution: ['`tsc` is installed as a dependency and the project type-checks', 'The test script exists and passes'],
  },
  react: {
    label: 'React',
    markers: [['package.json'], ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']],
    recommended: [],
    needsRealExecution: ['The build and test scripts exist and pass'],
  },
  next: {
    label: 'Next.js',
    markers: [['package.json'], ['next.config.js', 'next.config.mjs', 'next.config.ts'], ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']],
    recommended: [],
    needsRealExecution: ['`next build` succeeds without runtime secrets', '.next/cache is only cached when a pinned actions/cache SHA is supplied'],
  },
  go: {
    label: 'Go',
    markers: [['go.mod']],
    recommended: ['go.sum'],
    needsRealExecution: ['Tests pass on the selected Go version'],
  },
  python: {
    label: 'Python',
    markers: [['requirements.txt', 'pyproject.toml']],
    recommended: [],
    needsRealExecution: ['pytest is installed through project dependencies', 'ruff is a dependency when lint is enabled', 'pip caching needs a requirements.txt'],
  },
  'java-maven': {
    label: 'Java (Maven)',
    markers: [['pom.xml']],
    recommended: [],
    needsRealExecution: ['`mvn verify` passes on the selected JDK'],
  },
  'java-gradle': {
    label: 'Java (Gradle)',
    markers: [['build.gradle', 'build.gradle.kts'], ['gradlew']],
    recommended: ['gradle/wrapper/gradle-wrapper.properties'],
    needsRealExecution: ['The Gradle wrapper is trusted (no wrapper validation action is added)', '`gradlew test` passes on the selected JDK'],
  },
  php: {
    label: 'PHP (Composer)',
    markers: [['composer.json']],
    recommended: ['composer.lock'],
    needsRealExecution: ['The runner PHP and Composer versions match the project', 'vendor/bin/phpunit exists after install'],
  },
  docker: {
    label: 'Docker',
    markers: [['Dockerfile']],
    recommended: ['.dockerignore'],
    needsRealExecution: ['The image builds on the runner; nothing is pushed or scanned'],
  },
};

export function canonicalPreset(preset: Preset): CanonicalPreset {
  return preset === 'maven' ? 'java-maven' : preset;
}

/** Returns the marker groups not satisfied by `fileNames` (empty when ready). */
export function missingMarkers(preset: Preset, fileNames: readonly string[]): readonly (readonly string[])[] {
  const present = new Set(fileNames);
  return PRESET_REQUIREMENTS[canonicalPreset(preset)].markers.filter((group) => !group.some((f) => present.has(f)));
}

export function isPreset(value: unknown): value is Preset {
  return typeof value === 'string' && (PRESETS as readonly string[]).includes(value);
}

/** What each preset can express; option validation rejects anything outside it. */
export interface PresetCapabilities {
  readonly lint: boolean;
  readonly build: boolean;
  readonly test: boolean;
  readonly runtimeVersions: boolean;
  readonly nonLinuxRunners: boolean;
  readonly packageManagers: boolean;
  readonly audit: boolean;
  readonly codeqlLanguage?: string;
  readonly codeqlNeedsBuild: boolean;
  readonly defaultLint: boolean;
  readonly defaultBuild: boolean;
  readonly defaultCache: boolean;
  readonly defaultVersion?: string;
}

const nodeFamily = {
  lint: true, build: true, test: true, runtimeVersions: true, nonLinuxRunners: true,
  packageManagers: true, audit: true, codeqlLanguage: 'javascript-typescript', codeqlNeedsBuild: false,
  defaultLint: false, defaultBuild: false, defaultCache: true, defaultVersion: '22',
} as const satisfies PresetCapabilities;
const java = {
  lint: false, build: true, test: true, runtimeVersions: true, nonLinuxRunners: true,
  packageManagers: false, audit: false, codeqlLanguage: 'java-kotlin', codeqlNeedsBuild: true,
  defaultLint: false, defaultBuild: false, defaultCache: true, defaultVersion: '21',
} as const satisfies PresetCapabilities;

export const PRESET_CAPABILITIES: Readonly<Record<CanonicalPreset, PresetCapabilities>> = {
  node: nodeFamily,
  typescript: { ...nodeFamily, defaultLint: true },
  react: { ...nodeFamily, defaultBuild: true },
  next: { ...nodeFamily, defaultBuild: true },
  go: {
    lint: true, build: true, test: true, runtimeVersions: true, nonLinuxRunners: true,
    packageManagers: false, audit: false, codeqlLanguage: 'go', codeqlNeedsBuild: true,
    defaultLint: false, defaultBuild: false, defaultCache: true,
  },
  python: {
    lint: true, build: false, test: true, runtimeVersions: true, nonLinuxRunners: true,
    packageManagers: false, audit: false, codeqlLanguage: 'python', codeqlNeedsBuild: false,
    defaultLint: false, defaultBuild: false, defaultCache: false, defaultVersion: '3.12',
  },
  'java-maven': java,
  'java-gradle': java,
  php: {
    lint: true, build: false, test: true, runtimeVersions: false, nonLinuxRunners: false,
    packageManagers: false, audit: true, codeqlNeedsBuild: false,
    defaultLint: false, defaultBuild: false, defaultCache: false,
  },
  docker: {
    lint: false, build: true, test: false, runtimeVersions: false, nonLinuxRunners: false,
    packageManagers: false, audit: false, codeqlNeedsBuild: false,
    defaultLint: false, defaultBuild: true, defaultCache: false,
  },
};
