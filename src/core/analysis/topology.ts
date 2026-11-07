export interface Layering {
  /** Longest-path depth from a root (a node without known dependencies is layer 0). Absent for cyclic nodes. */
  readonly layers: ReadonlyMap<string, number>;
  /** Nodes that belong to, or depend on, a dependency cycle. */
  readonly cyclic: ReadonlySet<string>;
}

/**
 * Iterative Kahn layering over `node -> dependencies`. Dependencies that are not nodes are ignored.
 * Linear time and stack-safe, so hostile inputs with thousands of chained jobs are fine.
 */
export function layerNodes(dependencies: ReadonlyMap<string, readonly string[]>): Layering {
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [id, deps] of dependencies) {
    const known = new Set(deps.filter((dep) => dependencies.has(dep)));
    pending.set(id, known.size);
    for (const dep of known) {
      const list = dependents.get(dep);
      if (list) list.push(id); else dependents.set(dep, [id]);
    }
  }
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, count] of pending) if (count === 0) { layers.set(id, 0); queue.push(id); }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string;
    const next = (layers.get(id) ?? 0) + 1;
    for (const dependent of dependents.get(id) ?? []) {
      layers.set(dependent, Math.max(layers.get(dependent) ?? 0, next));
      const left = (pending.get(dependent) ?? 0) - 1;
      pending.set(dependent, left);
      if (left === 0) queue.push(dependent);
    }
  }
  const cyclic = new Set<string>();
  for (const [id, count] of pending) if (count > 0) { cyclic.add(id); layers.delete(id); }
  return { layers, cyclic };
}
