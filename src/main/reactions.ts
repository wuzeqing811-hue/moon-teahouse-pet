import type { Animation, Outfit, ReactionId } from '../shared/contracts';

type Role = 'girl' | 'fox';
type Recipe = { id: ReactionId; label: string; track: string };
const recipes: Record<Role, Recipe[]> = {
  girl: [
    { id: 'tea-serve', label: '端茶淺笑', track: 'IIIBBBBBBBIIIII' },
    { id: 'shy-wink', label: '害羞眨眼', track: 'IIIIIIIIIIIIII' },
    { id: 'moon-bow', label: '提裙行禮', track: 'IIIIBBBBBBBIIII' },
  ],
  fox: [
    { id: 'scent', label: '歪頭嗅聞', track: 'IIIIIIIIIIIIIIIIII' },
    { id: 'tail-wag', label: '瞇眼甩尾', track: 'IIBBBBBBBBBBBBII' },
    { id: 'leaf-pounce', label: '跳撲落葉', track: 'IIIIIIIIIIIBIIIII' },
  ],
};

const fallbackClicks: Record<Role, ReactionId> = { girl: 'shy-wink', fox: 'leaf-pounce' };
const catnap: Recipe = { id: 'catnap', label: '打瞌睡', track: 'IIIBBBBBBBBBBBBBBBBIII' };
const source: Record<string, number> = { I: 0, B: 2 };
const waveTrack = '000111222111222111222111000';

// Only the built-in character artwork has the landmarks used by these reactions.
export function addReactions(outfit: Outfit) {
  if (!Object.hasOwn(recipes, outfit.characterId) || outfit.canvas.width !== 320 || outfit.canvas.height !== 320) return;
  const click = outfit.animations.click;
  if (click?.frames.length === 3) {
    const frames = [...waveTrack].map(pose => click.frames[Number(pose)]);
    outfit.animations.click = { ...click, frames, fps: 12, loop: false, wave: true };
  }
  for (const { id, label, track } of [...recipes[outfit.characterId as Role], catnap]) {
    const frames = [...track].map(pose => outfit.animations.idle.frames[source[pose]]);
    if (frames.every(Boolean)) {
      const motion: Animation = { frames, label, fps: 10, loop: false, reaction: id };
      outfit.animations[id] = motion;
    }
  }
}

export function clickAction(outfit: Outfit) {
  if (!Object.hasOwn(fallbackClicks, outfit.characterId)) return 'click';
  if (outfit.animations.catnap?.reaction === 'catnap') return 'catnap';
  const id = fallbackClicks[outfit.characterId as Role];
  return outfit.animations[id]?.reaction === id ? id : 'click';
}
