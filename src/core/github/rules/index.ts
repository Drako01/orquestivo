import type { Rule } from '../context.js';
import type { RuleMeta } from '../rule.js';
import { actionsRule } from './actions.js';
import { artifactsRule } from './artifacts.js';
import { cacheRule } from './cache.js';
import { containersRule } from './containers.js';
import { deployRule } from './deploy.js';
import { expressionsRule } from './expressions.js';
import { matrixRule } from './matrix.js';
import { needsRule } from './needs.js';
import { permissionsRule } from './permissions.js';
import { reliabilityRule } from './reliability.js';
import { reusableRule } from './reusable.js';
import { scriptsRule } from './scripts.js';
import { structureRule } from './structure.js';
import { ENGINE_METAS } from './syntax.js';
import { timeoutsRule } from './timeouts.js';
import { triggersRule } from './triggers.js';

/** Registry: add a rule module here and nothing else changes (open/closed). */
export const GITHUB_RULES: readonly Rule[] = [
  structureRule, triggersRule, needsRule, permissionsRule, expressionsRule, matrixRule, reusableRule,
  deployRule, artifactsRule, cacheRule, timeoutsRule, scriptsRule, actionsRule, containersRule, reliabilityRule,
];

/** Every stable rule code with its metadata (engine-level codes included). */
export const GITHUB_RULE_CATALOG: readonly RuleMeta[] = [...ENGINE_METAS, ...GITHUB_RULES.flatMap((r) => r.metas)];
