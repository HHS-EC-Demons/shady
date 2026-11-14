import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = [
  ...(process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry.endsWith(path.join('node_modules', '.bin')))
    .map((entry) => path.dirname(entry)),
  path.resolve('node_modules'),
];

async function need(name) {
  for (const root of roots) {
    const file = path.join(root, name, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = pkg.exports?.['.']?.default ?? pkg.exports?.default?.default ?? pkg.module ?? pkg.main;
    return import(pathToFileURL(path.join(root, name, entry)).href);
  }
  return import(name);
}

const { Document, NodeIO } = await need('@gltf-transform/core');
const { ALL_EXTENSIONS } = await need('@gltf-transform/extensions');
const { dedup, mergeDocuments, meshopt, prune } = await need('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder } = await need('meshoptimizer');

const DOT = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
const folder = process.argv[2] ?? 'site/public/models';
const output = path.join(folder, 'far.glb');

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const names = fs
  .readdirSync(folder)
  .filter((file) => file.endsWith('.glb') && file !== 'far.glb')
  .map((file) => file.slice(0, -4))
  .sort();

const pack = new Document();
pack.createBuffer();
const scene = pack.createScene('far');
pack.getRoot().setDefaultScene(scene);

for (const name of names) {
  const level = name.startsWith('tree-') ? 'lod2' : 'lod1';
  const doc = await io.read(path.join(folder, `${name}.glb`));
  const root = doc.getRoot();
  for (const texture of root.listTextures()) texture.setName(texture.getURI());
  const keep = root.listNodes().find((node) => node.getName() === level);
  if (!keep) throw new Error(`${name} has no ${level}`);
  for (const holder of root.listScenes()) for (const child of holder.listChildren()) holder.removeChild(child);
  for (const node of root.listNodes()) if (node !== keep) node.dispose();
  keep.setName(`${name}@${level}`);
  root.listScenes()[0].addChild(keep);
  const buffer = root.listBuffers()[0];
  for (const accessor of root.listAccessors()) accessor.setBuffer(buffer);
  await doc.transform(prune());
  mergeDocuments(pack, doc);
  for (const extra of pack.getRoot().listScenes()) {
    if (extra === scene) continue;
    for (const child of extra.listChildren()) scene.addChild(child);
    extra.dispose();
  }
  for (const extra of pack.getRoot().listBuffers().slice(1)) {
    for (const accessor of pack.getRoot().listAccessors()) if (accessor.getBuffer() === extra) accessor.setBuffer(pack.getRoot().listBuffers()[0]);
    extra.dispose();
  }
}

await pack.transform(dedup({ textures: true }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
for (const texture of pack.getRoot().listTextures()) texture.setImage(DOT).setMimeType('image/png');
const written = Buffer.from(await io.writeBinary(pack));
const finished = external(written);
fs.writeFileSync(output, finished);
console.log(output, finished.length, pack.getRoot().listNodes().map((node) => node.getName()).join(' '));

function external(glb) {
  const length = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + length).toString('utf8'));
  const rest = glb.subarray(20 + length);
  for (const image of json.images ?? []) {
    if (!image.name?.startsWith('tex/')) continue;
    delete image.bufferView;
    delete image.mimeType;
    image.uri = image.name;
    delete image.name;
  }
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + rest.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(text.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, text, rest]);
}
