import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Animation, BakedClip, ClipSet, ClipSpec, CustomLook, Outfit } from '../shared/contracts';

// Increment for changes that affect every cached clip.
const cacheVersion = 'motion-1';
const validAction = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const retiredClips = new Set(['big-bite', 'slack-off', 'blow-bubbles', 'dance']);
const revisedClips = new Map([['scent', 'scent-v2'], ['click', 'click-v2']]);
const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export function clipSpec(animation: Animation): ClipSpec {
  const fps = animation.reaction || animation.wave ? 24 : animation.fps;
  return { fps, count: Math.round(animation.frames.length * fps / animation.fps) };
}

export class VideoLibrary {
  constructor(private presets: string, private cache: string) {}

  async pruneOldClips() {
    const directories = await fs.promises.readdir(this.cache, { withFileTypes: true });
    for (const entry of directories) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
      for (const action of [...retiredClips, ...revisedClips.keys()]) {
        for (const extension of ['.webm', '.hit']) {
          await fs.promises.rm(path.join(this.cache, entry.name, action + extension), { force: true });
        }
      }
    }
  }

  get(outfit: Outfit, look?: CustomLook): ClipSet | undefined {
    const bake = Boolean(look);
    const key = look ? createHash('sha256').update(JSON.stringify([cacheVersion, outfit.id, look])).digest('hex').slice(0, 32) : outfit.id;
    const directory = path.join(bake ? this.cache : this.presets, key);
    const specs = Object.fromEntries(Object.entries(outfit.animations).map(([id, clip]) => [id, clipSpec(clip)]));
    const available = Object.keys(specs).filter(id => {
      const name = bake ? revisedClips.get(id) ?? id : id;
      return fs.existsSync(path.join(directory, name + '.webm')) && fs.existsSync(path.join(directory, name + '.hit'));
    });
    if (!bake && !available.includes('idle')) return;
    return { root: `/clip/${bake ? 'cache' : 'stock'}/${key}`, available, bake, specs };
  }

  asset(pathname: string) {
    const match = /^\/clip\/(cache|stock)\/([a-z0-9_-]{1,48})\/([a-z0-9_-]{1,48})\.(webm|hit)$/.exec(pathname);
    if (!match) return;
    const [, kind, key, action, extension] = match;
    if (retiredClips.has(action)) return;
    if (kind === 'cache' && !/^[a-f0-9]{32}$/.test(key)) return;
    const name = kind === 'cache' ? revisedClips.get(action) ?? action : action;
    return { file: path.join(kind === 'cache' ? this.cache : this.presets, key, `${name}.${extension}`), type: extension === 'webm' ? 'video/webm' : 'application/octet-stream' };
  }

  async save(media: ClipSet, outfit: Outfit, action: unknown, value: unknown) {
    if (!media.bake || typeof action !== 'string' || !validAction.test(action) || !Object.hasOwn(media.specs, action) ||
        !value || typeof value !== 'object') throw Error('動畫快取參數無效。');
    const { video, hits } = value as Partial<BakedClip>;
    if (!(video instanceof Uint8Array) || video.length < 64 || video.length > 6_000_000 ||
        !Buffer.from(video.subarray(0, 4)).equals(webmHeader) || !(hits instanceof Uint8Array) || hits.length > 650_000) {
      throw Error('無法儲存透明動畫。');
    }
    const expected = Math.ceil(outfit.canvas.width * outfit.canvas.height / 8) * media.specs[action].count;
    if (inflateSync(hits, { maxOutputLength: expected }).length !== expected) throw Error('動畫命中資料長度無效。');
    const entry = this.asset(`${media.root}/${action}.webm`)!;
    const hitEntry = this.asset(`${media.root}/${action}.hit`)!;
    await fs.promises.mkdir(path.dirname(entry.file), { recursive: true });
    const suffix = `.${randomUUID()}.tmp`;
    try {
      await Promise.all([fs.promises.writeFile(entry.file + suffix, video), fs.promises.writeFile(hitEntry.file + suffix, hits)]);
      await fs.promises.rename(hitEntry.file + suffix, hitEntry.file);
      await fs.promises.rename(entry.file + suffix, entry.file);
    } finally {
      await Promise.all([fs.promises.unlink(entry.file + suffix).catch(() => undefined), fs.promises.unlink(hitEntry.file + suffix).catch(() => undefined)]);
    }
  }
}

export async function mediaResponse(request: Request, asset: { file: string; type: string }) {
  try {
    const bytes = new Uint8Array(await fs.promises.readFile(asset.file));
    const headers = new Headers({ 'Content-Type': asset.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    const range = request.headers.get('range');
    let body = bytes, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || start > end) {
        headers.set('Content-Range', `bytes */${bytes.length}`);
        return new Response(null, { status: 416, headers });
      }
      body = bytes.subarray(start, end + 1);
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    }
    headers.set('Content-Length', String(body.length));
    return new Response(body, { status, headers });
  } catch { return new Response(null, { status: 404 }); }
}
