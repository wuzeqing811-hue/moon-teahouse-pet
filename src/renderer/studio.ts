import type { CustomLook, Garment, Look, Outfit, WardrobeState } from '../shared/contracts';
import { drawCharacterFrame, drawJointPreview, loadImage } from './rig.js';
import { joints, type Joint } from './joints.js';
import { garmentImage, garmentThumbnail, loadLookArt } from './illustrated.js';

const api = window.petAPI.wardrobe;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const preview = get<HTMLCanvasElement>('preview');
const painter = preview.getContext('2d')!;
const roles = get('roles');
const pieces = get('pieces');
const hairs = get('hairs');
const apply = get<HTMLButtonElement>('apply');
const preset = get<HTMLButtonElement>('preset');
const jointPanel = get<HTMLDetailsElement>('joint-preview');
const jointName = get<HTMLSelectElement>('joint-name');
const jointAngle = get<HTMLInputElement>('joint-angle');
const drafts = new Map<string, Look>();
const images = new Map<string, Promise<HTMLImageElement>>();
const art = new Map<string, HTMLCanvasElement>();
const itemButtons = new Map<string, HTMLButtonElement>();
const colorNames: [string, string][] = [['栗棕','#81534e'], ['酒紅','#a54b68'], ['蜜金','#c59459'], ['霧藍','#6b9db7'], ['湖綠','#5d9b8f'], ['藤紫','#9275b9'], ['墨色','#49405a'], ['雪灰','#b7aab9']];
const eyeNames: [string, string][] = [['琥珀','#e49e4e'], ['翡翠','#4fab8f'], ['蔚藍','#568fd1'], ['紫晶','#aa78cf'], ['玫瑰','#cd6794'], ['灰銀','#a6abbd']];

let state: WardrobeState;
let role = '';
let tab: 'top' | 'bottom' | 'style' = 'top';
let action = 'idle';
let start = 0;
let revision = 0;
let rendered = '';
let activePreview = true;
let locked = false;

function outfit(): Outfit {
  return state.outfits.find(item => item.id === state.currentId && item.characterId === role) ?? state.outfits.find(item => item.characterId === role)!;
}

function draft(): Look {
  const value = drafts.get(role) ?? state.looks[role] ?? { ...state.catalog.defaults[role], hair: 'original', hairColor: '', eyeColor: '', active: false };
  drafts.set(role, value);
  return value;
}

function resolved(): CustomLook {
  const look = draft();
  return { ...look, top: state.catalog.tops.find(item => item.id === look.top)!, bottom: state.catalog.bottoms.find(item => item.id === look.bottom)! };
}

function asset(pack: Outfit, file: string) { return `/asset/${pack.id}/${file}`; }

function load(pack: Outfit, file: string) {
  const url = asset(pack, file);
  let image = images.get(url);
  if (!image) { image = loadImage(url); images.set(url, image); }
  return image;
}

function label() {
  const look = resolved();
  get('selection').textContent = activePreview ? `${look.top.name} × ${look.bottom.name}` : outfit().name;
}

function mutate(patch: Partial<Look>) {
  drafts.set(role, { ...draft(), ...patch });
  activePreview = true;
  revision++;
  label();
  get('feedback').textContent = '';
}

function renderRoles() {
  const characters = state.outfits.filter((item, index, array) => array.findIndex(prev => prev.characterId === item.characterId) === index);
  roles.replaceChildren(...characters.map(item => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'role'; button.dataset.role = item.characterId;
    button.setAttribute('aria-pressed', String(item.characterId === role));
    if (item.tray) { const img = new Image(); img.src = asset(item, item.tray); img.alt = ''; button.append(img); }
    button.append(item.characterName);
    button.onclick = () => {
      if (locked || role === item.characterId) return;
      role = item.characterId;
      activePreview = true;
      roles.querySelectorAll<HTMLButtonElement>('button').forEach(entry => entry.setAttribute('aria-pressed', String(entry.dataset.role === role)));
      renderMotions(); setMotion('idle'); renderTab(); label(); get('feedback').textContent = '';
    };
    return button;
  }));
}

function card(item: Garment, group: 'top' | 'bottom') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'piece'; button.dataset.piece = item.id;
  let thumbnail = art.get(item.id);
  if (!thumbnail) {
    thumbnail = document.createElement('canvas'); thumbnail.width = 210; thumbnail.height = 160;
    const pen = thumbnail.getContext('2d')!;
    const surface = thumbnail;
    void garmentImage(item.id).then(image => { garmentThumbnail(pen, image); surface.dataset.ready = 'true'; })
      .catch(() => { get('feedback').textContent = `無法載入 ${item.name} 的圖稿。`; });
    art.set(item.id, thumbnail);
  }
  const name = document.createElement('span'); name.textContent = item.name;
  button.append(thumbnail, name);
  button.setAttribute('aria-pressed', String(draft()[group] === item.id));
  itemButtons.set(item.id, button);
  button.onclick = () => {
    if (locked) return;
    itemButtons.get(draft()[group])?.setAttribute('aria-pressed', 'false');
    mutate({ [group]: item.id });
    button.setAttribute('aria-pressed', 'true');
  };
  return button;
}

function colors(key: 'hairColor' | 'eyeColor', palette: [string, string][], fallback: string) {
  const row = get(key === 'hairColor' ? 'hair-colors' : 'eye-colors');
  const buttons = [['原色',''], ...palette].map(([name, color]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.title = name; button.setAttribute('aria-label', name);
    button.dataset.color = color;
    if (color) {
      const swatch = document.createElement('canvas'); swatch.width = swatch.height = 24;
      const pen = swatch.getContext('2d')!; pen.fillStyle = color; pen.beginPath(); pen.arc(12, 12, 10.5, 0, 2 * Math.PI); pen.fill();
      button.append(swatch);
    } else button.textContent = '原色';
    return button;
  });
  const custom = document.createElement('label'); custom.append('自訂');
  const input = document.createElement('input'); input.type = 'color'; input.setAttribute('aria-label', key === 'hairColor' ? '自訂髮色' : '自訂瞳色');
  custom.append(input);
  function indicate() {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.color === draft()[key]));
    input.value = draft()[key] || fallback;
  }
  for (const button of buttons) button.onclick = () => { if (locked) return; mutate({ [key]: button.dataset.color! }); indicate(); };
  input.oninput = () => { if (!locked) { mutate({ [key]: input.value }); indicate(); } };
  row.replaceChildren(...buttons, custom); indicate();
}

function renderTab() {
  const isStyle = tab === 'style';
  pieces.hidden = isStyle; get('styling').hidden = !isStyle;
  get('tabs').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
  itemButtons.clear();
  if (tab === 'top' || tab === 'bottom') {
    const group = tab;
    const list = group === 'top' ? state.catalog.tops : state.catalog.bottoms;
    pieces.replaceChildren(...list.map(item => card(item, group)));
    pieces.scrollTop = 0;
    return;
  }
  hairs.replaceChildren(...state.catalog.hairs.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hair'; button.textContent = item.name;
    button.setAttribute('aria-pressed', String(draft().hair === item.id));
    button.onclick = () => {
      if (locked) return;
      hairs.querySelector('[aria-pressed=true]')?.setAttribute('aria-pressed', 'false');
      mutate({ hair: item.id }); button.setAttribute('aria-pressed', 'true');
    };
    return button;
  }));
  colors('hairColor', colorNames, '#9275b9'); colors('eyeColor', eyeNames, '#aa78cf');
}

function renderMotions() {
  const group = get('reactions');
  const reactions = Object.entries(outfit().animations).filter(([, value]) => value.reaction);
  group.replaceChildren(...reactions.map(([id, config]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = config.label ?? id;
    button.dataset.motion = id;
    return button;
  }));
  group.hidden = reactions.length === 0;
  const selected = jointName.value;
  jointName.replaceChildren(...joints.filter(([id]) => id !== 'tail' || role === 'fox').map(([id, name]) => new Option(name, id)));
  if ([...jointName.options].some(option => option.value === selected)) jointName.value = selected;
}

function updateJoint() {
  get('joint-value').textContent = `${jointAngle.value}°`;
  revision++;
}

function setMotion(value: string) {
  action = value;
  start = performance.now();
  revision++;
  document.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.motion === action)));
}

function animation(now: number) {
  if (state && role) {
    const pack = outfit();
    const isolated = jointPanel.open;
    const motion = !isolated && Object.hasOwn(pack.animations, action) ? action : 'idle';
    const config = pack.animations[motion];
    const frame = isolated ? 0 : Math.floor(Math.max(0, now - start) * config.fps / 1000);
    if (!config.loop && frame >= config.frames.length) setMotion('idle');
    else {
      const index = frame % config.frames.length;
      const stamp = `${role}/${revision}/${motion}/${index}/${isolated}`;
      if (rendered !== stamp) {
        rendered = stamp;
        const look = resolved();
        const joint = { [jointName.value as Joint]: jointAngle.valueAsNumber * Math.PI / 180 };
        const wardrobe = activePreview ? loadLookArt(look).then(art => ({ look, art })) : Promise.resolve(undefined);
        const alternate = config.wave ? load(pack, config.frames[0]) : config.reaction === 'shy-wink' ? load(pack, pack.animations.idle.frames[2]) : undefined;
        void Promise.all([load(pack, config.frames[index]), wardrobe, alternate]).then(([image, dressed, face]) => {
          if (rendered !== stamp) return;
          if (isolated) drawJointPreview(painter, pack.characterId, image, joint, dressed);
          else drawCharacterFrame(painter, pack, motion, index, image, dressed, face);
        }).catch(error => { if (rendered === stamp) get('feedback').textContent = error.message; });
      }
    }
  }
  requestAnimationFrame(animation);
}

async function persist(custom: boolean) {
  if (locked) return;
  locked = apply.disabled = preset.disabled = true;
  try {
    state = custom ? await api.apply(role, draft()) : await api.preset(role);
    activePreview = custom;
    renderMotions(); setMotion('idle'); label();
    get('feedback').textContent = custom ? '已套用，搭配已儲存。' : '已恢復角色的原套裝。';
  } catch (error) { get('feedback').textContent = (error as Error).message; }
  finally { locked = apply.disabled = preset.disabled = false; }
}

get('tabs').addEventListener('click', event => {
  const next = (event.target as HTMLButtonElement).dataset.tab;
  if (!state || (next !== 'top' && next !== 'bottom' && next !== 'style')) return;
  tab = next; renderTab();
});
for (const group of ['motion', 'reactions']) {
  get(group).addEventListener('click', event => {
    const next = (event.target as HTMLButtonElement).closest('button')?.dataset.motion;
    if (state && next && Object.hasOwn(outfit().animations, next)) {
      jointPanel.open = false;
      setMotion(next);
    }
  });
}
jointPanel.ontoggle = () => { if (jointPanel.open) setMotion('idle'); else revision++; };
jointName.onchange = updateJoint;
jointAngle.oninput = updateJoint;
get('joint-reset').onclick = () => { jointAngle.value = '0'; updateJoint(); };
apply.onclick = () => void persist(true);
preset.onclick = () => void persist(false);
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.close(); });
void api.getState().then(result => {
  state = result;
  role = state.outfits.find(item => item.id === state.currentId)?.characterId ?? state.outfits[0].characterId;
  renderRoles(); renderTab(); label(); renderMotions(); setMotion('idle');
  apply.disabled = preset.disabled = false;
}).catch(error => { get('feedback').textContent = error.message; });
requestAnimationFrame(animation);
