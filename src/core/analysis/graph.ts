import type { PipelineModel } from '../model.js';
import { layerNodes } from './topology.js';

export interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly line: number;
  /** Topological depth: 0 for jobs without dependencies. Cyclic nodes sit one layer past the deepest acyclic one. */
  readonly layer: number;
  readonly cyclic: boolean;
}
/** `from` must finish before `to` starts. */
export interface GraphEdge { readonly from: string; readonly to: string }
export interface JobGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly layerCount: number;
}

/** Builds a deterministic job graph (declaration order) from a provider-neutral model. */
export function buildJobGraph(model: PipelineModel): JobGraph {
  const dependencies = new Map(model.jobs.map((job) => [job.id, job.needs]));
  const { layers, cyclic } = layerNodes(dependencies);
  let deepest = -1;
  for (const layer of layers.values()) deepest = Math.max(deepest, layer);
  const nodes = model.jobs.map((job): GraphNode => ({
    id: job.id,
    name: job.name ?? job.id,
    line: job.line,
    layer: layers.get(job.id) ?? deepest + 1,
    cyclic: cyclic.has(job.id),
  }));
  const edges = model.jobs.flatMap((job) =>
    [...new Set(job.needs)].filter((dep) => dependencies.has(dep)).map((dep): GraphEdge => ({ from: dep, to: job.id })));
  return { nodes, edges, layerCount: cyclic.size > 0 ? deepest + 2 : deepest + 1 };
}

/** Accessible textual alternative to a visual graph: one layer per section, dependencies spelled out. */
export function renderGraphText(graph: JobGraph): string {
  if (graph.nodes.length === 0) return 'No jobs.';
  const needs = new Map<string, string[]>();
  for (const edge of graph.edges) needs.set(edge.to, [...(needs.get(edge.to) ?? []), edge.from]);
  const lines: string[] = [graph.nodes.length + ' job(s) in ' + graph.layerCount + ' stage(s).'];
  for (let layer = 0; layer < graph.layerCount; layer++) {
    const members = graph.nodes.filter((node) => node.layer === layer);
    if (members.length === 0) continue;
    lines.push('', 'Stage ' + (layer + 1) + (members.some((m) => m.cyclic) ? ' (circular dependency)' : '') + ':');
    for (const node of members) {
      const deps = needs.get(node.id);
      const label = node.name === node.id ? node.id : node.name + ' (' + node.id + ')';
      lines.push('  - ' + label + ', line ' + node.line + (deps ? ', runs after ' + deps.join(', ') : ', starts immediately'));
    }
  }
  return lines.join('\n');
}
