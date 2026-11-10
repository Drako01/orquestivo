import { asMap, asString } from '../context.js';
import type { Path, Rule, RuleContext } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';
import { untrustedContexts } from '../untrusted.js';

const EXPRESSION_IN_SCRIPT = meta('EXPRESSION_IN_SCRIPT', 'warning', 'security',
  'Event fields such as titles and branch names are attacker-controlled; interpolating them into a script enables command injection.',
  'Pass the value through an env variable and reference it quoted in the script.', DOCS.scriptInjection);
const SECRET_ECHO = meta('SECRET_ECHO', 'warning', 'security',
  'Printing a secret writes it to the log; masking is best-effort and defeated by transformations.',
  'Never echo secrets; pass them to the tool through env or stdin.', DOCS.hardening);
const CURL_PIPE_SHELL = meta('CURL_PIPE_SHELL', 'warning', 'security',
  'Piping a download into a shell runs unverified remote code with the job token and secrets.',
  'Download to a file, verify a pinned checksum or signature, then execute it.', DOCS.hardening);
const DEPRECATED_SET_OUTPUT = meta('DEPRECATED_SET_OUTPUT', 'warning', 'maintainability',
  'The set-output and save-state commands are deprecated and may stop working.',
  'Append name=value to the $GITHUB_OUTPUT (or $GITHUB_STATE) file instead.', DOCS.workflowCommands);
const DEPRECATED_SET_ENV = meta('DEPRECATED_SET_ENV', 'error', 'security',
  'The set-env and add-path commands are disabled because they enabled environment injection.',
  'Append to $GITHUB_ENV or $GITHUB_PATH instead.', DOCS.workflowCommands);

const ECHOES_SECRET = /\b(?:echo|printf|Write-Host|Write-Output)\b[^\n]*\$\{\{\s*secrets\./i;
const PIPES_TO_SHELL = /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i;

/** A line that redirects or pipes its output is consuming the value, not printing it. */
const printsToLog = (line: string): boolean => ECHOES_SECRET.test(line) && !/[>|]/.test(line);

const isGithubScript = (uses: unknown): boolean => typeof uses === 'string' && /^actions\/github-script@/i.test(uses);

/** Reports the untrusted expressions found in `text`; `advice` says how to pass the value safely for that kind of script. */
function reportUntrusted(ctx: RuleContext, text: string, where: Path, kind: string, advice: string): void {
  const tainted = untrustedContexts(text);
  if (tainted.length === 0) return;
  ctx.report(EXPRESSION_IN_SCRIPT,
    'Untrusted expression(s) ' + tainted.join(', ') + ' are interpolated into a ' + kind + '; ' + advice,
    where, { snippet: tainted[0] as string });
}

export const scriptsRule: Rule = {
  id: 'scripts',
  metas: [EXPRESSION_IN_SCRIPT, SECRET_ECHO, CURL_PIPE_SHELL, DEPRECATED_SET_OUTPUT, DEPRECATED_SET_ENV],
  check(ctx) {
    for (const { step, path } of ctx.steps) {
      const script = asString(asMap(step.with)?.script);
      if (isGithubScript(step.uses) && script !== undefined) {
        reportUntrusted(ctx, script, [...path, 'with', 'script'], 'github-script program', 'read them from env instead.');
      }
      const run = asString(step.run);
      if (run === undefined) continue;
      const where = [...path, 'run'];
      reportUntrusted(ctx, run, where, 'shell script', 'use a quoted environment variable.');
      const echoed = run.split('\n').find(printsToLog);
      if (echoed !== undefined) ctx.report(SECRET_ECHO, 'A secret is printed to the log by this script.', where, { snippet: echoed.trim() });
      if (PIPES_TO_SHELL.test(run)) ctx.report(CURL_PIPE_SHELL, 'A remote download is piped straight into a shell.', where);
      if (/::(?:set-output|save-state)\b/.test(run)) {
        ctx.report(DEPRECATED_SET_OUTPUT, 'Deprecated set-output/save-state workflow command.', where,
          { fix: 'echo "name=value" >> "$GITHUB_OUTPUT"' });
      }
      if (/::(?:set-env|add-path)\b/.test(run)) {
        ctx.report(DEPRECATED_SET_ENV, 'Disabled set-env/add-path workflow command.', where,
          { fix: 'echo "NAME=value" >> "$GITHUB_ENV"' });
      }
    }
  },
};
