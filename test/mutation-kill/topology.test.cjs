const { test } = require('node:test');
const assert = require('node:assert/strict');
const { layerNodes } = require('../../dist-test/core/analysis/topology.js');
const { findCycleMembers } = require('../../dist-test/providers/shared/graph.js');

const m = (o) => new Map(Object.entries(o));

test('layers: roots 0, longest path wins, unknown deps ignored', () => {
  const { layers, cyclic } = layerNodes(m({ a: [], b: ['a'], c: ['a', 'b'], d: ['ghost'], e: ['c', 'd'] }));
  assert.deepEqual([...layers].sort(), [['a', 0], ['b', 1], ['c', 2], ['d', 0], ['e', 3]]);
  assert.equal(cyclic.size, 0);
});

test('layers: duplicate deps count once', () => {
  const { layers } = layerNodes(m({ a: [], b: ['a', 'a', 'a'] }));
  assert.equal(layers.get('b'), 1);
});

test('cycles: members and dependents are cyclic and have no layer', () => {
  const { layers, cyclic } = layerNodes(m({ r: [], a: ['b', 'r'], b: ['a'], c: ['a'], s: ['s'] }));
  assert.deepEqual([...cyclic].sort(), ['a', 'b', 'c', 's']);
  assert.deepEqual([...layers], [['r', 0]]);
});

test('empty graph', () => {
  const { layers, cyclic } = layerNodes(new Map());
  assert.equal(layers.size, 0);
  assert.equal(cyclic.size, 0);
});

test('deep chain is stack-safe and exact', () => {
  const o = new Map();
  for (let i = 0; i < 20000; i++) o.set('n' + i, i ? ['n' + (i - 1)] : []);
  assert.equal(layerNodes(o).layers.get('n19999'), 19999);
});

test('findCycleMembers: self, mutual, ignores unknown and non-members', () => {
  assert.deepEqual([...findCycleMembers(m({ a: ['a'] }))], ['a']);
  assert.deepEqual([...findCycleMembers(m({ a: ['b'], b: ['a'], c: ['a'], d: ['zzz'] }))].sort(), ['a', 'b']);
  assert.equal(findCycleMembers(m({ a: [], b: ['a'] })).size, 0);
  assert.deepEqual([...findCycleMembers(m({ a: ['b'], b: ['c'], c: ['a'] }))].sort(), ['a', 'b', 'c']);
});
