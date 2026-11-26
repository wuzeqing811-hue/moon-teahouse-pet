import type { ClipSpec, CustomLook, Outfit } from '../shared/contracts';
import { loadLookArt } from './illustrated.js';
import { drawCharacterFrame, loadImage } from './rig.js';
import { encodeTransparentWebM } from './webm.js';

export function openBakeScene(outfit: Outfit, look?: CustomLook, revision?: number) {
  const images = new Map<string, Promise<HTMLImageElement>>();
  function load(file: string) {
    let image = images.get(file);
    if (!image) {
      image = loadImage(`/asset/${outfit.id}/${file}${revision === undefined ? '' : '?v=' + revision}`);
      images.set(file, image);
    }
    return image;
  }
  const dressed = look ? loadLookArt(look).then(art => ({ look, art })) : undefined;
  return async (action: string, spec: ClipSpec, signal?: AbortSignal) => {
    const clip = outfit.animations[action];
    const [frames, clothes, alternate] = await Promise.all([
      Promise.all(clip.frames.map(load)), dressed,
      clip.wave ? load(clip.frames[0]) : clip.reaction === 'shy-wink' ? load(outfit.animations.idle.frames[2]) : undefined,
    ]);
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = outfit.canvas.width;
    canvas.height = outfit.canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const area = canvas.width * canvas.height;
    const stride = Math.ceil(area / 8);
    const packed = new Uint8Array(stride * spec.count);
    const video = await encodeTransparentWebM(canvas, spec.fps, spec.count, frame => {
      const index = Math.min(frames.length - 1, Math.floor(frame * clip.fps / spec.fps + .0001));
      const captureBody = () => {
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const offset = frame * stride;
        for (let pixel = 0; pixel < area; pixel++) {
          if (rgba[pixel * 4 + 3] >= 128) packed[offset + (pixel >> 3)] |= 1 << (pixel & 7);
        }
      };
      drawCharacterFrame(ctx, outfit, action, index, frames[index], clothes, alternate, captureBody, { index: frame, count: spec.count });
      if (!clip.reaction) captureBody();
    }, signal);
    const deflated = new Blob([packed]).stream().pipeThrough(new CompressionStream('deflate'));
    return { video, hits: new Uint8Array(await new Response(deflated).arrayBuffer()) };
  };
}
