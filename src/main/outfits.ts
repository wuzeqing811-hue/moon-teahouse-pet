import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Animation, Outfit } from '../shared/contracts';
import { addReactions } from './reactions';

const slug = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const pngFile = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.png$/;
export const validId = (id: unknown): id is string => typeof id === 'string' && slug.test(id);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type OutfitPackage = { manifest: Outfit; files: Map<string, string>; builtIn: boolean };
export type PixelMask = { width: number; height: number; pixels: Uint8Array; packed?: true };

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('角色清单格式无效。');
  return value as Record<string, unknown>;
}

function label(value: unknown, fallback?: string, max = 80): string {
  if (typeof value === 'string' && value.trim() && value.trim().length <= max) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error('角色包需要有效的显示名称。');
}

function imageName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 180 || !pngFile.test(value)) throw new Error('角色包 PNG 路径无效。');
  return value;
}

function safeFile(root: string, name: string, max: number) {
  const file = path.join(root, name);
  const logical = path.relative(root, fs.realpathSync(file));
  if (logical === '..' || logical.startsWith(`..${path.sep}`) || path.isAbsolute(logical)) throw Error('角色包文件超出所选目录。');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > max) throw Error(`文件无效或过大（${name}）。`);
  return file;
}

function imageSize(file: string) {
  // Electron can read files in ASAR transparently via readFileSync.
  const bytes = fs.readFileSync(file);
  const header = bytes.subarray(0, 24);
  if (header.length !== 24 || !header.subarray(0, 8).equals(pngSignature) || header.toString('ascii', 12, 16) !== 'IHDR') {
    throw Error(`无效的 PNG（${path.basename(file)}）。`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

export function readOutfit(directory: string, builtIn = false): OutfitPackage {
  const root = fs.realpathSync(directory);
  const raw = record(JSON.parse(fs.readFileSync(safeFile(root, 'manifest.json', 128_000), 'utf8')));
  if (!validId(raw.id)) throw new Error('角色包 id 需为小写字母、数字、短横线或下划线。');
  if (raw.characterId !== undefined && !validId(raw.characterId)) throw new Error('角色 ID 无效。');
  const name = label(raw.name);
  const mask = imageName(raw.mask);
  const tray = raw.tray === undefined ? undefined : imageName(raw.tray);
  const files = new Map<string, string>();
  const dimensions = (relative: string) => {
    const file = safeFile(root, relative, 4_000_000);
    files.set(relative, file);
    const size = imageSize(file);
    if (!size.width || !size.height || size.width > 1024 || size.height > 1024) throw new Error('PNG 尺寸需在 1–1024 像素内。');
    return size;
  };
  const { width, height } = dimensions(mask);
  if (width !== height) throw Error('角色画布需为正方形。');
  const anim = Object.entries(record(raw.animations));
  if (!anim.length || anim.length > 16) throw Error('角色包需包含 1–16 组动作。');
  const animations: Record<string, Animation> = Object.create(null);
  for (const [key, object] of anim) {
    if (!validId(key)) throw Error('动作 id 无效。');
    const entry = record(object);
    if (!Array.isArray(entry.frames) || !entry.frames.length || entry.frames.length > 60 || typeof entry.fps !== 'number' ||
      !Number.isFinite(entry.fps) || entry.fps < 1 || entry.fps > 60 || typeof entry.loop !== 'boolean') throw Error(`动作参数无效（${key}）。`);
    const frames = entry.frames.map(frame => {
      const relative = imageName(frame);
      const frameSize = dimensions(relative);
      if (width !== frameSize.width || height !== frameSize.height) throw Error(`动作帧和遮罩尺寸不同（${relative}）。`);
      return relative;
    });
    animations[key] = { frames, fps: entry.fps, loop: entry.loop, label: label(entry.label, key) };
  }
  if (!animations.idle?.loop) throw Error('角色包需要一个循环 idle 动作。');
  if (tray) dimensions(tray);
  if (files.size > 300) throw Error('角色包最多支持 300 个 PNG 文件。');
  const sourceCanvas = raw.canvas === undefined ? undefined : record(raw.canvas);
  const sourceAnchor = sourceCanvas?.anchor === undefined ? undefined : record(sourceCanvas.anchor);
  const ax = sourceAnchor?.x ?? Math.round(width / 2);
  const ay = sourceAnchor?.y ?? Math.round(height * 0.55);
  if (typeof ax !== 'number' || !Number.isFinite(ax) || ax < 0 || ax >= width || typeof ay !== 'number' || !Number.isFinite(ay) || ay < 0 || ay >= height) {
    throw Error('锚点需位于角色画布内。');
  }
  const defaultSize = raw.defaultSize === undefined ? {} : record(raw.defaultSize);
  const size = typeof defaultSize.width === 'number' && Number.isFinite(defaultSize.width) ? Math.min(400, Math.max(80, Math.round(defaultSize.width))) : 160;
  const manifest: Outfit = {
    id: raw.id, name, characterId: raw.characterId ?? raw.id,
    characterName: label(raw.characterName, name), persona: label(raw.persona, '你是月亮茶屋的桌面伙伴，语气自然友好。', 1600),
    animations, mask, tray, defaultSize: { width: size, height: size }, canvas: { width, height, anchor: { x: ax, y: ay } },
  };
  if (builtIn) addReactions(manifest);
  return { manifest, files, builtIn };
}

export function loadMask(outfit: OutfitPackage): PixelMask {
  const { nativeImage } = require('electron') as typeof import('electron');
  const bitmap = nativeImage.createFromBuffer(fs.readFileSync(outfit.files.get(outfit.manifest.mask)!));
  const { width, height } = bitmap.getSize();
  if (bitmap.isEmpty() || width !== outfit.manifest.canvas.width || height !== outfit.manifest.canvas.height) throw Error('遮罩 PNG 无法读取。');
  return whiteMask(bitmap.toBitmap(), width, height);
}

function verifyImages(pack: OutfitPackage) {
  const { nativeImage } = require('electron') as typeof import('electron');
  for (const [name, file] of pack.files) {
    if (nativeImage.createFromBuffer(fs.readFileSync(file)).isEmpty()) throw Error(`PNG 无法解码（${name}）。`);
  }
}

export function whiteMask(bitmap: Uint8Array, width: number, height: number): PixelMask {
  if (bitmap.length !== width * height * 4) throw Error('遮罩像素长度无效。');
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 4;
    // White and black are independent of the order of the three color channels.
    pixels[i] = bitmap[offset] === 255 && bitmap[offset + 1] === 255 && bitmap[offset + 2] === 255 && bitmap[offset + 3] === 255 ? 1 : 0;
  }
  if (!pixels.includes(1)) throw Error('遮罩没有不透明的纯白命中像素。');
  return { width, height, pixels };
}

export class OutfitLibrary {
  readonly entries = new Map<string, OutfitPackage>();
  readonly problems: string[] = [];
  constructor(private readonly bundled: string, readonly custom: string) { fs.mkdirSync(custom, { recursive: true }); }

  scan() {
    this.entries.clear();
    this.problems.length = 0;
    for (const [folder, builtIn] of [[this.bundled, true], [this.custom, false]] as const) {
      for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!item.isDirectory() || item.name.startsWith('.')) continue;
        try {
          const pack = readOutfit(path.join(folder, item.name), builtIn);
          if (this.entries.has(pack.manifest.id)) throw Error(`服装 ID 重复（${pack.manifest.id}）。`);
          loadMask(pack);
          if (!builtIn) verifyImages(pack);
          this.entries.set(pack.manifest.id, pack);
        } catch (error) { this.problems.push(`${item.name} · ${(error as Error).message}`); }
      }
    }
    return this.list();
  }

  list() { return [...this.entries.values()].map(pack => pack.manifest); }

  import(directory: string) {
    const pack = readOutfit(directory);
    loadMask(pack);
    verifyImages(pack);
    const dest = path.join(this.custom, pack.manifest.id);
    if (this.entries.has(pack.manifest.id) || fs.existsSync(dest)) throw Error('已有相同 ID 的服装。请修改导入包 manifest.json 中的 id。');
    const staging = fs.mkdtempSync(path.join(this.custom, '.import-'));
    try {
      for (const [relative, source] of pack.files) {
        const target = path.join(staging, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(pack.manifest, null, 2));
      readOutfit(staging);
      fs.renameSync(staging, dest);
      const imported = readOutfit(dest);
      this.entries.set(imported.manifest.id, imported);
      return imported.manifest;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
}
