import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFigBinary, nodeId } from 'openfig-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const figPath = resolve(root, 'reference', 'Kaksha - School App UI Kit.fig');
const outPath = resolve(root, 'reference', 'kaksha-structure.json');
const doc = parseFigBinary(new Uint8Array(readFileSync(figPath)));

const nodes = doc.nodes.map((node) => ({
  id: nodeId(node),
  parentId: node.parentIndex?.guid
    ? `${node.parentIndex.guid.sessionID}:${node.parentIndex.guid.localID}`
    : null,
  type: node.type,
  name: node.name,
  visible: node.visible,
  size: node.size,
  transform: node.transform,
  opacity: node.opacity,
  fills: node.fillPaints,
  strokes: node.strokePaints,
  cornerRadius: node.cornerRadius,
  text: node.textData?.characters,
  textData: node.textData,
  stackMode: node.stackMode,
  stackSpacing: node.stackSpacing,
  stackPadding: node.stackPadding,
  children: (doc.childrenMap.get(nodeId(node)) ?? []).map(nodeId),
}));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ header: doc.header, meta: doc.meta, nodes }, null, 2));
console.log(JSON.stringify({ header: doc.header, meta: doc.meta, nodeCount: nodes.length, topFrames: nodes.filter((node) => node.type === 'FRAME' && node.parentId).slice(0, 100).map(({ id, name, size }) => ({ id, name, size })) }, null, 2));
