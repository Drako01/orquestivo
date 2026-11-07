import type { JobGraph } from '../core/analysis/graph.js';
import type { Translate } from '../i18n.js';
import { escapeHtml } from './escape.js';

const NODE_W = 176;
const NODE_H = 52;
const GAP_X = 64;
const GAP_Y = 20;
const PAD = 16;
const MAX_LABEL = 24;

const truncate = (text: string): string => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);

/**
 * Renders the job graph as inline SVG. Nodes show static facts only (name, id, line): there is
 * no execution state. Each node is keyboard focusable and carries an accessible name; activation
 * is wired by the page script through the `data-file` / `data-line` attributes.
 */
export function renderGraphSvg(graph: JobGraph, fileId: number, t: Translate): string {
  const rows = new Map<number, number>();
  const position = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  for (const node of graph.nodes) {
    const row = rows.get(node.layer) ?? 0;
    rows.set(node.layer, row + 1);
    maxRows = Math.max(maxRows, row + 1);
    position.set(node.id, { x: PAD + node.layer * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) });
  }
  const width = PAD * 2 + graph.layerCount * NODE_W + Math.max(0, graph.layerCount - 1) * GAP_X;
  const height = PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * GAP_Y;
  const marker = `arrow-${fileId}`;
  const needs = new Map<string, number>();
  for (const edge of graph.edges) needs.set(edge.to, (needs.get(edge.to) ?? 0) + 1);

  const edges = graph.edges.flatMap((edge) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (!from || !to) return [];
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    return [`<path class="edge" d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" marker-end="url(#${marker})"/>`];
  });

  const nodes = graph.nodes.map((node, index) => {
    const at = position.get(node.id) ?? { x: PAD, y: PAD };
    const deps = needs.get(node.id) ?? 0;
    const label = t('graphNodeAria', { name: node.name, line: node.line, count: deps })
      + (node.cyclic ? ` ${t('graphNodeCyclic')}` : '');
    const sub = node.name === node.id ? '' : truncate(node.id);
    return `<g class="node${node.cyclic ? ' cyclic' : ''}" id="node-${fileId}-${index}" tabindex="0" role="button" `
      + `aria-label="${escapeHtml(label)}" data-file="${fileId}" data-line="${node.line}" transform="translate(${at.x} ${at.y})">`
      + `<title>${escapeHtml(label)}</title>`
      + `<rect width="${NODE_W}" height="${NODE_H}" rx="8"/>`
      + `<text class="node-name" x="12" y="${sub ? 21 : 31}">${escapeHtml(truncate(node.name))}</text>`
      + (sub ? `<text class="node-sub" x="12" y="39">${escapeHtml(sub)}</text>` : '')
      + `<text class="node-line" x="${NODE_W - 10}" y="16" text-anchor="end">${node.cyclic ? '↻ ' : ''}L${node.line}</text>`
      + '</g>';
  });

  return `<svg class="graph" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${escapeHtml(t('graphAria'))}">`
    + `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0 0L10 5L0 10z"/></marker></defs>`
    + `${edges.join('')}${nodes.join('')}</svg>`;
}
