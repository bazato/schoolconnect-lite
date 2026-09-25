import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(resolve(root, 'reference', 'kaksha-structure.json'), 'utf8'));
const byId = new Map(source.nodes.map((node) => [node.id, node]));

function descendants(id, depth = 0, output = []) {
  if (depth > 10) return output;
  for (const childId of byId.get(id)?.children ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    output.push(child);
    descendants(childId, depth + 1, output);
  }
  return output;
}

const screens = source.nodes
  .filter((node) => node.type === 'FRAME' && node.size?.x >= 320 && node.size?.x <= 430 && node.size?.y >= 650 && node.size?.y <= 950)
  .map((node) => {
    const children = descendants(node.id);
    return {
      id: node.id,
      name: node.name,
      size: node.size,
      position: node.transform ? { x: node.transform.m02, y: node.transform.m12 } : null,
      text: children.filter((child) => child.text).map((child) => child.text).filter((value, index, values) => values.indexOf(value) === index),
      primaryChildren: (node.children ?? []).map((id) => {
        const child = byId.get(id);
        return child ? { id, type: child.type, name: child.name, size: child.size } : { id };
      }),
    };
  });

const named = screens.filter((screen) => !/^Frame( \d+)?$/.test(screen.name ?? ''));
writeFileSync(resolve(root, 'reference', 'kaksha-screens.json'), JSON.stringify({ screens, named }, null, 2));
console.log(JSON.stringify(named.map(({ id, name, size, text }) => ({ id, name, size, text: text.slice(0, 24) })), null, 2));
