import type { ReactionId } from '../shared/contracts';

export const joints = [
  ['head', '頭部'], ['leftShoulder', '左肩'], ['leftElbow', '左肘'], ['rightShoulder', '右肩'], ['rightElbow', '右肘'],
  ['leftHip', '左髖'], ['leftKnee', '左膝'], ['rightHip', '右髖'], ['rightKnee', '右膝'], ['tail', '尾巴'],
] as const;
export type Joint = typeof joints[number][0];
export type JointPose = Partial<Record<Joint, number>>;
type Point = [number, number];
type Bone = { name: Joint; pivot: Point; weight: (x: number, y: number) => number; parent?: Joint };
type Influence = { bone: Bone; weight: number };
type Vertex = { x: number; y: number; influences: Influence[] };
type Rotation = { cos: number; sin: number; x: number; y: number; parent?: Rotation };

const size = 320;
const step = 10;
const stride = size / step + 1;
const profiles: Record<string, number[]> = {
  girl: [140, 151, 177, 232, 252],
  fox: [135, 146, 174, 229, 249],
};
const grid = new Map<string, Vertex[]>();

function smooth(start: number, end: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function buildBones(role: string, dressed: boolean): Bone[] {
  const [neck, shoulderY, elbowY, hipY, kneeY] = profiles[role] ?? profiles.girl;
  const bones: Bone[] = [
    { name: 'head', pivot: [160, neck], weight: (x, y) =>
      (1 - smooth(neck - 17, neck + 12, y)) * (1 - smooth(88, 118, Math.abs(x - 160))) },
  ];
  for (const [side, name] of [[-1, 'left'], [1, 'right']] as const) {
    const shoulder = `${name}Shoulder` as const;
    const hip = `${name}Hip` as const;
    const wing = (x: number, y: number) => {
      const outward = side * (x - 160);
      const inner = 14 + .36 * Math.max(0, y - shoulderY);
      const outer = role === 'fox' && side < 0 ? 51 : 57;
      return smooth(inner, inner + 12, outward) * (1 - smooth(outer, outer + 18, outward)) *
        smooth(shoulderY - 10, shoulderY + 9, y) * (1 - smooth(201, 215, y));
    };
    const shin = (x: number, y: number) => {
      const outward = side * (x - 160);
      return smooth(0, 8, outward) * (1 - smooth(dressed ? 38 : 27, 54, outward)) * (1 - smooth(293, 313, y));
    };
    bones.push(
      { name: shoulder, pivot: [160 + side * 21, shoulderY], weight: wing },
      { name: `${name}Elbow`, parent: shoulder, pivot: [160 + side * 36, elbowY],
        weight: (x, y) => wing(x, y) * smooth(elbowY - 7, elbowY + 14, y) },
      { name: hip, pivot: [160 + side * 13, hipY], weight: (x, y) => shin(x, y) * smooth(hipY - 2, hipY + 24, y) },
      { name: `${name}Knee`, parent: hip, pivot: [160 + side * (dressed ? 16 : 12), kneeY],
        weight: (x, y) => shin(x, y) * smooth(kneeY - 8, kneeY + 13, y) },
    );
  }
  if (role === 'fox') {
    bones.push({ name: 'tail', pivot: [122, 202], weight: (x, y) =>
      smooth(120, 149, y) * (1 - smooth(205, 234, y)) * (1 - smooth(104, 127, x)) });
  }
  return bones;
}

function vertices(role: string, dressed: boolean) {
  const key = `${role}:${dressed}`;
  const cached = grid.get(key);
  if (cached) return cached;
  const bones = buildBones(role, dressed);
  const result: Vertex[] = [];
  for (let y = 0; y <= size; y += step) for (let x = 0; x <= size; x += step) {
    const boundary = x === 0 || x === size || y === 0 || y === size;
    const influences = boundary ? [] : bones.map(bone => ({ bone, weight: bone.weight(x, y) })).filter(value => value.weight > .001);
    result.push({ x, y, influences });
  }
  grid.set(key, result);
  return result;
}

function transform(mesh: Vertex[], pose: JointPose) {
  const rotations = new Map<Joint, Rotation>();
  const output = new Float32Array(mesh.length * 2);
  for (const [i, vertex] of mesh.entries()) {
    let x = vertex.x;
    let y = vertex.y;
    for (const { bone, weight } of vertex.influences) {
      const angle = pose[bone.name];
      if (!angle) continue;
      let rotation = rotations.get(bone.name);
      if (!rotation) {
        const [px, py] = bone.pivot;
        const parentAngle = bone.parent ? pose[bone.parent] : undefined;
        const parent = parentAngle ? { cos: Math.cos(parentAngle), sin: Math.sin(parentAngle), x: 0, y: 0 } : undefined;
        rotation = { x: px, y: py, cos: Math.cos(angle), sin: Math.sin(angle), parent };
        rotations.set(bone.name, rotation);
      }
      const px = vertex.x - rotation.x;
      const py = vertex.y - rotation.y;
      const dx = (rotation.cos - 1) * px - rotation.sin * py;
      const dy = rotation.sin * px + (rotation.cos - 1) * py;
      const parent = rotation.parent;
      x += (parent ? parent.cos * dx - parent.sin * dy : dx) * weight;
      y += (parent ? parent.sin * dx + parent.cos * dy : dy) * weight;
    }
    output[i * 2] = x;
    output[i * 2 + 1] = y;
  }
  return output;
}

function sample(source: Uint8ClampedArray, output: Uint8ClampedArray, index: number, x: number, y: number) {
  const sx = Math.max(0, Math.min(size - 1.0001, x - .5));
  const sy = Math.max(0, Math.min(size - 1.0001, y - .5));
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const u = sx - ix, v = sy - iy;
  const a = (iy * size + ix) * 4;
  const b = a + 4, c = a + size * 4, d = c + 4;
  const w0 = (1 - u) * (1 - v) * source[a + 3];
  const w1 = u * (1 - v) * source[b + 3];
  const w2 = (1 - u) * v * source[c + 3];
  const w3 = u * v * source[d + 3];
  const alpha = w0 + w1 + w2 + w3;
  output[index + 3] = alpha;
  if (alpha < .5) { output.fill(0, index, index + 3); return; }
  for (let channel = 0; channel < 3; channel++) {
    output[index + channel] = (source[a + channel] * w0 + source[b + channel] * w1 + source[c + channel] * w2 + source[d + channel] * w3) / alpha;
  }
}

function rasterize(source: Uint8ClampedArray, output: Uint8ClampedArray, mesh: Vertex[], points: Float32Array, a: number, b: number, c: number) {
  const ax = points[a * 2], ay = points[a * 2 + 1];
  const bx = points[b * 2], by = points[b * 2 + 1];
  const cx = points[c * 2], cy = points[c * 2 + 1];
  const p = mesh[a], q = mesh[b], r = mesh[c];
  if (ax === p.x && ay === p.y && bx === q.x && by === q.y && cx === r.x && cy === r.y) return;
  const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay;
  const det = ux * vy - uy * vx;
  if (det <= .03) return;
  const lowX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const lowY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const highX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const highY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = lowY; y <= highY; y++) for (let x = lowX; x <= highX; x++) {
    const dx = x + .5 - ax, dy = y + .5 - ay;
    const u = (dx * vy - dy * vx) / det;
    const v = (ux * dy - uy * dx) / det;
    if (u < -.00001 || v < -.00001 || u + v > 1.00001) continue;
    sample(source, output, (y * size + x) * 4, p.x + u * (q.x - p.x) + v * (r.x - p.x), p.y + u * (q.y - p.y) + v * (r.y - p.y));
  }
}

export function poseFigure(ctx: CanvasRenderingContext2D, role: string, dressed: boolean, pose: JointPose) {
  if (!Object.values(pose).some(angle => angle)) return;
  const source = ctx.getImageData(0, 0, size, size).data;
  const output = new ImageData(new Uint8ClampedArray(source), size, size);
  const mesh = vertices(role, dressed);
  const points = transform(mesh, pose);
  for (let y = 0; y < stride - 1; y++) for (let x = 0; x < stride - 1; x++) {
    const a = y * stride + x;
    const d = a + stride;
    rasterize(source, output.data, mesh, points, a, a + 1, d);
    rasterize(source, output.data, mesh, points, a + 1, d + 1, d);
  }
  ctx.putImageData(output, 0, 0);
}

// Local bend tracks in radians. A parent carries its child while each joint can bend independently.
export function actionPose(id: ReactionId, t: number, w: number): JointPose {
  const sway = Math.sin(t * Math.PI * 4);
  switch (id) {
    case 'tea-serve': return { head: -.10 * w, leftShoulder: .22 * w, leftElbow: .31 * w };
    case 'shy-wink': return { head: .12 * w };
    case 'moon-bow': return { head: .23 * w, leftShoulder: .21 * w, rightShoulder: -.21 * w, leftKnee: -.14 * w, rightKnee: .14 * w };
    case 'scent': return { head: .19 * w + .055 * sway * w, tail: -.13 * w };
    case 'tail-wag': return { tail: .29 * w * Math.sin(t * 32) };
    case 'leaf-pounce': return { head: -.11 * w, leftShoulder: .26 * w, rightShoulder: -.22 * w, leftHip: -.16 * w, rightKnee: .32 * w, tail: .16 * sway * w };
    case 'catnap': return { head: (.18 + .06 * sway) * w };
  }
}
