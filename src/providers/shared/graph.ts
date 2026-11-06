/** Names that sit on a dependency cycle (including self-dependencies). Unknown targets are ignored. */
export function findCycleMembers(graph: ReadonlyMap<string, readonly string[]>): ReadonlySet<string> {
  const members = new Set<string>();
  for (const start of graph.keys()) {
    const seen = new Set<string>();
    const queue = [...(graph.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop() as string;
      if (next === start) { members.add(start); break; }
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(graph.get(next) ?? []));
    }
  }
  return members;
}
