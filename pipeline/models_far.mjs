import crypto from 'node:crypto';
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
    const entry = pkg.exports?.['.']?.default ?? pkg.exports?.default?.default ?? pkg.exports?.['.']?.require?.default ?? pkg.exports?.['.']?.require ?? pkg.module ?? pkg.main ?? 'index.js';
    return import(pathToFileURL(path.join(root, name, typeof entry === 'string' ? entry : 'index.js')).href);
  }
  return import(name);
}

const { Document, NodeIO } = await need('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression } = await need('@gltf-transform/extensions');
const { dedup, dequantize, joinPrimitives, mergeDocuments, prune, quantize, reorder, transformPrimitive } = await need('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder } = await need('meshoptimizer');
const sharp = (await need('sharp')).default;

const SMALL = 256;
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
const owners = new Map();

for (const name of names) {
  const level = name.startsWith('tree-') ? 'lod2' : 'lod1';
  const doc = await io.read(path.join(folder, `${name}.glb`));
  await doc.transform(dequantize());
  const root = doc.getRoot();
  for (const texture of root.listTextures()) texture.setName(texture.getURI());
  const keep = root.listNodes().find((node) => node.getName() === level);
  if (!keep) throw new Error(`${name} has no ${level}`);
  const prims = [];
  keep.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      transformPrimitive(prim, matrix);
      prims.push(prim);
    }
  });
  const buffer = root.listBuffers()[0];
  for (const accessor of root.listAccessors()) accessor.setBuffer(buffer);
  const map = mergeDocuments(pack, doc);
  for (const prim of prims) owners.set(map.get(prim), name);
  for (const extra of pack.getRoot().listScenes()) if (extra !== scene) extra.dispose();
  for (const extra of pack.getRoot().listBuffers().slice(1)) {
    for (const accessor of pack.getRoot().listAccessors()) if (accessor.getBuffer() === extra) accessor.setBuffer(pack.getRoot().listBuffers()[0]);
    extra.dispose();
  }
}

await pack.transform(dedup({ propertyTypes: ['Material', 'Texture'] }), reorder({ encoder: MeshoptEncoder, target: 'size' }));

const groups = new Map();
for (const [prim, name] of owners) {
  const material = prim.getMaterial();
  const list = groups.get(material) ?? [];
  list.push({ prim, name });
  groups.set(material, list);
}

const mesh = pack.createMesh('far');
for (const [material, list] of groups) {
  const parts = [];
  let vertices = 0;
  let indices = 0;
  for (const { prim, name } of list) {
    const count = prim.getAttribute('POSITION').getCount();
    const order = prim.getIndices().getCount();
    parts.push([name, vertices, count, indices, order]);
    vertices += count;
    indices += order;
  }
  const joined = joinPrimitives(list.map(({ prim }) => prim));
  joined.setMaterial(material).setExtras({ parts });
  mesh.addPrimitive(joined);
}
for (const node of pack.getRoot().listNodes()) node.dispose();
for (const old of pack.getRoot().listMeshes()) if (old !== mesh) old.dispose();
scene.addChild(pack.createNode('far').setMesh(mesh));

await pack.transform(prune(), quantize({ quantizeNormal: 8, quantizeColor: 8, quantizeTexcoord: 12 }));
pack.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

const small = new Map();
for (const texture of pack.getRoot().listTextures()) {
  const uri = texture.getName();
  if (!small.has(uri)) {
    const data = await sharp(path.join(folder, uri)).resize(SMALL, SMALL).webp({ quality: 70, alphaQuality: 60, effort: 6 }).toBuffer();
    const name = `tex/leaves-far-${SMALL}-${crypto.createHash('sha256').update(data).digest('hex').slice(0, 8)}.webp`;
    fs.writeFileSync(path.join(folder, name), data);
    small.set(uri, name);
  }
  texture.setName(small.get(uri)).setImage(DOT).setMimeType('image/png');
}

const written = Buffer.from(await io.writeBinary(pack));
const finished = external(written);
fs.writeFileSync(output, finished);
console.log(output, finished.length, [...small.values()].join(' '), [...owners.values()].length);

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
