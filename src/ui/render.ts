import { renderGraphText } from '../core/analysis/graph.js';
import type { IntentResult } from '../core/evidence/intent.js';
import type { RunEvidence } from '../core/evidence/run-evidence.js';
import type { EvidenceBasis, Verdict } from '../core/evidence/verdict.js';
import type { Category, Finding, Severity, VerificationState } from '../core/types.js';
import type { TextKey, Translate } from '../i18n.js';
import { redactSecrets } from '../security/redact.js';
import { CLIENT_SCRIPT } from './client-script.js';
import { escapeHtml as esc, safeHttpUrl } from './escape.js';
import { renderGraphSvg } from './graph-svg.js';
import { EXPERIENCE_LEVELS, type ExperienceLevel } from './settings.js';
import { STYLES } from './styles.js';
import { CATEGORIES, SEVERITIES, type FileView, type FindingView, type IntentGroupView, type ViewModel } from './view-model.js';

export interface RenderEnv {
  readonly nonce: string;
  readonly cspSource: string;
  readonly language: string;
  readonly logoUri: string;
  readonly t: Translate;
}

const SEVERITY_ICON: Readonly<Record<Severity, string>> = { error: '✖', warning: '▲', information: 'ℹ' };
const SEVERITY_KEY: Readonly<Record<Severity, TextKey>> = { error: 'severityError', warning: 'severityWarning', information: 'severityInformation' };
const CATEGORY_KEY: Readonly<Record<Category, TextKey>> = {
  syntax: 'categorySyntax', semantic: 'categorySemantic', configuration: 'categoryConfiguration', security: 'categorySecurity',
  reliability: 'categoryReliability', performance: 'categoryPerformance', maintainability: 'categoryMaintainability',
};
const VERDICT_ICON: Readonly<Record<Verdict, string>> = { PASS: '✔', FAIL: '✖', WARN: '▲', SKIP: '↷', INCONCLUSIVE: '?', BLOCKED: '⊘' };
const VERDICT_KEY: Readonly<Record<Verdict, TextKey>> = {
  PASS: 'verdictPass', FAIL: 'verdictFail', WARN: 'verdictWarn', SKIP: 'verdictSkip', INCONCLUSIVE: 'verdictInconclusive', BLOCKED: 'verdictBlocked',
};
const BASIS_KEY: Readonly<Record<EvidenceBasis, TextKey>> = { 'static-inference': 'basisStatic', 'remote-evidence': 'basisRemote' };
const VERIFICATION_KEY: Readonly<Record<VerificationState, TextKey>> = {
  'static-only': 'verificationStaticOnly', 'execution-unverified': 'verificationUnverified', 'executed-verified': 'verificationExecuted',
};
const LEVEL_KEY: Readonly<Record<ExperienceLevel, TextKey>> = { beginner: 'levelBeginner', advanced: 'levelAdvanced', expert: 'levelExpert' };
const MAX_RUNS_SHOWN = 10;

const button = (id: string, label: string, attrs: string, primary = false): string =>
  `<button type="button" id="${esc(id)}"${primary ? ' class="primary"' : ''} ${attrs}>${esc(label)}</button>`;

function renderSeverity(severity: Severity, t: Translate): string {
  return `<span class="sev"><span aria-hidden="true">${SEVERITY_ICON[severity]}</span> ${esc(t(SEVERITY_KEY[severity]))}</span>`;
}

function renderVerdict(verdict: Verdict, t: Translate): string {
  return `<span class="verdict v-${verdict}"><span aria-hidden="true">${VERDICT_ICON[verdict]}</span> ${esc(t(VERDICT_KEY[verdict]))}</span>`;
}

function link(url: string | undefined, label: string): string {
  const safe = safeHttpUrl(url);
  return safe ? `<a href="${esc(safe)}">${esc(label)}</a>` : '';
}

function renderFindingDetails(f: Finding, level: ExperienceLevel, t: Translate): string {
  const rows: string[] = [];
  const row = (key: TextKey, html: string): void => { rows.push(`<dt>${esc(t(key))}</dt><dd>${html}</dd>`); };
  if (level !== 'beginner') {
    row('detailCode', `<code>${esc(f.code)}</code>`);
    row('detailCategory', esc(t(CATEGORY_KEY[f.category])));
    row('detailEvidence', esc(t(f.evidence === 'static' ? 'evidenceStatic' : 'evidenceExecuted')));
    if (f.snippet) row('detailSnippet', `<pre>${esc(redactSecrets(f.snippet))}</pre>`);
    const docs = link(f.docs, t('detailDocsLink'));
    if (docs) row('detailDocs', docs);
  }
  if (level === 'expert') {
    row('detailVerification', esc(t(VERIFICATION_KEY[f.verification])));
    if (f.fix) row('detailFix', `<pre>${esc(redactSecrets(f.fix))}</pre>`);
    const meta = { code: f.code, severity: f.severity, category: f.category, line: f.line, column: f.column ?? null, evidence: f.evidence, verification: f.verification };
    row('detailMetadata', `<pre>${esc(JSON.stringify(meta, null, 2))}</pre>`);
  }
  return rows.length ? `<dl>${rows.join('')}</dl>` : '';
}

function renderFinding(view: FindingView, level: ExperienceLevel, aiEnabled: boolean, t: Translate): string {
  const f = view.finding;
  const head = level === 'beginner' ? '' : `<code>${esc(f.code)}</code> <span class="chip">${esc(t(CATEGORY_KEY[f.category]))}</span> `;
  const explain = aiEnabled
    ? ` ${button(`explain-${view.key}`, t('actionExplain'), `data-action="explain" data-file="${view.fileId}" data-index="${view.index}"`)}` : '';
  const impact = `<dl><dt>${esc(t('detailImpact'))}</dt><dd>${esc(redactSecrets(f.impact))}</dd><dt>${esc(t('detailRecommendation'))}</dt><dd>${esc(redactSecrets(f.recommendation))}</dd></dl>`;
  return `<li class="finding sev-${f.severity}" id="finding-${esc(view.key)}">`
    + `<div class="finding-head">${renderSeverity(f.severity, t)} ${head}<span>${esc(redactSecrets(f.message))}</span></div>`
    + `<p class="muted">${esc(t('lineLabel', { line: f.line }))} `
    + `${button(`open-${view.key}`, t('actionOpenLine'), `data-action="open" data-file="${view.fileId}" data-line="${f.line}"`)}${explain}</p>`
    + `${impact}${renderFindingDetails(f, level, t)}</li>`;
}

function renderFile(file: FileView, level: ExperienceLevel, aiEnabled: boolean, t: Translate): string {
  const counts = SEVERITIES.map((s) => `${file.counts[s]} ${t(SEVERITY_KEY[s])}`).join(' · ');
  const body = file.totalFindings === 0
    ? `<p class="empty">${esc(t('fileClean'))}</p>`
    : file.findings.length === 0
      ? `<p class="empty">${esc(t('filterNoMatch'))}</p>`
      : `<ul class="list">${file.findings.map((f) => renderFinding(f, level, aiEnabled, t)).join('')}</ul>`;
  const syntax = file.syntaxValid ? '' : `<p class="banner warn" role="note">${esc(t('fileSyntaxInvalid'))}</p>`;
  return `<section class="panel" aria-labelledby="file-${file.id}">`
    + `<div class="file-head"><h3 id="file-${file.id}">${esc(file.path)}</h3><span class="badge">${esc(file.providerName)}</span>`
    + `<span class="muted">${esc(counts)}</span></div>${syntax}${body}${renderPipeline(file, t)}</section>`;
}

function renderPipeline(file: FileView, t: Translate): string {
  if (!file.graph) return '';
  return `<h4>${esc(t('pipelineTitle'))}</h4><p class="muted">${esc(t('pipelineNote'))}</p>`
    + `<div class="graph-wrap" tabindex="0" role="region" aria-label="${esc(t('pipelineRegion', { path: file.path }))}">${renderGraphSvg(file.graph, file.id, t)}</div>`
    + `<details><summary>${esc(t('pipelineTextAlt'))}</summary><pre>${esc(renderGraphText(file.graph))}</pre></details>`;
}

function renderFilters(vm: ViewModel, t: Translate): string {
  const { filters } = vm.input;
  const chip = (dimension: 'severity' | 'category', value: string, label: string, count: number, active: boolean): string =>
    button(`f-${dimension}-${value}`, `${label} (${count})`, `data-action="filter" data-dimension="${dimension}" data-value="${value}" aria-pressed="${active}"`);
  const severityCounts = vm.totals;
  const clear = filters.severities.size + filters.categories.size > 0
    ? button('f-clear', t('filterClear'), 'data-action="clear-filters"') : '';
  return `<section aria-labelledby="filters-title"><h2 id="filters-title">${esc(t('filtersTitle'))}</h2>`
    + `<fieldset><legend>${esc(t('filterSeverity'))}</legend><div class="chips">`
    + SEVERITIES.map((s) => chip('severity', s, t(SEVERITY_KEY[s]), severityCounts[s], filters.severities.has(s))).join('')
    + `</div></fieldset><fieldset><legend>${esc(t('filterCategory'))}</legend><div class="chips">`
    + CATEGORIES.map((c) => chip('category', c, t(CATEGORY_KEY[c]), vm.categoryCounts[c], filters.categories.has(c))).join('')
    + `</div></fieldset>${clear}<p class="muted">${esc(t('filterShowing', { shown: vm.totals.shown, total: vm.totals.findings }))}</p></section>`;
}

function renderIntentResult(r: IntentResult, level: ExperienceLevel, t: Translate): string {
  const evidence = level === 'beginner' || r.evidence.length === 0 ? ''
    : `<br><span class="muted">${esc(t('intentEvidence'))}: ${esc(r.evidence.map((e) => `${e.kind} ${e.ref}`).join(', '))}</span>`;
  const kind = level === 'beginner' ? '' : `<code>${esc(r.kind)}</code><br>`;
  return `<tr><td>${renderVerdict(r.verdict, t)}</td><td>${kind}${esc(redactSecrets(r.message))}${evidence}</td>`
    + `<td class="basis">${esc(t(BASIS_KEY[r.basis]))}</td></tr>`;
}

function renderIntentGroup(group: IntentGroupView, level: ExperienceLevel, t: Translate): string {
  return `<h3>${esc(group.path)} ${renderVerdict(group.overall, t)}</h3>`
    + `<table><thead><tr><th scope="col">${esc(t('intentVerdict'))}</th><th scope="col">${esc(t('intentCriterion'))}</th><th scope="col">${esc(t('intentBasis'))}</th></tr></thead>`
    + `<tbody>${group.results.map((r) => renderIntentResult(r, level, t)).join('')}</tbody></table>`;
}

function renderIntent(vm: ViewModel, t: Translate): string {
  const { intent } = vm.input;
  let body: string;
  if (intent.status === 'absent') body = `<p class="empty">${esc(t('intentAbsent'))}</p>`;
  else if (intent.status === 'invalid') {
    body = `<p class="banner warn" role="alert">${esc(t('intentInvalid'))}</p><ul>${intent.issues.map((i) => `<li><code>${esc(i.path)}</code>: ${esc(i.message)}</li>`).join('')}</ul>`;
  } else if (vm.intentGroups.length === 0) body = `<p class="empty">${esc(t('intentNoModel'))}</p>`;
  else body = `<p class="muted">${esc(t('intentNotSuccess'))}</p>${vm.intentGroups.map((g) => renderIntentGroup(g, vm.input.level, t)).join('')}`;
  return `<section class="panel" aria-labelledby="intent-title"><h2 id="intent-title">${esc(t('intentTitle'))}</h2>${body}</section>`;
}

function renderRun(run: RunEvidence, level: ExperienceLevel, t: Translate): string {
  const outcome = run.conclusion ?? run.status;
  const jobs = level === 'beginner' ? '' : `<br><span class="muted">${esc(run.jobs.map((j) => `${j.name}: ${j.conclusion ?? j.status}`).join(' · '))}</span>`;
  const url = link(run.htmlUrl, t('remoteOpenRun'));
  return `<tr><td>${esc(run.workflowName)}</td><td>${esc(outcome)}</td><td>${esc(run.branch ?? '-')} · ${esc(run.event)}</td>`
    + `<td><code>${esc(run.headSha.slice(0, 7))}</code> ${esc(run.createdAt)} ${url}${jobs}</td></tr>`;
}

function renderRemote(vm: ViewModel, t: Translate): string {
  const { remote, level } = vm.input;
  const actions = remote.connected
    ? button('cmd-fetch', t('actionFetchRuns'), 'data-action="command" data-command="fetchRuns"') + ' '
      + button('cmd-disconnect', t('actionDisconnect'), 'data-action="command" data-command="disconnectGitHub"')
    : button('cmd-connect', t('actionConnect'), 'data-action="command" data-command="connectGitHub"');
  let body = '';
  if (!remote.enabled) body = `<p class="muted">${esc(t('remoteDisabled'))}</p>`;
  else if (remote.context?.status === 'unavailable') {
    body = `<p class="banner warn" role="alert">${esc(t('remoteUnavailable'))} ${esc(redactSecrets(remote.context.reason))}</p>`;
  } else if (remote.context?.status === 'available') {
    const runs = remote.context.runs.slice(0, MAX_RUNS_SHOWN);
    body = `<p class="banner" role="note">${esc(t('remoteObserved'))}</p>`
      + (runs.length === 0 ? `<p class="empty">${esc(t('remoteNoRuns'))}</p>`
        : `<table><thead><tr><th scope="col">${esc(t('runWorkflow'))}</th><th scope="col">${esc(t('runOutcome'))}</th><th scope="col">${esc(t('runBranch'))}</th><th scope="col">${esc(t('runDetails'))}</th></tr></thead><tbody>${runs.map((r) => renderRun(r, level, t)).join('')}</tbody></table>`);
  }
  return `<section class="panel" aria-labelledby="remote-title"><h2 id="remote-title">${esc(t('remoteTitle'))}</h2>`
    + `<p class="muted">${esc(t('remoteNote'))}</p><div class="toolbar">${remote.enabled ? actions : ''}</div>${body}</section>`;
}

function renderPolicies(vm: ViewModel, t: Translate): string {
  if (vm.input.level !== 'expert') return '';
  const { policy, remote, aiEnabled } = vm.input;
  const items = [
    t('policyStatic'), t('policyLimits', { files: policy.maxFiles, bytes: policy.maxFileBytes }),
    t(remote.enabled ? 'policyRemoteOn' : 'policyRemoteOff'), t(aiEnabled ? 'policyAiOn' : 'policyAiOff'),
  ];
  return `<section class="panel" aria-labelledby="policy-title"><h2 id="policy-title">${esc(t('policiesTitle'))}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
}

function announcement(vm: ViewModel, t: Translate): string {
  if (!vm.input.scanned) return '';
  return t('announceScan', { files: vm.totals.files, errors: vm.totals.error, warnings: vm.totals.warning, info: vm.totals.information });
}

/** Renders the complete Control Center document. Every dynamic value is escaped; scripts and styles run only via the nonce. */
export function renderControlCenter(vm: ViewModel, env: RenderEnv): string {
  const { t, nonce } = env;
  const { input } = vm;
  const lang = env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
  const csp = `default-src 'none'; img-src ${env.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  const card = (value: number, key: TextKey): string => `<div class="card"><div class="value">${value}</div><div class="caption">${esc(t(key))}</div></div>`;
  const levelSelect = `<label for="level">${esc(t('levelLabel'))}</label><select id="level">${EXPERIENCE_LEVELS.map((l) =>
    `<option value="${l}"${l === input.level ? ' selected' : ''}>${esc(t(LEVEL_KEY[l]))}</option>`).join('')}</select>`;

  let results: string;
  if (!input.trusted) results = `<p class="banner warn" role="alert">${esc(t('untrusted'))}</p>`;
  else if (!input.scanned) results = `<p class="empty">${esc(t('empty'))}</p>`;
  else if (vm.files.length === 0) results = `<p class="empty">${esc(t('noFiles'))}</p>`;
  else results = `${renderFilters(vm, t)}<h2>${esc(t('findings'))}</h2>${vm.files.map((f) => renderFile(f, input.level, input.aiEnabled, t)).join('')}`;
  const truncated = input.truncated
    ? `<p class="banner warn" role="note">${esc(t('scanTruncated', { scanned: input.truncated.scanned, total: input.truncated.total }))}</p>` : '';

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1.0">`
    + `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`
    + `<title>${esc(t('panelTitle'))}</title><style nonce="${nonce}">${STYLES}</style></head>`
    + `<body data-announce="${esc(announcement(vm, t))}"><main>`
    + `<header class="head"><img class="brand" src="${esc(env.logoUri)}" width="56" height="56" alt=""><div>`
    + `<div class="eyebrow">ORQUESTIVO · CI/CD</div><h1>${esc(t('title'))}</h1><p class="muted">${esc(t('subtitle'))}</p></div></header>`
    + `<div id="live" class="sr-only" role="status" aria-live="polite"></div>`
    + `<div class="toolbar" role="toolbar" aria-label="${esc(t('toolbarLabel'))}">`
    + `${button('cmd-analyze', t('scan'), 'data-action="command" data-command="analyze"', true)}`
    + `${button('cmd-generate', t('actionGenerate'), 'data-action="command" data-command="generate"')}${levelSelect}</div>`
    + `<p class="banner" role="note">${esc(t('report'))}</p>${truncated}`
    + `<section class="cards" aria-label="${esc(t('summaryLabel'))}">${card(vm.totals.files, 'files')}${card(vm.totals.error, 'errors')}${card(vm.totals.warning, 'warnings')}${card(vm.totals.information, 'info')}</section>`
    + (vm.providers.length ? `<p class="muted">${esc(t('providersLabel'))}: ${vm.providers.map((p) => `<span class="badge">${esc(p)}</span>`).join(' ')}</p>` : '')
    + `${results}${renderIntent(vm, t)}${renderRemote(vm, t)}${renderPolicies(vm, t)}`
    + `<footer>${esc(t('footerNote'))}</footer></main><script nonce="${nonce}">${CLIENT_SCRIPT}</script></body></html>`;
}
