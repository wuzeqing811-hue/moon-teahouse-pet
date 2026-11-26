import type { Bottom, CustomLook, Garment } from '../shared/contracts';

type XY = [number, number];
export type Pose = { shoulder: number; contact: number; drag: boolean; wave: boolean; alternate: boolean; breathe: number };
export type Art = { upper: HTMLImageElement; lower: HTMLImageElement };
type Window = { x: number; y: number; width: number; height: number };

const cache = new Map<string, Promise<HTMLImageElement>>();
const swatches = new WeakMap<HTMLImageElement, Map<string, string>>();
const pipette = document.createElement('canvas');
pipette.width = pipette.height = 1;
const sampler = pipette.getContext('2d', { willReadFrequently: true })!;

export function garmentImage(id: string) {
  let ready = cache.get(id);
  if (!ready) {
    const image = new Image();
    image.src = `/garment/${id}.png`;
    ready = image.decode().then(() => image).catch(error => { cache.delete(id); throw error; });
    cache.set(id, ready);
  }
  return ready;
}

export async function loadLookArt(look: CustomLook): Promise<Art> {
  const [upper, lower] = await Promise.all([garmentImage(look.top.id), garmentImage(look.bottom.id)]);
  return { upper, lower };
}

function polygon(points: XY[]) {
  const clip = new Path2D();
  points.forEach(([x, y], index) => index ? clip.lineTo(x, y) : clip.moveTo(x, y));
  clip.closePath();
  return clip;
}

function project(rect: Window, [x, y]: XY): XY { return [rect.x + x * rect.width, rect.y + y * rect.height]; }

function fabricColor(image: HTMLImageElement, [x, y]: XY) {
  let palette = swatches.get(image);
  if (!palette) { palette = new Map(); swatches.set(image, palette); }
  const key = `${x}/${y}`;
  let color = palette.get(key);
  if (!color) {
    sampler.clearRect(0, 0, 1, 1);
    sampler.drawImage(image, x * image.naturalWidth - 2, y * image.naturalHeight - 2, 4, 4, 0, 0, 1, 1);
    const [r, g, b, a] = sampler.getImageData(0, 0, 1, 1).data;
    color = a > 127 ? `rgb(${r} ${g} ${b})` : '#6d586b';
    palette.set(key, color);
  }
  return color;
}

function drawPart(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: Window, clip?: XY[]) {
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(rect.width, rect.height);
  if (clip) ctx.clip(polygon(clip));
  ctx.drawImage(image, 0, 0, 1, 1);
  ctx.restore();
}

function stretchPart(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: Window, clip: XY[], joint: XY, cuff: XY, end: XY) {
  const anchor = project(rect, joint);
  const original = project(rect, cuff);
  const v = [original[0] - anchor[0], original[1] - anchor[1]];
  const u = [end[0] - anchor[0], end[1] - anchor[1]];
  ctx.save();
  ctx.translate(...anchor);
  ctx.rotate(Math.atan2(u[1], u[0]));
  ctx.scale(Math.hypot(...u) / Math.hypot(...v), 1);
  ctx.rotate(-Math.atan2(v[1], v[0]));
  ctx.translate(-anchor[0], -anchor[1]);
  drawPart(ctx, image, rect, clip);
  ctx.restore();
}

type Tailoring = { width: number; hem: number; cuff: XY; split: number; short?: boolean };
// Measurements refer to each trimmed PNG. The cuff is measured from the left edge.
const tops: Record<string, Tailoring> = {
  'moon-blouse': { width: 106, hem: .96, cuff: [.15, .80], split: .30, short: true },
  'sea-sailor': { width: 100, hem: .96, cuff: [.13, .70], split: .27, short: true },
  'rust-rider': { width: 109, hem: .80, cuff: [.08, .93], split: .28 },
  'moss-hoodie': { width: 106, hem: .93, cuff: [.09, .94], split: .29 },
  'plum-wrap': { width: 111, hem: .75, cuff: [.17, .91], split: .31 },
  'berry-varsity': { width: 102, hem: .89, cuff: [.09, .93], split: .258 },
  'night-waistcoat': { width: 108, hem: .99, cuff: [.09, .93], split: .298 },
  'citrus-rain': { width: 103, hem: .89, cuff: [.10, .93], split: .28 },
  'lavender-knit': { width: 103, hem: .93, cuff: [.095, .94], split: .30 },
  'peony-puff': { width: 105, hem: .98, cuff: [.16, .91], split: .29, short: true },
  'denim-chore': { width: 104, hem: .95, cuff: [.10, .95], split: .264 },
  'comet-cape': { width: 104, hem: .96, cuff: [.19, .54], split: .30, short: true },
};

function mirror([x, y]: XY, side: number): XY { return [side < 0 ? x : 1 - x, y]; }

export function upperParts(item: Garment, pose: Pose) {
  const fit = tops[item.id];
  const cape = item.cut === 'cape';
  const neck = pose.shoulder - 10 + pose.breathe * .45;
  const width = fit.width;
  const rect = { x: 160 - width / 2, y: neck, width, height: (178 - neck) / fit.hem };
  const seam: XY[] = [[fit.split + .075, 0], [fit.split - .045, .21], [fit.split - .028, .36], [fit.split, .58], [fit.split - .01, 1]];
  const arms = [-1, 1].map(side => {
    const wave = side > 0 && pose.wave;
    const moving = !cape && (wave || pose.drag);
    const cuff = mirror(fit.cuff, side);
    const from = mirror([fit.split - .025, .32], side);
    const base = project(rect, cuff);
    const joint = project(rect, from);
    let end: XY = base;
    if (moving) {
      if (wave) end = fit.short ? [205, pose.shoulder + 8] : [212 + (pose.alternate ? 0 : 2), 134];
      else end = [base[0] + side * (fit.short ? 5 : 9), base[1] + (side > 0 ? -12 : -3) + (pose.alternate ? side * 4 : -side * 3)];
    }
    if (cape) end = [160 + side * 37, neck + 20];
    const hand: XY = fit.short ? wave ? [213, 119] : pose.drag ? [160 + side * (60 + (pose.alternate ? 2 : -1)), 178 + side * -4] : [160 + side * 49, 195] :
      [end[0] + (wave ? 3 : side * 3.3), end[1] + (wave ? -6 : 4.2)];
    const elbow: XY = wave ? [202, pose.shoulder + 19] : [(end[0] + hand[0]) / 2 + side * 1.4, (end[1] + hand[1]) / 2 + 2];
    return { side, wave, moving, short: Boolean(fit.short), cuff, from, end, elbow, hand, joint };
  });
  return {
    arms,
    draw(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
      if (!arms.some(arm => arm.moving)) { drawPart(ctx, image, rect); return; }
      const coreSide = (side: number) => arms.some(arm => arm.side === side && arm.moving) ? seam.map(([x, y]) => mirror([x - .042, y], side)) : [[side < 0 ? 0 : 1, 0], [side < 0 ? 0 : 1, 1]] as XY[];
      for (const arm of arms) {
        if (!arm.moving) continue;
        // The original fabric bridges the narrow shoulder seam as the sleeve turns.
        const [x, y] = arm.joint;
        const [wx, wy] = arm.end;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - arm.side * 4, y + 1);
        ctx.lineTo(x + (wx - x) * .48, y + (wy - y) * .48);
        ctx.lineWidth = fit.short ? 10 : 12;
        ctx.strokeStyle = '#382d45';
        ctx.stroke();
        ctx.lineWidth -= 2.5;
        ctx.strokeStyle = fabricColor(image, mirror([fit.split - .07, .37], arm.side));
        ctx.stroke();
        ctx.restore();
        const sleeve = [[0, 0], ...seam.map(([x,y]): XY => [x + .017, y]), [0, 1]] as XY[];
        stretchPart(ctx, image, rect, sleeve.map(point => mirror(point, arm.side)), arm.from, arm.cuff, arm.end);
      }
      drawPart(ctx, image, rect, [...coreSide(-1), ...coreSide(1).reverse()]);
    },
  };
}

export type Arm = ReturnType<typeof upperParts>['arms'][number];

const skirtSizes: Record<string, [number, number]> = { pleats: [111,64], ruffle: [120,67], wrap: [116,65], bubble: [112,57], petal: [116,64], tail: [116,72] };
type TrouserFit = { width: number; exposed: number; left: number; right: number; cuffY: number };
const trouserSizes: Record<string, TrouserFit> = {
  straight: { width: 72, exposed: 21, left: .21, right: .79, cuffY: .975 }, cargo: { width: 77, exposed: 19, left: .19, right: .78, cuffY: .975 },
  jogger: { width: 77, exposed: 22, left: .23, right: .77, cuffY: .97 }, culotte: { width: 91, exposed: 44, left: .29, right: .73, cuffY: .96 },
  shorts: { width: 73, exposed: 62, left: .29, right: .73, cuffY: .965 }, flare: { width: 88, exposed: 18, left: .29, right: .73, cuffY: .96 },
};

export function lowerParts(item: Bottom, pose: Pose) {
  const fit = trouserSizes[item.cut];
  const width = fit?.width ?? skirtSizes[item.cut][0];
  const height = fit ? (pose.contact - fit.exposed - 173) / fit.cuffY : skirtSizes[item.cut][1];
  const rect = { x: 160 - width / 2, y: 173, width, height };
  const footX = fit ? [rect.x + fit.left * width, rect.x + fit.right * width] : [148, 171];
  const feet: XY[] = footX.map((x, i) => {
    if (!pose.drag) return [x, pose.contact];
    return [x + (i ? -3 : -7) + (pose.alternate ? i ? 4 : -2 : 2), pose.contact - (i ? pose.alternate ? 5 : 10 : pose.alternate ? 18 : 22)];
  });
  return {
    feet,
    draw(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
      if (!pose.drag) { drawPart(ctx, image, rect); return; }
      if (!fit) {
        ctx.save(); ctx.translate(160, 174); ctx.rotate(pose.alternate ? .071 : -.062); ctx.translate(-160, -174);
        drawPart(ctx, image, rect);
        ctx.restore();
        return;
      }
      const lowerHalf: XY[] = [[0, .2], [.503, .2], [.503, 1], [0, 1]];
      for (const [index, foot] of feet.entries()) {
        const side = index === 0 ? -1 : 1;
        stretchPart(ctx, image, rect, lowerHalf.map(point => mirror(point, side)), mirror([.34,.285], side),
          [index === 0 ? fit.left : fit.right, fit.cuffY], [foot[0], foot[1] - fit.exposed]);
      }
      drawPart(ctx, image, rect, [[0,0],[1,0],[1,.34],[0,.34]]);
    },
  };
}

export function garmentThumbnail(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width = 210, height = 160) {
  const scale = Math.min((width - 10) / image.naturalWidth, (height - 7) / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
