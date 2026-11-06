import { asMap, asString, permissionsOf } from '../context.js';
import type { JobInfo, Path, Rule, RuleContext } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const PERMISSIONS_UNDECLARED = meta('PERMISSIONS_UNDECLARED', 'information', 'security',
  'Without explicit permissions the token inherits repository defaults, which may be broader than needed.',
  'Add a top-level permissions: block, usually contents: read.', DOCS.permissions);
const PERMISSIONS_WRITE_ALL = meta('PERMISSIONS_WRITE_ALL', 'warning', 'security',
  'write-all grants every token scope; a compromised step can modify the repository.',
  'Replace write-all with the specific scopes the job needs.', DOCS.permissions);
const PERMISSIONS_WRITE_REVIEW = meta('PERMISSIONS_WRITE_REVIEW', 'information', 'security',
  'Write scopes widen the blast radius of a compromised step.',
  'Confirm each write scope is required, and scope it to the job that needs it.', DOCS.permissions);
const PERMISSIONS_UNKNOWN_SCOPE = meta('PERMISSIONS_UNKNOWN_SCOPE', 'error', 'semantic',
  'GitHub rejects permission scopes it does not know, invalidating the workflow.',
  'Use a valid scope such as contents, pull-requests or id-token.', DOCS.permissions);
const PERMISSIONS_INVALID_VALUE = meta('PERMISSIONS_INVALID_VALUE', 'error', 'semantic',
  'Permission values must be read, write or none; anything else invalidates the workflow.',
  'Use read, write or none (read-all / write-all / {} for the whole block).', DOCS.permissions);
const ID_TOKEN_WITHOUT_NEED = meta('ID_TOKEN_WITHOUT_NEED', 'warning', 'security',
  'id-token: write lets the job mint OIDC tokens; granting it without a consumer is needless exposure.',
  'Remove id-token: write unless a step authenticates with OIDC (cloud login, attestations, provenance).', DOCS.oidc);

export const PERMISSION_SCOPES: ReadonlySet<string> = new Set([
  'actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token', 'issues', 'models',
  'packages', 'pages', 'pull-requests', 'repository-projects', 'security-events', 'statuses',
]);
const LEVELS: ReadonlySet<string> = new Set(['read', 'write', 'none']);
const OIDC_CONSUMERS = /aws-actions\/configure-aws-credentials|azure\/login|google-github-actions\/auth|hashicorp\/vault-action|actions\/attest|sigstore\/|slsa-framework\/|actions\/deploy-pages/i;
const OIDC_SCRIPT = /ACTIONS_ID_TOKEN_REQUEST|cosign|--provenance|id-token/i;

const consumesOidc = (ctx: RuleContext, info: JobInfo): boolean =>
  info.reusable || ctx.steps.some((s) => s.job === info &&
    (OIDC_CONSUMERS.test(asString(s.step.uses) ?? '') || OIDC_SCRIPT.test(asString(s.step.run) ?? '')));

function checkBlock(ctx: RuleContext, value: unknown, path: Path, subject: string): void {
  if (typeof value === 'string') {
    if (value !== 'read-all' && value !== 'write-all') {
      ctx.report(PERMISSIONS_INVALID_VALUE, subject + ' permissions "' + value + '" must be read-all, write-all or a mapping.', path);
    }
    return;
  }
  if (value === undefined || value === null) return;
  const scopes = asMap(value);
  if (!scopes) {
    ctx.report(PERMISSIONS_INVALID_VALUE, subject + ' permissions must be a mapping, read-all or write-all.', path);
    return;
  }
  for (const [scope, level] of Object.entries(scopes)) {
    if (!PERMISSION_SCOPES.has(scope)) {
      ctx.report(PERMISSIONS_UNKNOWN_SCOPE, 'Unknown permission scope "' + scope + '" in ' + subject + '.', [...path, scope]);
    } else if (typeof level !== 'string' || !LEVELS.has(level) || (scope === 'id-token' && level === 'read')) {
      ctx.report(PERMISSIONS_INVALID_VALUE,
        'Invalid level for "' + scope + '" in ' + subject + '; expected ' + (scope === 'id-token' ? 'write or none' : 'read, write or none') + '.',
        [...path, scope]);
    }
  }
  if (Object.values(scopes).includes('write')) {
    ctx.report(PERMISSIONS_WRITE_REVIEW,
      subject === 'workflow' ? 'Review workflow token write scopes for least privilege.' : 'Review write permissions for ' + subject + '.', path);
  }
}

export const permissionsRule: Rule = {
  id: 'permissions',
  metas: [PERMISSIONS_UNDECLARED, PERMISSIONS_WRITE_ALL, PERMISSIONS_WRITE_REVIEW,
    PERMISSIONS_UNKNOWN_SCOPE, PERMISSIONS_INVALID_VALUE, ID_TOKEN_WITHOUT_NEED],
  check(ctx) {
    const everyJobDeclares = ctx.jobs.length > 0 && ctx.jobs.every((j) => Object.hasOwn(j.job, 'permissions'));
    if (!Object.hasOwn(ctx.root, 'permissions') && !everyJobDeclares) {
      ctx.report(PERMISSIONS_UNDECLARED, 'Explicit minimal GITHUB_TOKEN permissions improve security auditability.', ['jobs']);
    }
    if (ctx.root.permissions === 'write-all') {
      ctx.report(PERMISSIONS_WRITE_ALL, 'Replace write-all with least-privilege token scopes.', ['permissions']);
    }
    checkBlock(ctx, ctx.root.permissions, ['permissions'], 'workflow');

    for (const info of ctx.jobs) {
      const where = [...info.path, 'permissions'];
      const subject = 'job "' + info.id + '"';
      if (info.job.permissions === 'write-all') {
        ctx.report(PERMISSIONS_WRITE_ALL, 'Job "' + info.id + '" requests write-all permissions.', where);
      }
      checkBlock(ctx, info.job.permissions, where, subject);
      const effective = asMap(permissionsOf(ctx, info.job));
      if (effective?.['id-token'] === 'write' && !consumesOidc(ctx, info)) {
        const own = Object.hasOwn(info.job, 'permissions');
        ctx.report(ID_TOKEN_WITHOUT_NEED, 'Job "' + info.id + '" has id-token: write but no step consumes an OIDC token.',
          own ? where : ['permissions']);
      }
    }
  },
};
