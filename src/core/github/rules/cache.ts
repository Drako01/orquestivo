import { actionName, asString, withInputs } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const SETUP_CACHE_MISSING = meta('SETUP_CACHE_MISSING', 'information', 'performance',
  'Reinstalling dependencies on every run slows CI and increases registry traffic.',
  'Set the cache input (for example cache: npm) on the setup action.', DOCS.cache);
const CACHE_KEY_NO_HASHFILES = meta('CACHE_KEY_NO_HASHFILES', 'warning', 'reliability',
  'A cache key that does not hash dependency files is never invalidated, so stale dependencies are restored.',
  "Include hashFiles('<lockfile>') in the cache key.", DOCS.cache);

const CACHING_SETUPS: ReadonlySet<string> = new Set(['actions/setup-node', 'actions/setup-java']);
const CACHE_ACTIONS: ReadonlySet<string> = new Set(['actions/cache', 'actions/cache/save', 'actions/cache/restore']);

export const cacheRule: Rule = {
  id: 'cache',
  metas: [SETUP_CACHE_MISSING, CACHE_KEY_NO_HASHFILES],
  check(ctx) {
    for (const { step, path } of ctx.steps) {
      const name = actionName(step) ?? '';
      const inputs = withInputs(step);
      if (CACHING_SETUPS.has(name) && inputs.cache === undefined) {
        ctx.report(SETUP_CACHE_MISSING, name + ' runs without dependency caching.', [...path, 'uses']);
      }
      if (CACHE_ACTIONS.has(name)) {
        const key = asString(inputs.key);
        if (key !== undefined && !/hashFiles\s*\(/i.test(key)) {
          ctx.report(CACHE_KEY_NO_HASHFILES, 'Cache key does not use hashFiles().', [...path, 'with', 'key'], { snippet: key });
        }
      }
    }
  },
};
