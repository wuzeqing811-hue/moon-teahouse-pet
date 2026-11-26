import type { ReactionId } from '../shared/contracts';

const ink = '#4b344c';
type Pen = CanvasRenderingContext2D;
type Palette = [light: string, middle: string, dark: string];
type Motion = { x: number; y: number; tilt: number };
type Beat = { t: number; weight: number; air: number; tail: number };
const gold: Palette = ['#fff4bd', '#f6c574', '#926140'];
const rose: Palette = ['#fff2ec', '#eea8bd', '#a9577b'];
const green: Palette = ['#f6edba', '#acc77b', '#557853'];
const lilac: Palette = ['#ffedf8', '#c7afec', '#785d9d'];
const roleDetails: Record<string, { mouth: number; color: Palette }> = {
  girl: { mouth: 124, color: lilac },
  fox: { mouth: 119, color: rose },
};

function shape(ctx: Pen, d: string, fill?: string | CanvasGradient, stroke?: string, width = 1.4) {
  const path = new Path2D(d);
  if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(path); }
}

function mark(ctx: Pen, x: number, y: number, color: string, radius: number) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color; ctx.fill();
}

function gloss(ctx: Pen, colors: Palette) {
  const paint = ctx.createLinearGradient(-7, -8, 6, 9);
  paint.addColorStop(0, colors[0]); paint.addColorStop(.62, colors[1]); paint.addColorStop(1, colors[2]);
  return paint;
}

function spark(ctx: Pen, x: number, y: number, scale: number, colors = gold) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  shape(ctx, 'M0 -9 Q1.6 -2 8 0 Q1.5 1.4 0 9 Q-1.7 2 -8 0 Q-2 -1.8 0 -9Z', gloss(ctx, colors), colors[2], 1.1);
  mark(ctx, 0, -.5, colors[0], 1.2);
  ctx.restore();
}

function leaf(ctx: Pen, x: number, y: number, angle: number, scale: number, colors = green) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
  shape(ctx, 'M-8 9 Q-11 5 -6 -3 Q-2 -8 9 -10 Q12 3 6 8 Q1 13 -8 9Z', gloss(ctx, colors), colors[2]);
  shape(ctx, 'M-9 13 Q-4 5 6 -5 M-1 4 L-4 0 M2 1 L6 2', undefined, colors[2], 1.1);
  shape(ctx, 'M-6 4 Q-3 -3 4 -5', undefined, colors[0], 1.15);
  ctx.restore();
}

function teacup(ctx: Pen, x: number, y: number, t: number) {
  ctx.save(); ctx.translate(x, y);
  shape(ctx, 'M9 -3 Q18 -6 18 1 Q17 7 8 8', undefined, '#513b4e', 4.8);
  shape(ctx, 'M9 -3 Q18 -6 18 1 Q17 7 8 8', undefined, '#eed8a9', 2.3);
  shape(ctx, 'M-18 9 Q0 4 18 9 Q15 14 0 14 Q-14 14 -18 9Z', gloss(ctx, ['#fff6db', '#e5b8c9', '#925f92']), ink);
  shape(ctx, 'M-12 -5 Q0 -9 12 -5 Q12 9 2 11 Q-10 11 -12 -5Z', gloss(ctx, ['#fff7e9', '#e4d3f3', '#9a78b1']), ink);
  shape(ctx, 'M-11 -5 Q0 -10 11 -5 Q4 0 -5 -2Q-10 -3 -11 -5Z', '#ae6f51', '#694451');
  shape(ctx, 'M1 1 Q-6 2 -3 7 Q0 9 3 5 Q-2 6 1 1Z', '#ffe39b', '#a3714a', 1);
  ctx.save(); ctx.translate(Math.sin(t * 9) * 2, -4);
  shape(ctx, 'M-4 -8 Q-9 -14 -4 -18 Q1 -23 -2 -28 M5 -10 Q10 -15 6 -20', undefined, '#b4869d', 1.9);
  ctx.restore(); ctx.restore();
}

function bubble(ctx: Pen, x: number, y: number, radius: number, colors: Palette) {
  ctx.save(); ctx.translate(x, y); ctx.scale(radius / 12, radius / 12);
  const air = ctx.createRadialGradient(-3, -4, 1, 1, 1, 12);
  air.addColorStop(0, '#fff9ed16'); air.addColorStop(.52, '#eae4ff4d'); air.addColorStop(.82, colors[1]); air.addColorStop(1, '#acdbe6c8');
  shape(ctx, 'M12 0 A12 12 0 1 1 -12 0 A12 12 0 1 1 12 0Z', air, colors[2], 1.15);
  shape(ctx, 'M-8 -3 Q-8 -8 -2 -9 M4 8 Q8 6 8 3', undefined, '#fff9f2', 1.5);
  mark(ctx, -5.2, -6.6, '#ffffff', 1.25);
  ctx.restore();
}

function jumpMotion(id: ReactionId, { air }: Beat): Motion | undefined {
  if (id === 'leaf-pounce') return { x: 13 * air, y: -8 * air, tilt: .055 * air };
}

function beatAt(index: number, count: number): Beat {
  const t = index / (count - 1);
  const edge = Math.min(1, index / 3, (count - index - 1) / 3);
  const weight = edge * edge * (3 - 2 * edge);
  const air = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - .18) / .57)));
  return { t, weight, air, tail: Math.sin(t * 32) * .23 * weight };
}

type Decoration = (ctx: Pen, beat: Beat, dressed: boolean, role: string) => void;
const effects: Record<ReactionId, Decoration> = {
  'tea-serve': (ctx, { t, weight }, dressed) => {
    teacup(ctx, dressed ? 109 : 115, (dressed ? 184 : 190) + 8 * (1 - weight), t);
    spark(ctx, 89, 155 - weight * 5, .48 + .18 * weight);
  },
  'shy-wink': (ctx, { t, weight }) => {
    shape(ctx, 'M132 117 l3 -2 m0 4 l4 -3 m42 1 l4 -3 m0 4 l4 -3', undefined, '#c96984', 1.35);
    leaf(ctx, 229 + t * 12, 99 - t * 23, -t * 2.3, .49, rose);
    leaf(ctx, 248 + t * 6, 78 - t * 10, t * 2.2, .3, rose);
    spark(ctx, 217, 83 - t * 5, .34 + .19 * weight, rose);
  },
  'moon-bow': (ctx, { t, weight }) => {
    ctx.save(); ctx.translate(238, 126 - 17 * t);
    shape(ctx, 'M5 -11 C-15 -11 -17 13 3 14 Q9 12 11 9 C-2 12 -7 -3 5 -11Z', gloss(ctx, gold), '#956348', 1.4);
    ctx.restore();
    shape(ctx, 'M209 156 Q230 153 247 138', undefined, '#b78469', 1.65);
    spark(ctx, 258, 111 - 14 * t, .46 + .18 * weight);
  },
  scent: (ctx, { t, weight }) => {
    ctx.save(); ctx.translate(224 + 4 * Math.sin(t * 13), 121 - 9 * weight);
    shape(ctx, 'M31 3 Q16 14 9 3 Q5 -3 11 -6 Q15 -8 17 -3 M18 14 Q8 19 1 14 Q-4 10 -1 7', undefined, '#69927c', 2.5);
    leaf(ctx, 34, -3, t * 1.5, .54);
    ctx.restore();
  },
  'tail-wag': (ctx, { t, tail }) => {
    const turn = Math.abs(tail) * 34;
    shape(ctx, `M61 ${158 + turn} Q53 174 59 190 M51 ${164 + turn} Q47 173 49 181`, undefined, '#bc774b', 2.3);
    spark(ctx, 71 - 8 * t, 141 - 22 * t, .81);
    spark(ctx, 57 + 4 * t, 202 - 7 * t, .43, rose);
  },
  'leaf-pounce': (ctx, { t, air }) => {
    leaf(ctx, 231 + 29 * t, 100 + 46 * t, .8 - 4.2 * t, 1.03);
    leaf(ctx, 253 + 19 * t, 130 + 52 * t, -t * 2, .54, gold);
    if (air > .25) shape(ctx, 'M91 185 Q66 184 60 197 M80 195 Q68 196 64 203', undefined, '#b0845f', 1.9);
    else spark(ctx, 202, 265, .73, green);
  },
  catnap: (ctx, { t, weight }, _dressed, role) => {
    const colors = roleDetails[role].color;
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.translate(218 + i * 18 + 8 * t, 110 - i * 16 - 18 * t);
      const scale = weight * (.42 + i * .18 + .08 * Math.sin(t * 17 + i));
      ctx.scale(scale, scale); ctx.rotate(-.17 + i * .16);
      shape(ctx, 'M-8 -8 H8 L-7 8 H8', undefined, colors[2], 4.6);
      shape(ctx, 'M-8 -8 H8 L-7 8 H8', undefined, colors[0], 1.8);
      ctx.restore();
    }
    bubble(ctx, 182 + 5 * weight, roleDetails[role].mouth + 5, 5 + 3 * Math.sin(t * 20) ** 2, colors);
  },
};

export function winkEye(ctx: Pen, closed: HTMLImageElement) {
  ctx.save();
  ctx.clip(new Path2D('M164 100 Q175 98 190 104 L192 114 Q185 123 171 123 L165 119Z'));
  ctx.drawImage(closed, 0, 0);
  ctx.restore();
}

export function drawReaction(ctx: Pen, id: ReactionId, index: number, count: number, dressed: boolean, role: string, figure: (beat: Beat) => void, bodyReady?: () => void) {
  const beat = beatAt(index, count);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const jump = jumpMotion(id, beat);
  if (jump) {
    const ground = role === 'fox' ? 286 : 290;
    ctx.translate(160 + jump.x, ground + jump.y); ctx.rotate(jump.tilt); ctx.translate(-160, -ground);
  }
  figure(beat);
  bodyReady?.();
  if (beat.weight > 0) {
    ctx.globalAlpha = beat.weight;
    effects[id](ctx, beat, dressed, role);
  }
  ctx.restore();
}
