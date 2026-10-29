#!/usr/bin/env node
// Print what's inside a GLB: bounds, triangles, textures, skeleton and animations.
//   node scripts/inspect-glb.js public/models/skiff.glb [more.glb ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => v - b.min[i]);
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  console.log(`\n${file}`);
  console.log(`  bounds min ${b.min.map((v) => v.toFixed(2))} max ${b.max.map((v) => v.toFixed(2))} size ${size.map((v) => v.toFixed(2))}`);
  console.log(`  meshes ${root.listMeshes().length}, triangles ${Math.round(tris)}, materials ${root.listMaterials().length}`);
  for (const t of root.listTextures()) {
    const sz = t.getSize();
    console.log(`  texture ${t.getName() || '(unnamed)'} ${t.getMimeType()} ${sz ? sz.join('x') : '?'} ${Math.round(t.getImage().byteLength / 1024)} KB`);
  }
  for (const skin of root.listSkins()) {
    const joints = skin.listJoints().map((j) => j.getName());
    console.log(`  skin: ${joints.length} joints: ${joints.join(', ')}`);
  }
  for (const a of root.listAnimations()) {
    const ch = a.listChannels();
    const inputs = a.listSamplers().map((s) => s.getInput().getMax([0])[0]);
    console.log(`  animation "${a.getName()}" channels ${ch.length} duration ${Math.max(...inputs).toFixed(2)}s`);
  }
}
