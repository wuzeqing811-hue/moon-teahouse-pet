import type { ClipSet, PetSnapshot } from '../shared/contracts';

const api = window.petAPI.pet;
const buffers = [...document.querySelectorAll<HTMLVideoElement>('.pet-video')];
let visible: HTMLVideoElement | undefined;

function decode(video: HTMLVideoElement, source: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(Error('動畫影片載入逾時。')), 9000);
    const loaded = () => finish();
    const failed = () => finish(Error(video.error?.message || '動畫影片無法解碼。'));
    const cancel = () => finish(signal.reason);
    function finish(error?: unknown) {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    }
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    video.src = source;
    video.load();
  });
}

export function hideClips() {
  if (!visible) return;
  visible.hidden = true;
  visible.pause();
  visible = undefined;
}

export async function showClip(snapshot: PetSnapshot, media: ClipSet, signal: AbortSignal, reveal: (pixels: Uint8Array) => void) {
  const action = snapshot.action;
  const spec = media.specs[action];
  const clip = snapshot.outfit.animations[action];
  const width = snapshot.outfit.canvas.width;
  const height = snapshot.outfit.canvas.height;
  const stride = Math.ceil(width * height / 8);
  const url = `${media.root}/${action}`;
  const video = buffers.find(item => item !== visible)!;
  video.pause();
  video.loop = clip.loop;
  video.onended = null;
  const [pixels] = await Promise.all([
    fetch(url + '.hit', { signal }).then(async reply => {
      if (!reply.ok || !reply.body) throw Error('動畫命中區讀取失敗。');
      const stream = reply.body.pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }),
    decode(video, url + '.webm', signal),
  ]);
  signal.throwIfAborted();
  if (pixels.length !== stride * spec.count || video.videoWidth !== width || video.videoHeight !== height ||
      Math.abs(video.duration - spec.count / spec.fps) > .025) throw Error('動畫影片長度或畫布與清單不符。');
  const frame = (i: number) => pixels.subarray(i * stride, (i + 1) * stride);
  let last = 0;
  let request = 0;
  const tick = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    if (visible !== video || signal.aborted) return;
    const index = Math.min(spec.count - 1, Math.floor(metadata.mediaTime * spec.fps + .02));
    if (index !== last) { last = index; api.poseMask(snapshot.revision, frame(index)); }
    request = video.requestVideoFrameCallback(tick);
  };
  video.onended = () => { if (!signal.aborted && visible === video) api.ended(snapshot.revision); };
  hideClips();
  visible = video;
  video.hidden = false;
  reveal(frame(0));
  request = video.requestVideoFrameCallback(tick);
  signal.addEventListener('abort', () => video.cancelVideoFrameCallback(request), { once: true });
  void video.play().catch(error => { if (!signal.aborted) console.error('無法播放透明動畫', error); });
}
