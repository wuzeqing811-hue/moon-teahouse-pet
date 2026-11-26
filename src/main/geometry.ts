import type { ChatSize, Point } from '../shared/contracts';
import type { PixelMask } from './outfits';

export type Rect = Point & { width: number; height: number };
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const petSize = (n: number) => clamp(Math.round(n), 80, 400);
export const defaultChatSize: Readonly<ChatSize> = { width: 378, height: 512 };

export function readChatSize(value: unknown): ChatSize | undefined {
  if (!value || typeof value !== 'object') return;
  const { width, height } = value as Partial<ChatSize>;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return;
  return { width: clamp(Math.round(width), 300, 1600), height: clamp(Math.round(height), 320, 1600) };
}

export function hitMask(mask: PixelMask, bounds: Rect, position: Point): boolean {
  const x = Math.floor((position.x - bounds.x) * mask.width / bounds.width);
  const y = Math.floor((position.y - bounds.y) * mask.height / bounds.height);
  if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return false;
  const pixel = y * mask.width + x;
  return mask.packed ? (mask.pixels[pixel >> 3] & (1 << (pixel & 7))) !== 0 : mask.pixels[pixel] === 1;
}

export function fit(bounds: Rect, area: Rect): Rect {
  return { ...bounds,
    x: Math.round(clamp(bounds.x, area.x, area.x + Math.max(0, area.width - bounds.width))),
    y: Math.round(clamp(bounds.y, area.y, area.y + Math.max(0, area.height - bounds.height))),
  };
}

export function resizeAtAnchor(bounds: Rect, size: number, anchor: Point, area: Rect) {
  return fit({ x: bounds.x + (bounds.width - size) * anchor.x, y: bounds.y + (bounds.height - size) * anchor.y, width: size, height: size }, area);
}

export function chatPosition(pet: Rect, chat: ChatSize, area: Rect): Rect {
  const margin = 12;
  const width = Math.min(chat.width, area.width);
  const height = Math.min(chat.height, area.height);
  const right = pet.x + pet.width + margin;
  const left = pet.x - width - margin;
  const x = right + width <= area.x + area.width ? right : left >= area.x ? left : right;
  return fit({ width, height, x, y: pet.y + (pet.height - height) / 2 }, area);
}
