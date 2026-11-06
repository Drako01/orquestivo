import { asMap, positiveInt } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { hasExpression } from '../expressions.js';
import { meta } from '../rule.js';

const MATRIX_EMPTY = meta('MATRIX_EMPTY', 'error', 'semantic',
  'A matrix without values (or with an empty axis) produces zero jobs; GitHub fails the run.',
  'Give every axis at least one value, or drop the matrix.', DOCS.matrix);
const MATRIX_INVALID = meta('MATRIX_INVALID', 'error', 'syntax',
  'Matrix axes must be lists, and include/exclude must be lists of mappings.',
  'Use strategy.matrix.<axis>: [values] and include/exclude: [{key: value}].', DOCS.matrix);
const MATRIX_UNKNOWN_KEY = meta('MATRIX_UNKNOWN_KEY', 'warning', 'semantic',
  'An exclude entry that names a key absent from the matrix never matches, so nothing is excluded.',
  'Fix the key name or remove the exclude entry.', DOCS.matrix);
const MATRIX_STRATEGY_INVALID = meta('MATRIX_STRATEGY_INVALID', 'error', 'semantic',
  'fail-fast must be a boolean and max-parallel a positive integer (or expressions).',
  'Use fail-fast: true|false and max-parallel: <positive integer>.', DOCS.matrix);

const RESERVED = new Set(['include', 'exclude']);

export const matrixRule: Rule = {
  id: 'matrix',
  metas: [MATRIX_EMPTY, MATRIX_INVALID, MATRIX_UNKNOWN_KEY, MATRIX_STRATEGY_INVALID],
  check(ctx) {
    for (const { id, job, path } of ctx.jobs) {
      const strategy = asMap(job.strategy);
      if (!strategy) continue;
      const where = [...path, 'strategy'];
      const failFast = strategy['fail-fast'];
      if (failFast !== undefined && typeof failFast !== 'boolean' && !hasExpression(failFast)) {
        ctx.report(MATRIX_STRATEGY_INVALID, 'Job "' + id + '" fail-fast must be a boolean.', [...where, 'fail-fast']);
      }
      const parallel = strategy['max-parallel'];
      if (parallel !== undefined && !positiveInt(parallel) && !hasExpression(parallel)) {
        ctx.report(MATRIX_STRATEGY_INVALID, 'Job "' + id + '" max-parallel must be a positive integer.', [...where, 'max-parallel']);
      }
      if (strategy.matrix === undefined || hasExpression(strategy.matrix)) continue;
      const matrixPath = [...where, 'matrix'];
      const matrix = asMap(strategy.matrix);
      if (!matrix) {
        const empty = strategy.matrix === null;
        ctx.report(empty ? MATRIX_EMPTY : MATRIX_INVALID,
          'Job "' + id + '" matrix ' + (empty ? 'is empty.' : 'must be a mapping.'), matrixPath);
        continue;
      }
      const axes = Object.entries(matrix).filter(([key]) => !RESERVED.has(key));
      const include = matrix.include;
      for (const [axis, values] of axes) {
        if (hasExpression(values)) continue;
        if (!Array.isArray(values)) {
          ctx.report(MATRIX_INVALID, 'Matrix axis "' + axis + '" of "' + id + '" must be a list.', [...matrixPath, axis]);
        } else if (values.length === 0) {
          ctx.report(MATRIX_EMPTY, 'Matrix axis "' + axis + '" of "' + id + '" has no values.', [...matrixPath, axis]);
        }
      }
      if (axes.length === 0 && (include === undefined || (Array.isArray(include) && include.length === 0))) {
        ctx.report(MATRIX_EMPTY, 'Job "' + id + '" matrix defines no axes.', matrixPath);
      }
      const axisNames = new Set(axes.map(([key]) => key));
      for (const field of RESERVED) {
        const entries = matrix[field];
        if (entries === undefined || hasExpression(entries)) continue;
        if (!Array.isArray(entries) || entries.some((entry) => !asMap(entry))) {
          ctx.report(MATRIX_INVALID, 'Matrix ' + field + ' of "' + id + '" must be a list of mappings.', [...matrixPath, field]);
          continue;
        }
        if (field === 'include') continue;
        for (const [index, entry] of entries.entries()) {
          for (const key of Object.keys(asMap(entry) ?? {})) {
            if (!axisNames.has(key)) {
              ctx.report(MATRIX_UNKNOWN_KEY, 'Matrix exclude references unknown key "' + key + '".', [...matrixPath, field, index]);
            }
          }
        }
      }
    }
  },
};
