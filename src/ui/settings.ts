/** Typed, clamped settings shared by the extension host and the presenters. Pure. */
export const EXPERIENCE_LEVELS = ['beginner', 'advanced', 'expert'] as const;
export type ExperienceLevel = typeof EXPERIENCE_LEVELS[number];
export const DEFAULT_EXPERIENCE_LEVEL: ExperienceLevel = 'beginner';

export function parseExperienceLevel(value: unknown): ExperienceLevel {
  return (EXPERIENCE_LEVELS as readonly unknown[]).includes(value) ? value as ExperienceLevel : DEFAULT_EXPERIENCE_LEVEL;
}

export interface IntRange { readonly min: number; readonly max: number; readonly fallback: number }

/** Mirrors the `contributes.configuration` schema; a test keeps both in sync. */
export const ANALYSIS_LIMITS = {
  maxFiles: { min: 1, max: 1000, fallback: 150 },
  maxFileBytes: { min: 1024, max: 10_485_760, fallback: 1_048_576 },
} as const satisfies Record<string, IntRange>;

export function clampInt(value: unknown, range: IntRange): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

/** 1-based line from untrusted input; anything unusable becomes line 1. */
export function toLine(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 1;
}
