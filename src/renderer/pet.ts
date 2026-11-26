import type { PetSnapshot, PetInput } from '../shared/contracts';
import { hideClips, showClip } from './video-player.js';

const sprite = document.querySelector<HTMLImageElement>('#sprite')!;
const api = window.petAPI.pet;
type Frame = { image: HTMLImageElement; mask?: Uint8Array };
type Frames = { images: Record<string, Frame[]>; pixels?: Uint8Array };
type BakeScene = ReturnType<typeof import('./bake.js')['openBakeScene']>;
type Selection = { assetRevision: number; abort: AbortController; available: Set<string>; queue: Promise<void>;
  pending: Map<string, Promise<boolean>>; scene?: Promise<BakeScene>; warm: boolean; fallback?: Promise<Frames> };
let selection: Selection | undefined;
let playback: AbortController | undefined;
let renderedRevision = -1;
let latest = -1;
let png: { snapshot: PetSnapshot; frames: Frame[]; start: number } | undefined;
let pointer: number | undefined;

function captureMask(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[4 * i + 3] >= 128 ? 1 : 0;
  return pixels;
}

async function loadPNGs(snapshot: PetSnapshot): Promise<Frames> {
  const [{ drawCharacterFrame, loadImage }, { loadLookArt }] = await Promise.all([import('./rig.js'), import('./illustrated.js')]);
  const outfit = snapshot.outfit;
  const groups = Object.entries(outfit.animations);
  const sources = new Map(await Promise.all([...new Set(groups.flatMap(([, animation]) => animation.frames))]
    .map(async file => [file, await loadImage(`/asset/${outfit.id}/${file}?v=${snapshot.assetRevision}`)] as const)));
  const look = snapshot.look;
  const dressed = look ? { look, art: await loadLookArt(look) } : undefined;
  const closed = sources.get(outfit.animations.idle.frames[2]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 320;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let pixels: Uint8Array | undefined;
  const rendered = await Promise.all(groups.map(async ([action, animation]) => [action, await Promise.all(animation.frames.map(async (file, index): Promise<Frame> => {
    const image = sources.get(file)!;
    if (!dressed && !animation.reaction && !animation.wave) return { image };
    let mask: Uint8Array | undefined;
    const bodyReady = animation.reaction ? () => { mask = captureMask(ctx); } : undefined;
    drawCharacterFrame(ctx, outfit, action, index, image, dressed, animation.wave ? sources.get(animation.frames[0]) : closed, bodyReady);
    if (animation.wave) mask = captureMask(ctx);
    if (dressed && action === 'idle' && index === 0) pixels = captureMask(ctx);
    return { image: await loadImage(canvas.toDataURL()), mask };
  }))] as const));
  return { images: Object.fromEntries(rendered), pixels };
}

function showPNG(frame: Frame, revision: number) {
  sprite.src = frame.image.src;
  if (frame.mask) api.poseMask(revision, frame.mask);
}

function prepareClip(snapshot: PetSnapshot, scope: Selection, action: string): Promise<boolean> {
  const media = snapshot.media;
  if (scope.available.has(action)) return Promise.resolve(true);
  if (!media?.bake) return Promise.resolve(false);
  const pending = scope.pending.get(action);
  if (pending) return pending;
  const signal = scope.abort.signal;
  const job = scope.queue.then(async () => {
    signal.throwIfAborted();
    scope.scene ??= import('./bake.js').then(({ openBakeScene }) => openBakeScene(snapshot.outfit, snapshot.look, snapshot.assetRevision));
    const scene = await scope.scene;
    const bytes = await scene(action, media.specs[action], signal);
    signal.throwIfAborted();
    await api.saveClip(scope.assetRevision, action, bytes);
    scope.available.add(action);
    return true;
  });
  scope.pending.set(action, job);
  scope.queue = job.then(() => undefined, () => undefined);
  const clean = () => scope.pending.delete(action);
  void job.then(clean, clean);
  return job;
}

function warmClips(snapshot: PetSnapshot, scope: Selection) {
  if (!snapshot.media?.bake || scope.warm) return;
  scope.warm = true;
  const actions = Object.keys(snapshot.media.specs);
  void (async () => {
    for (const action of actions) {
      if (scope.abort.signal.aborted) return;
      await new Promise<void>(resolve => window.setTimeout(resolve, 60));
      await prepareClip(snapshot, scope, action);
    }
  })().catch(error => { if (!scope.abort.signal.aborted) console.error('無法預先合成剩餘動作', error); });
}

function acknowledge(snapshot: PetSnapshot, mask?: Uint8Array) {
  if (snapshot.assetRevision === renderedRevision) return;
  api.ready(snapshot.assetRevision, mask);
  renderedRevision = snapshot.assetRevision;
}

async function receive(snapshot: PetSnapshot) {
  if (snapshot.revision <= latest) return;
  latest = snapshot.revision;
  playback?.abort();
  playback = new AbortController();
  const signal = playback.signal;
  if (selection?.assetRevision !== snapshot.assetRevision) {
    selection?.abort.abort();
    selection = { assetRevision: snapshot.assetRevision, abort: new AbortController(), available: new Set(), queue: Promise.resolve(), pending: new Map(), warm: false };
  }
  const scope = selection;
  for (const action of snapshot.media?.available ?? []) scope.available.add(action);
  if (snapshot.media) {
    try {
      if (await prepareClip(snapshot, scope, snapshot.action)) {
        signal.throwIfAborted();
        await showClip(snapshot, snapshot.media, signal, mask => {
          png = undefined;
          sprite.hidden = true;
          acknowledge(snapshot, mask);
          api.poseMask(snapshot.revision, mask);
        });
        warmClips(snapshot, scope);
        return;
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error('透明影片播放失敗，改用角色原始影格', error);
    }
  }
  try {
    scope.fallback ??= loadPNGs(snapshot);
    const ready = await scope.fallback;
    if (signal.aborted) return;
    hideClips();
    const frames = ready.images[snapshot.action];
    png = { snapshot, frames, start: performance.now() };
    sprite.hidden = false;
    acknowledge(snapshot, ready.pixels);
    showPNG(frames[0], snapshot.revision);
  } catch (error) {
    scope.fallback = undefined;
    if (!signal.aborted) console.error('角色帧无法加载', error);
  }
}

function animate(now: number) {
  if (png) {
    const { snapshot, frames, start } = png;
    const animation = snapshot.outfit.animations[snapshot.action];
    const tick = Math.floor(Math.max(0, now - start) * animation.fps / 1000);
    const frame = animation.loop ? tick % frames.length : Math.min(tick, frames.length - 1);
    if (sprite.src !== frames[frame].image.src) showPNG(frames[frame], snapshot.revision);
    if (!animation.loop && tick >= frames.length && snapshot.revision === latest) {
      png = undefined;
      api.ended(snapshot.revision);
    }
  }
  requestAnimationFrame(animate);
}

function input(kind: PetInput['kind'], event: PointerEvent) { api.input({ kind, x: event.screenX, y: event.screenY }); }
document.body.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer !== undefined) return;
  pointer = event.pointerId;
  document.body.setPointerCapture(event.pointerId);
  input('down', event);
});
document.body.addEventListener('pointermove', event => {
  if (event.pointerId === pointer) input('move', event);
});
for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  document.body.addEventListener(kind, event => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    input(kind === 'pointerup' ? 'up' : 'cancel', event);
    if (document.body.hasPointerCapture(event.pointerId)) document.body.releasePointerCapture(event.pointerId);
  });
}
document.body.addEventListener('wheel', event => {
  event.preventDefault();
  api.wheel(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 96 : 1));
}, { passive: false });

api.onState(snapshot => void receive(snapshot));
void api.getState().then(receive);
requestAnimationFrame(animate);
