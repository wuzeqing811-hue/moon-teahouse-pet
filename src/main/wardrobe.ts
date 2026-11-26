import type { CustomLook, Look, WardrobeCatalog } from '../shared/contracts';

export function parseLook(catalog: WardrobeCatalog, role: string, value: unknown): Look | undefined {
  if (!Object.hasOwn(catalog.defaults, role) || !value || typeof value !== 'object') return;
  const item = value as Partial<Look>;
  if (!catalog.tops.some(top => top.id === item.top) || !catalog.bottoms.some(bottom => bottom.id === item.bottom) ||
    !catalog.hairs.some(hair => hair.id === item.hair)) return;
  const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
  return { top: item.top!, bottom: item.bottom!, hair: item.hair!, hairColor: color(item.hairColor), eyeColor: color(item.eyeColor), active: item.active === true };
}

export function resolvedLook(catalog: WardrobeCatalog, role: string, value: unknown): CustomLook | undefined {
  const item = parseLook(catalog, role, value);
  if (!item?.active) return;
  return { ...item, top: catalog.tops.find(top => top.id === item.top)!, bottom: catalog.bottoms.find(bottom => bottom.id === item.bottom)! };
}
