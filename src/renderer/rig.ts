import type { CustomLook, Outfit } from '../shared/contracts';
import { lowerParts, upperParts, type Arm, type Art, type Pose } from './illustrated.js';
import { drawReaction, winkEye } from './reaction-art.js';
import { actionPose, poseFigure, type JointPose } from './joints.js';

const ink = '#382d45';
const skin = '#ffddc2';
const fur = '#df8767';
const artSize = 320;
const roleColors: Record<string, string> = { girl: '#7767a6', fox: '#bc624f' };
const spare = document.createElement('canvas');
spare.width = spare.height = artSize;
const layer = spare.getContext('2d', { willReadFrequently: true })!;
const articulated = document.createElement('canvas');
articulated.width = articulated.height = artSize;
const poseLayer = articulated.getContext('2d', { willReadFrequently: true })!;

export const loadImage = async (url: string) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};

function path(ctx: CanvasRenderingContext2D, value: string, fill?: string | CanvasGradient, stroke?: string, width = 1.6) {
  const shape = new Path2D(value);
  if (fill) { ctx.fillStyle = fill; ctx.fill(shape); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(shape); }
  return shape;
}

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.55; ctx.stroke(); }
}

function symbol(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, color: string, size = 3) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 3, size / 3);
  if (kind === 'moon') path(ctx, 'M1,-4 C-7,-3 -5,6 3,3 C-1,3 -2,-1 1,-4Z', color);
  else if (kind === 'leaf') {
    path(ctx, 'M-3,4 Q-4,-4 5,-5 Q5,3 -3,4Z', color);
    path(ctx, 'M-4,5 L2,-2', undefined, '#fff8df', .6);
  } else if (kind === 'star' || kind === 'diamond') path(ctx, 'M0,-5 Q1,-1 5,0 Q1,1 0,5 Q-1,1 -5,0 Q-1,-1 0,-5Z', color);
  else if (kind === 'flower') {
    for (let i = 0; i < 5; i++) { ctx.rotate(Math.PI * 2 / 5); oval(ctx, 0, -2.5, 1.55, 2, color); }
    oval(ctx, 0, 0, 1.3, 1.3, '#f4cf8a');
  } else oval(ctx, 0, 0, 1.7, 1.7, color);
  ctx.restore();
}

type Figure = Pose & { skin: string; fox: boolean };
type LookArt = { look: CustomLook; art: Art };
type Details = { wink?: HTMLImageElement; waveFace?: HTMLImageElement };
const figures: Record<string, { shoulder: number; contact: number }> = { girl: { shoulder: 143, contact: 290 }, fox: { shoulder: 138, contact: 286 } };

function tail(ctx: CanvasRenderingContext2D, figure: Figure) {
  ctx.save();
  if (figure.drag) { ctx.translate(0, 3); ctx.rotate(figure.alternate ? -.035 : .025); }
  const shape = 'M131 194 C119 207 103 212 87 201 C66 194 71 173 82 154 C89 143 84 135 81 137 C96 126 116 137 120 152 C125 166 116 176 127 182 Z';
  path(ctx, shape, '#ce795a', ink, 2);
  ctx.save(); ctx.clip(new Path2D(shape));
  path(ctx, 'M76 145 C87 149 91 165 87 175 C96 167 104 164 107 152 L114 159 Q123 142 111 135 L81 127 Z', '#ffe5bf');
  path(ctx, 'M77 189 Q90 205 107 201 Q101 198 98 191 Q112 197 124 183 L136 194 Q115 222 88 205Z', '#a55e50');
  path(ctx, 'M92 139 Q110 141 112 151 M78 181 Q78 197 88 199', undefined, '#ffe5c9', 1.2);
  ctx.restore(); ctx.restore();
}


function skinGradient(ctx: CanvasRenderingContext2D, figure: Figure, x: number, y: number) {
  const fill = ctx.createLinearGradient(x - 8, y - 3, x + 10, y + 9);
  fill.addColorStop(0, figure.fox ? '#f4af87' : '#ffecce');
  fill.addColorStop(.55, figure.skin);
  fill.addColorStop(1, figure.fox ? '#bb705c' : '#dfa19a');
  return fill;
}

function legs(ctx: CanvasRenderingContext2D, figure: Figure, feet: [number, number][]) {
  for (const [index, [x, y]] of feet.entries()) {
    const start = index === 0 ? 148 : 172;
    path(ctx, `M${start - 8} 181 Q${start - 7} 222 ${x - 6} ${y - 12} L${x + 6} ${y - 12} Q${start + 10} 220 ${start + 9} 181Z`, skinGradient(ctx, figure, x, y - 42), ink, 1.55);
    path(ctx, `M${x - 7} ${y - 32} Q${x - 3} ${y - 36} ${x} ${y - 33} Q${x + 4} ${y - 36} ${x + 7} ${y - 32} L${x + 7} ${y - 10} H${x - 7}Z`, '#f9e7dc', ink, 1.5);
    path(ctx, `M${x - 6} ${y - 30} Q${x} ${y - 27} ${x + 6} ${y - 30} M${x + 4} ${y - 29} L${x + 4} ${y - 12}`, undefined, '#cbaab2', 1.05);
    const shoe = ctx.createLinearGradient(x - 7, y - 14, x + 5, y);
    shoe.addColorStop(0, '#80719b'); shoe.addColorStop(.45, '#565174'); shoe.addColorStop(1, '#41364d');
    path(ctx, `M${x - 8} ${y - 13} Q${x} ${y - 17} ${x + 7} ${y - 12} Q${x + 13} ${y - 5} ${x + 8} ${y - 1.8} Q${x} ${y + .7} ${x - 8} ${y - 2} Q${x - 12} ${y - 6} ${x - 8} ${y - 13}Z`, shoe, ink, 1.8);
    path(ctx, `M${x - 8} ${y - 9} Q${x - 2} ${y - 12} ${x + 5} ${y - 9} M${x - 6} ${y - 3.7} Q${x} ${y - 2.4} ${x + 7} ${y - 4}`, undefined, '#cfa997', 1.05);
    oval(ctx, x + 4.7, y - 9.5, 1.65, 1.45, '#eac890', '#655064');
  }
}

function exposedSleeve(ctx: CanvasRenderingContext2D, arm: Arm, figure: Figure) {
  if (!arm.short) return;
  const [x, y] = arm.end;
  const [elbowX, elbowY] = arm.elbow;
  const [handX, handY] = arm.hand;
  const shape = `M${x} ${y} Q${elbowX} ${elbowY} ${handX} ${handY}`;
  path(ctx, shape, undefined, ink, 11.2);
  ctx.save();
  const light = ctx.createLinearGradient(Math.min(x, handX) - 4, handY - 5, Math.max(x, handX) + 2, handY + 5);
  light.addColorStop(0, figure.fox ? '#eba37b' : '#ffe6c9'); light.addColorStop(.5, figure.skin); light.addColorStop(1, figure.fox ? '#bd715d' : '#dda097');
  ctx.strokeStyle = light;
  ctx.lineWidth = 8.1;
  ctx.stroke(new Path2D(shape));
  ctx.restore();
}

function hand(ctx: CanvasRenderingContext2D, arm: Arm, figure: Figure) {
  ctx.save(); ctx.translate(...arm.hand); ctx.scale(arm.side === -1 ? -1 : 1, 1);
  if (arm.wave) ctx.rotate(.27 + (figure.alternate ? -.18 : .22));
  else ctx.rotate(figure.drag ? -.75 : .18);
  const shape = arm.wave ? 'M-4 6 Q-8 1 -8 -3 Q-7 -6 -4 -3 L-2 -1 L-3 -11 Q-1 -14 1 -11 L2 -4 L3 -13 Q5 -14 6 -11 L6 -4 L8 -9 Q10 -10 10 -7 L9 -2 L11 -4 Q13 -4 12 -1 Q10 8 4 9Z' :
    'M-4 -6 Q2 -8 5 -3 Q8 1 7 5 Q4 9 0 8 Q-5 8 -6 4 Q-8 1 -7 -2Z';
  path(ctx, shape, skinGradient(ctx, figure, 0, 0), ink, 1.4);
  path(ctx, arm.wave ? 'M-3 1 Q0 0 1 4 M4 4 Q7 3 8 1' : 'M0 3 Q2 4 3 6 M4 2 Q5 3 5 4', undefined, figure.fox ? '#ab6856' : '#c89492', .8);
  ctx.restore();
}

function extraHair(ctx: CanvasRenderingContext2D, style: string, color: string, role: string, figure: Figure) {
  if (style === 'original') return;
  ctx.save();
  ctx.translate(0, figure.drag ? 3 : figure.breathe);
  const gradient = ctx.createLinearGradient(94, 42, 183, 184);
  gradient.addColorStop(0, color); gradient.addColorStop(.7, color); gradient.addColorStop(1, '#4a364e');
  const scale = role === 'girl' ? 1.01 : .93;
  ctx.translate(160, 0); ctx.scale(scale, 1); ctx.translate(-160, 0);
  if (style === 'buns') {
    for (const x of [101, 219]) {
      oval(ctx, x, 59, 20, 19, color, ink);
      path(ctx, `M${x - 11} 58 Q${x - 4} 43 ${x + 11} 51 M${x - 9} 63 Q${x} 51 ${x + 12} 58`, undefined, '#fff3e165', 2.1);
      symbol(ctx, 'star', x + (x < 160 ? -11 : 11), 50, '#ecc184', 4);
    }
  } else if (style === 'pony') {
    path(ctx, 'M201 66 C229 53 251 71 245 92 C239 112 248 130 259 141 C249 151 227 152 217 141 C201 127 213 106 206 94 Z', gradient, ink, 2.1);
    path(ctx, 'M218 76 Q238 81 230 101 Q221 134 251 140', undefined, '#fbe4f278', 2.6);
    path(ctx, 'M214 70 Q222 73 222 83', undefined, '#ecc684', 3.2);
  } else if (style === 'braids') {
    for (const x of [113, 207]) {
      for (let i = 0; i < 6; i++) {
        const y = 119 + i * 9;
        const dx = i % 2 ? 3 : -3;
        oval(ctx, x + dx, y, 9 - i * .55, 9 - i * .42, color, ink);
        path(ctx, `M${x + dx - 4} ${y - 2} Q${x + dx} ${y - 7} ${x + dx + 5} ${y - 4}`, undefined, '#fff4f385', 1.15);
      }
      path(ctx, `M${x} 166 q-14 -8 -13 2 q5 6 13 0 q12 7 13 0 q-2 -8 -13 -2Z`, '#c67499', ink, 1.3);
    }
  } else if (style === 'waves') {
    for (const sign of [-1, 1]) {
      ctx.save(); ctx.translate(160, 0); ctx.scale(sign, 1);
      path(ctx, 'M33 83 C64 94 61 118 65 133 C67 146 82 157 71 172 Q66 179 57 175 Q66 167 55 162 Q35 184 25 176 Q39 171 34 152 Q13 113 33 83Z', gradient, ink, 2.2);
      path(ctx, 'M45 111 Q51 132 58 145 Q67 158 61 167 M34 127 Q45 149 43 162', undefined, '#ffe3df68', 2.1);
      ctx.restore();
    }
  } else {
    path(ctx, 'M107 76 Q89 88 97 122 Q100 140 121 146 L136 130 H184 L199 145 Q220 139 223 121 Q227 90 212 77Z', gradient, ink, 2);
  }
  ctx.restore();
}

const heads: Record<string, string> = {
  girl: 'M53 19 H269 V150 Q251 163 225 159 L191 156 L179 136 Q160 140 143 136 L131 154 L95 159 Q70 159 53 146 Z',
  fox: 'M78 18 H244 V137 Q223 149 188 139 L177 129 Q160 134 145 129 L131 139 Q101 150 78 135Z',
};
// The smiling expression is inside these bounds, clear of the hand drawn into the original PNG.
const waveFaces: Record<string, string> = {
  girl: 'M118 90 H199 V113 L190 119 L184 131 L173 139 H133 L118 134Z',
  fox: 'M113 82 H200 V105 L191 115 L184 126 L172 133 H137 L114 126Z',
};

function colorBytes(color: string) { return [1, 3, 5].map(position => Number.parseInt(color.slice(position, position + 2), 16)); }

function head(ctx: CanvasRenderingContext2D, role: string, image: HTMLImageElement, look: CustomLook, figure: Figure, details?: Details) {
  layer.clearRect(0, 0, 320, 320);
  layer.save();
  layer.translate(0, figure.drag ? 3 : figure.breathe);
  layer.clip(new Path2D(heads[role] ?? heads.girl));
  if (look.hair === 'bob') layer.clip(new Path2D('M60 10 H263 V91 Q221 96 220 112 Q217 132 207 147 Q193 147 183 134 L139 134 Q128 147 115 147 Q103 136 101 119 Q100 103 60 95Z'));
  layer.translate(0, -(figure.drag ? 3 : figure.breathe));
  layer.drawImage(image, 0, 0);
  if (details?.wink) winkEye(layer, details.wink);
  if (details?.waveFace) {
    layer.save();
    layer.clip(new Path2D(waveFaces[role]));
    layer.drawImage(details.waveFace, 0, figure.alternate ? 1 : 2);
    layer.restore();
  }
  layer.restore();
  if (look.hairColor || look.eyeColor) {
    const pixels = layer.getImageData(0, 0, 320, 170);
    const data = pixels.data;
    const hair = look.hairColor ? colorBytes(look.hairColor) : undefined;
    const eyes = look.eyeColor && !figure.wave ? colorBytes(look.eyeColor) : undefined;
    const eyeY = (role === 'girl' ? 112 : 105) + (figure.drag ? 3 : figure.breathe);
    const eyeX = [147, 174];
    const eyeHeight = role === 'girl' ? 7.5 : 6.4;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue;
      const x = (i >> 2) % 320;
      const y = Math.floor((i >> 2) / 320);
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const pupil = eyeX.some(center => ((x - center) / 6.35) ** 2 + ((y - eyeY) / eyeHeight) ** 2 < 1);
      const irisTone = role === 'girl' ? b - g > 17 && b > r && r > 46 : r - b > 80 && g - b > 31;
      const hairTone = role === 'fox' ? ((y >= 58 && x >= 103 && x < 219 && (y < 105 || x < 130 || x > 191)) || (x > 144 && x < 180 && y < 58)) && r - g > 40 && g - b > 5 && g - b < 55 && r - b > 68 :
        b - g > 14 && b - r > 9 && y < (role === 'girl' ? 156 : 129);
      const target = pupil && irisTone ? eyes : !pupil && hairTone ? hair : undefined;
      if (!target) continue;
      const brightness = .25 * r + .61 * g + .14 * b;
      const base = pupil ? role === 'fox' ? 166 : 111 : role === 'fox' ? 134 : 100;
      for (let channel = 0; channel < 3; channel++) data[i + channel] = target[channel] + (brightness - base) * (pupil ? 1.15 : .93);
    }
    layer.putImageData(pixels, 0, 0);
  }
  ctx.drawImage(spare, 0, 0);
}

export function drawLook(ctx: CanvasRenderingContext2D, role: string, image: HTMLImageElement, look: CustomLook, art: Art, action = 'idle', index = 0, details?: Details) {
  const profile = figures[role] ?? figures.girl;
  const figure: Figure = { ...profile, skin: role === 'fox' ? fur : skin, fox: role === 'fox', wave: action === 'click' && index > 0,
    drag: action === 'drag', alternate: index % 2 === 0, breathe: action === 'idle' && !details ? [0, -1, -1, 0][index % 4] : 0 };
  if (!details) ctx.clearRect(0, 0, artSize, artSize);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (figure.fox) tail(ctx, figure);
  extraHair(ctx, look.hair, look.hairColor || roleColors[role] || roleColors.girl, role, figure);
  const lower = lowerParts(look.bottom, figure);
  legs(ctx, figure, lower.feet);
  lower.draw(ctx, art.lower);
  const upper = upperParts(look.top, figure);
  const neckY = figure.shoulder - 14;
  path(ctx, `M152 ${neckY} Q160 ${neckY - 3} 168 ${neckY} L169 ${neckY + 15} H151Z`, skinGradient(ctx, figure, 160, neckY + 7), ink, 1.35);
  upper.arms.forEach(arm => exposedSleeve(ctx, arm, figure));
  upper.draw(ctx, art.upper);
  head(ctx, role, image, look, figure, details);
  upper.arms.forEach(arm => hand(ctx, arm, figure));
}

function drawWave(ctx: CanvasRenderingContext2D, role: string, index: number, image: HTMLImageElement, neutral: HTMLImageElement, dressed?: LookArt) {
  ctx.clearRect(0, 0, artSize, artSize);
  if (dressed) {
    drawLook(ctx, role, neutral, dressed.look, dressed.art, 'click', index, index ? { waveFace: image } : undefined);
    return;
  }
  ctx.drawImage(image, 0, 0);
  if (!index) return;
  if (role === 'girl') {
    // Restore the ribbon where the old hearts were painted over it.
    ctx.clearRect(214, 65, 49, 58);
    ctx.save();
    ctx.beginPath();
    ctx.rect(214, 65, 49, 58);
    ctx.clip();
    ctx.drawImage(neutral, 0, index === 1 ? -2 : -1);
    ctx.restore();
  } else {
    // The other characters' hearts are outside the figure.
    ctx.clearRect(role === 'fox' ? 220 : 226, 39, 56, 78);
  }
}

export function drawJointPreview(ctx: CanvasRenderingContext2D, role: string, image: HTMLImageElement, pose: JointPose, dressed?: LookArt) {
  ctx.clearRect(0, 0, artSize, artSize);
  if (dressed) drawLook(ctx, role, image, dressed.look, dressed.art);
  else ctx.drawImage(image, 0, 0);
  poseFigure(ctx, role, Boolean(dressed), pose);
}

export function drawCharacterFrame(ctx: CanvasRenderingContext2D, outfit: Outfit, action: string, index: number, image: HTMLImageElement, dressed?: LookArt, alternate?: HTMLImageElement, bodyReady?: () => void,
  sample?: { index: number; count: number }) {
  const animation = outfit.animations[action];
  const reaction = animation.reaction;
  if (animation.wave && alternate) {
    const wave = [...new Set(animation.frames)].indexOf(animation.frames[index]);
    drawWave(ctx, outfit.characterId, wave, image, alternate, dressed);
    return;
  }
  if (!reaction) {
    if (dressed) drawLook(ctx, outfit.characterId, image, dressed.look, dressed.art, action, index);
    else { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.drawImage(image, 0, 0); }
    return;
  }
  ctx.clearRect(0, 0, artSize, artSize);
  drawReaction(ctx, reaction, sample?.index ?? index, sample?.count ?? animation.frames.length, Boolean(dressed), outfit.characterId, beat => {
    const wink = reaction === 'shy-wink' && index >= 3 && index < 10 ? alternate : undefined;
    poseLayer.clearRect(0, 0, artSize, artSize);
    if (dressed) {
      drawLook(poseLayer, outfit.characterId, image, dressed.look, dressed.art, 'idle', 0, { wink });
    } else {
      poseLayer.drawImage(image, 0, 0);
      if (wink) winkEye(poseLayer, wink);
    }
    poseFigure(poseLayer, outfit.characterId, Boolean(dressed), actionPose(reaction, beat.t, beat.weight));
    ctx.drawImage(articulated, 0, 0);
  }, bodyReady);
}
