import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, safeStorage, screen, session, shell, Tray } from 'electron';
import type { BrowserWindowConstructorOptions, IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChatSize, Outfit, PanelEvent, PetInput, PetSnapshot, Point, SettingsUpdate, SettingsView, WardrobeCatalog, WardrobeState } from '../shared/contracts';
import { Dialogue } from './dialogue';
import { LocalModel, qwenFilename, type ManagedProvider } from './local-model';
import { chatPosition, fit, hitMask, petSize, readChatSize, resizeAtAnchor, type Rect } from './geometry';
import { loadMask, OutfitLibrary, validId, type PixelMask } from './outfits';
import { clickAction } from './reactions';
import { mediaResponse, VideoLibrary } from './video-library';
import { performSearch } from './search';
import { cloudUrl, publicUrl, Storage, type Profile } from './storage';
import { parseLook, resolvedLook } from './wardrobe';

const squirrelStartup: boolean = require('electron-squirrel-startup');
const appId = 'com.squirrel.MoonTeahouse.MoonTeahouse';
const root = path.resolve(__dirname, '../..');
const services = path.join(app.isPackaged ? process.resourcesPath : root, 'services');
const DDGS = path.join(services, 'ddgs_search.py');
const localResources = app.isPackaged ? process.resourcesPath : path.dirname(root);
const localRuntime = path.join(localResources, 'deepseek-runtime');
const baseUrl = 'teahouse://local';
protocol.registerSchemesAsPrivileged([{ scheme: 'teahouse', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const ui = new Map([
  ['/pet', ['ui/pet.html', 'text/html; charset=utf-8']], ['/chat', ['ui/chat.html', 'text/html; charset=utf-8']],
  ['/ui.css', ['ui/styles.css', 'text/css; charset=utf-8']],
  ['/pet.js', ['dist/renderer/pet.js', 'text/javascript; charset=utf-8']],
  ['/chat.js', ['dist/renderer/chat.js', 'text/javascript; charset=utf-8']],
  ['/studio', ['ui/studio.html', 'text/html; charset=utf-8']], ['/studio.css', ['ui/studio.css', 'text/css; charset=utf-8']],
  ['/studio.js', ['dist/renderer/studio.js', 'text/javascript; charset=utf-8']], ['/rig.js', ['dist/renderer/rig.js', 'text/javascript; charset=utf-8']],
  ['/illustrated.js', ['dist/renderer/illustrated.js', 'text/javascript; charset=utf-8']],
  ['/reaction-art.js', ['dist/renderer/reaction-art.js', 'text/javascript; charset=utf-8']],
  ['/joints.js', ['dist/renderer/joints.js', 'text/javascript; charset=utf-8']],
  ['/webm.js', ['dist/renderer/webm.js', 'text/javascript; charset=utf-8']],
  ['/bake.js', ['dist/renderer/bake.js', 'text/javascript; charset=utf-8']],
  ['/video-player.js', ['dist/renderer/video-player.js', 'text/javascript; charset=utf-8']],
]);

const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: path.join(root, 'dist/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false,
};

function secureWindow(options: BrowserWindowConstructorOptions) {
  const window = new BrowserWindow({ ...options, webPreferences });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  return window;
}

function setWindowBounds(window: BrowserWindow, target: Rect) {
  const requested = { ...target };
  for (let attempt = 0; attempt < 4; attempt++) {
    window.setBounds(requested);
    const actual = window.getBounds();
    if (actual.width === target.width && actual.height === target.height) return;
    // Win32 can round physical pixels back to a neighboring DIP size at fractional DPI.
    requested.width += target.width - actual.width;
    requested.height += target.height - actual.height;
  }
}

class Desktop {
  private pet!: BrowserWindow;
  private chat!: BrowserWindow;
  private studio?: BrowserWindow;
  private tray!: Tray;
  private mask!: PixelMask;
  private reactionMask?: PixelMask;
  private ignored = false;
  private current!: Outfit;
  private storage: Storage;
  private readonly library: OutfitLibrary;
  private readonly videos: VideoLibrary;
  private readonly dialogue: Dialogue;
  private readonly localModels: Record<ManagedProvider, LocalModel>;
  private readonly wardrobe: WardrobeCatalog;
  private revision = 0;
  private assetRevision = 0;
  private displayedRevision = -1;
  private action = 'idle';
  private actionTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private cursorTimer?: ReturnType<typeof setInterval>;
  private pointer?: { at: Point; origin: Point; moved: boolean; lastSeen: number };
  private zoom = 0;
  private logicalSize = 160;
  private quitting = false;
  private canAutoLaunch = process.platform === 'win32' && app.isPackaged &&
    fs.existsSync(path.resolve(path.dirname(process.execPath), '../Update.exe'));

  constructor() {
    const data = app.getPath('userData');
    this.storage = new Storage(data);
    this.wardrobe = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'wardrobe', 'catalog.json'), 'utf8'));
    this.library = new OutfitLibrary(path.join(root, 'assets', 'characters'), path.join(data, 'characters'));
    this.videos = new VideoLibrary(path.join(root, 'assets', 'video'), path.join(data, 'video-cache'));
    void this.videos.pruneOldClips().catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.warn('無法清除舊動畫快取', error);
    });
    const localModel = (provider: ManagedProvider, files: string[]) => new LocalModel(localRuntime, provider, files, status => {
      if (!this.quitting && this.chat && !this.chat.isDestroyed() && this.storage.profile.localProvider === provider) {
        this.chat.webContents.send('chat:model', status);
      }
    });
    this.localModels = {
      deepseek: localModel('deepseek', [path.join(localRuntime, 'model.gguf')]),
      qwen: localModel('qwen', [path.join(localResources, 'qwen-model', qwenFilename), path.join(data, 'models', qwenFilename)]),
    };
    this.dialogue = new Dialogue(this.storage, DDGS, provider => {
      const key = provider === 'deepseek' ? this.storage.profile.encryptedDeepSeekKey : this.storage.profile.encryptedCloudKey;
      if (!key) return '';
      if (!safeStorage.isEncryptionAvailable()) throw Error('系统密钥存储不可用，请重新配置云端。');
      try { return safeStorage.decryptString(Buffer.from(key, 'base64')); }
      catch { throw Error('无法读取保存的密钥，请在设置中重新填写。'); }
    }, fetch, this.localModels);
  }

  async start() {
    this.library.scan();
    const previous = this.storage.profile.outfitId;
    const selected = this.library.entries.get(previous) ?? this.library.entries.get('character_01') ?? this.library.entries.values().next().value;
    if (!selected) throw Error('找不到可用的角色素材包。');
    this.current = selected.manifest;
    if (previous && previous !== this.current.id) this.storage.save({ outfitId: this.current.id });
    this.mask = loadMask(selected);
    this.registerProtocol();
    this.createWindows();
    this.registerIpc();
    this.createTray();
    screen.on('display-added', () => this.fitDisplay());
    screen.on('display-removed', () => this.fitDisplay());
    screen.on('display-metrics-changed', () => this.fitDisplay());
    this.cursorTimer = setInterval(() => this.syncHit(), 16);
    const provider = this.storage.profile.localProvider;
    if (provider !== 'ollama') void this.localModels[provider].start();
    await Promise.all([this.pet.loadURL(`${baseUrl}/pet`), this.chat.loadURL(`${baseUrl}/chat`)]);
    const hidden = process.argv.includes('--hidden');
    if (!hidden) this.showPet();
  }

  private registerProtocol() {
    protocol.handle('teahouse', async request => {
      const url = new URL(request.url);
      if (url.host !== 'local' || request.method !== 'GET') return new Response(null, { status: 404 });
      if (url.pathname.startsWith('/clip/')) {
        const clip = this.videos.asset(url.pathname);
        return clip ? mediaResponse(request, clip) : new Response(null, { status: 404 });
      }
      const entry = ui.get(url.pathname);
      let file: string | undefined;
      let type: string;
      if (entry) { file = path.join(root, entry[0]); type = entry[1]; }
      else if (url.pathname.startsWith('/garment/')) {
        const garment = /^\/garment\/([a-z0-9-]+)\.png$/.exec(url.pathname)?.[1];
        if (!garment || ![...this.wardrobe.tops, ...this.wardrobe.bottoms].some(item => item.id === garment)) return new Response(null, { status: 404 });
        file = path.join(root, 'assets', 'wardrobe', 'illustrated', `${garment}.png`);
        type = 'image/png';
      } else {
        const match = /^\/asset\/([a-z0-9_-]+)\/(.+)$/.exec(url.pathname);
        if (!match) return new Response(null, { status: 404 });
        file = this.library.entries.get(match[1])?.files.get(match[2]);
        type = 'image/png';
      }
      if (!file) return new Response(null, { status: 404 });
      try {
        return new Response(new Uint8Array(await fs.promises.readFile(file)), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
      } catch { return new Response(null, { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
  }

  private createWindows() {
    const primary = screen.getPrimaryDisplay().workArea;
    const size = this.storage.profile.size || this.current.defaultSize.width;
    this.logicalSize = size;
    const saved = this.storage.profile.position;
    const candidate = { x: saved?.x ?? primary.x + primary.width - size - 24, y: saved?.y ?? primary.y + primary.height - size - 18, width: size, height: size };
    const bounds = fit(candidate, screen.getDisplayMatching(candidate).workArea);
    this.pet = secureWindow({ ...bounds, title: '月亮茶屋桌宠', show: false, frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, focusable: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000' });
    this.applySize(bounds);
    this.ignoreMouse(true);
    const chatBounds = chatPosition(bounds, this.storage.profile.chatSize, screen.getDisplayMatching(bounds).workArea);
    this.chat = secureWindow({ ...chatBounds, title: '月亮茶屋 · 聊天', show: false, frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000' });
    this.pet.on('close', event => {
      if (!this.quitting) { event.preventDefault(); this.hidePet(); }
    });
    this.chat.on('close', event => {
      if (!this.quitting) { event.preventDefault(); this.hideChat(); }
    });
    this.pet.on('move', () => this.saveBoundsSoon());
    this.pet.on('resize', () => this.saveBoundsSoon());
    this.chat.on('hide', () => this.syncHit());
    this.pet.webContents.on('context-menu', () => {
      if (!this.chat.isVisible()) this.buildMenu().popup({ window: this.pet });
    });
  }

  private createTray() {
    this.tray = new Tray(this.icon());
    this.tray.on('click', () => this.togglePet());
    this.refreshTray();
  }

  private icon() {
    const pack = this.library.entries.get(this.current.id);
    const file = this.current.tray && pack?.files.get(this.current.tray);
    const image = nativeImage.createFromPath(file || path.join(root, 'assets/app.ico'));
    return image.isEmpty() ? nativeImage.createFromPath(path.join(root, 'assets/app.ico')) : image;
  }

  private buildMenu() {
    const grouped = new Map<string, { name: string; options: MenuItemConstructorOptions[] }>();
    for (const outfit of this.library.list()) {
      const group = grouped.get(outfit.characterId) ?? { name: outfit.characterName, options: [] };
      group.options.push({ label: outfit.name, type: 'radio', checked: outfit.id === this.current.id, click: () => this.selectOutfit(outfit.id) });
      grouped.set(outfit.characterId, group);
    }
    const customActions = Object.entries(this.current.animations)
      .filter(([id]) => id !== 'idle' && id !== 'drag')
      .map(([id, animation]): MenuItemConstructorOptions => ({
        label: animation.label || id, click: () => { this.showPet(); this.setAction(id, true); },
      }));
    const presets = [[112, '小'], [160, '中'], [256, '大']] as const;
    return Menu.buildFromTemplate([
      { label: this.pet.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => this.togglePet() },
      { label: '聊天', click: () => this.openChat('chat') },
      { label: '自由搭配', click: () => void this.openStudio().catch(error => dialog.showErrorBox('无法打开试衣间', error.message)) },
      { label: '换装', submenu: [...grouped.values()].map(group => ({ label: group.name, submenu: group.options })) },
      { label: '动作', submenu: customActions },
      { label: '缩放', submenu: [...presets.map(([size, label]) => ({ label: `${label} (${size})`, click: () => this.resize(size) })),
        { label: '自定义…', click: () => this.openChat('pet-size') }] },
      { type: 'separator' }, { label: '设置', click: () => this.openChat('settings') },
      { label: '退出', click: () => app.quit() },
    ]);
  }

  private refreshTray() {
    if (!this.tray) return;
    this.tray.setImage(this.icon());
    this.tray.setToolTip(`月亮茶屋 · ${this.current.characterName}`);
    this.tray.setContextMenu(this.buildMenu());
  }

  showPet() {
    if (this.quitting) return;
    this.fitDisplay();
    this.pet.showInactive();
    this.syncHit();
    this.refreshTray();
  }

  private hidePet() {
    this.cancelPointer();
    this.pet.hide();
    this.ignoreMouse(true);
    this.refreshTray();
  }

  private togglePet() { if (this.pet.isVisible()) this.hidePet(); else this.showPet(); }

  private openChat(panel: PanelEvent) {
    if (this.quitting) return;
    this.cancelPointer();
    this.placeChat();
    this.ignoreMouse(true);
    this.chat.webContents.send('chat:panel', panel);
    this.chat.show();
    this.chat.moveTop();
    this.chat.focus();
  }

  private hideChat() { this.chat.hide(); this.syncHit(); }

  private placeChat() {
    const pet = this.pet.getBounds();
    const area = screen.getDisplayMatching(pet).workArea;
    setWindowBounds(this.chat, chatPosition(pet, this.storage.profile.chatSize, area));
    const { width, height } = this.chat.getBounds();
    return { width, height };
  }

  private resizeChat(value: unknown): ChatSize {
    const chatSize = readChatSize(value);
    if (!chatSize) throw Error('聊天視窗尺寸無效。');
    this.storage.save({ chatSize });
    return this.placeChat();
  }

  private async openStudio() {
    if (this.studio) { this.studio.show(); this.studio.focus(); return; }
    const area = screen.getDisplayMatching(this.pet.getBounds()).workArea;
    const width = Math.min(1040, area.width);
    const height = Math.min(730, area.height);
    const window = secureWindow({ title: '月亮茶屋・自由搭配', width, height, minWidth: Math.min(640, width), minHeight: Math.min(500, height),
      x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), show: false, backgroundColor: '#faf5ec',
      autoHideMenuBar: true, alwaysOnTop: true, icon: this.icon() });
    this.studio = window;
    window.removeMenu();
    window.on('closed', () => { this.studio = undefined; this.syncHit(); });
    try {
      await window.loadURL(`${baseUrl}/studio`);
      if (!window.isDestroyed()) { this.hideChat(); this.cancelPointer(); this.ignoreMouse(true); window.show(); }
    } catch (error) { if (!window.isDestroyed()) window.close(); throw error; }
  }

  private studioState(): WardrobeState {
    const outfits = [...this.library.entries.values()].filter(pack => pack.builtIn && Object.hasOwn(this.wardrobe.defaults, pack.manifest.characterId)).map(pack => pack.manifest);
    const looks: WardrobeState['looks'] = {};
    for (const key of Object.keys(this.wardrobe.defaults)) {
      const look = parseLook(this.wardrobe, key, this.storage.profile.looks[key]);
      if (look) looks[key] = look;
    }
    return { catalog: this.wardrobe, outfits, currentId: this.current.id, looks };
  }

  private changeLook(characterId: unknown, value: unknown, active: boolean) {
    if (typeof characterId !== 'string' || !Object.hasOwn(this.wardrobe.defaults, characterId)) throw Error('这位角色没有独立服装图层。');
    const options = this.studioState().outfits.filter(outfit => outfit.characterId === characterId);
    const target = options.find(outfit => outfit.id === this.current.id) ?? options[0];
    if (!target) throw Error('找不到角色的基础素材。');
    const look = parseLook(this.wardrobe, characterId, active ? value : this.storage.profile.looks[characterId]);
    if (active && !look) throw Error('搭配中的服装或发型无效。');
    const looks = look ? { ...this.storage.profile.looks, [characterId]: { ...look, active } } : undefined;
    this.selectOutfit(target.id, true, true, looks);
    this.showPet();
    this.studio?.moveTop();
    return this.studioState();
  }

  private currentLook() {
    if (!this.library.entries.get(this.current.id)?.builtIn) return;
    return resolvedLook(this.wardrobe, this.current.characterId, this.storage.profile.looks[this.current.characterId]);
  }

  private clipSet(look = this.currentLook()) {
    if (this.library.entries.get(this.current.id)?.builtIn) return this.videos.get(this.current, look);
  }

  private snapshot(): PetSnapshot {
    const look = this.currentLook();
    return { outfit: this.current, action: this.action, revision: this.revision, assetRevision: this.assetRevision, look, media: this.clipSet(look) };
  }

  private setAction(action: string, preview = false) {
    clearTimeout(this.actionTimer);
    const animation = this.current.animations[action];
    this.action = animation ? action : 'idle';
    this.reactionMask = undefined;
    this.revision++;
    const state = this.snapshot();
    this.pet.webContents.send('pet:update', state);
    if (!animation || this.action === 'idle') return;
    if (!animation.loop || preview) {
      const duration = animation.frames.length * 1000 / animation.fps;
      const video = state.media && (state.media.bake || state.media.available.includes(this.action));
      const fallback = video ? duration + 9000 : duration;
      this.actionTimer = setTimeout(() => this.setAction('idle'), animation.loop ? Math.max(duration, 2200) : fallback);
    }
  }

  private selectOutfit(id: unknown, force = false, preserveLook = false, looks?: Profile['looks']) {
    const pack = typeof id === 'string' ? this.library.entries.get(id) : undefined;
    if (!pack) throw Error('找不到这套服装。');
    const role = pack.manifest.characterId;
    const look = parseLook(this.wardrobe, role, this.storage.profile.looks[role]);
    const reset = !preserveLook && Boolean(look?.active);
    if (id === this.current.id && !force && !reset) return;
    const mask = loadMask(pack);
    const nextLooks = looks ?? (reset ? { ...this.storage.profile.looks, [role]: { ...look, active: false } } : this.storage.profile.looks);
    this.storage.save({ outfitId: pack.manifest.id, looks: nextLooks });
    if (pack.manifest.characterId !== this.current.characterId) this.dialogue.cancel();
    this.cancelPointer();
    this.current = pack.manifest;
    this.mask = mask;
    this.assetRevision++;
    this.setAction('idle');
    this.chat.webContents.send('chat:outfit', this.current);
    this.syncHit();
    this.refreshTray();
  }

  private ignoreMouse(ignore: boolean) {
    if (ignore === this.ignored || this.pet.isDestroyed()) return;
    this.pet.setIgnoreMouseEvents(ignore, ignore && process.platform === 'win32' ? { forward: true } : undefined);
    this.ignored = ignore;
  }

  private syncHit() {
    if (this.quitting || this.pet.isDestroyed()) return;
    if (!this.pet.isVisible() || this.studio?.isVisible() || this.displayedRevision !== this.assetRevision) { this.ignoreMouse(true); return; }
    if (this.pointer && Date.now() - this.pointer.lastSeen > 15000) this.cancelPointer();
    if (this.pointer) { this.ignoreMouse(false); return; }
    const cursor = screen.getCursorScreenPoint();
    this.ignoreMouse(this.chatCovers(cursor) || !this.hitsFigure(cursor));
  }

  private chatCovers({ x, y }: Point) {
    if (!this.chat.isVisible()) return false;
    const bounds = this.chat.getBounds();
    return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
  }

  private hitsFigure(point: Point) {
    return hitMask(this.reactionMask ?? this.mask, this.pet.getContentBounds(), point);
  }

  private frameMask(pixels: unknown): PixelMask | undefined {
    const { width, height } = this.current.canvas;
    if (!(pixels instanceof Uint8Array)) return;
    if (pixels.length === Math.ceil(width * height / 8)) {
      if (pixels.some(value => value !== 0)) return { width, height, pixels, packed: true };
      return;
    }
    if (pixels.length !== width * height || !pixels.includes(1) || pixels.some(value => value > 1)) return;
    return { width, height, pixels };
  }

  private cancelPointer() {
    const previous = this.pointer;
    this.pointer = undefined;
    if (previous?.moved) this.setAction('idle');
  }

  private input(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const input = message as PetInput;
    if (!['down', 'move', 'up', 'cancel'].includes(input.kind) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
    const point = screen.getCursorScreenPoint();
    if (input.kind === 'down') {
      if (this.pointer || this.chatCovers(point) || this.studio?.isVisible() || !this.pet.isVisible() || !this.hitsFigure(point)) return;
      const { x, y } = this.pet.getBounds();
      this.pointer = { at: point, origin: { x, y }, moved: false, lastSeen: Date.now() };
      this.ignoreMouse(false);
      return;
    }
    const pointer = this.pointer;
    if (!pointer) return;
    pointer.lastSeen = Date.now();
    const x = point.x - pointer.at.x;
    const y = point.y - pointer.at.y;
    if (input.kind === 'move') {
      if (this.chat.isVisible()) {
        if (Math.hypot(x, y) >= 5) { this.cancelPointer(); this.syncHit(); }
        return;
      }
      if (!pointer.moved && Math.hypot(x, y) >= 5) { pointer.moved = true; this.setAction('drag'); }
      if (pointer.moved) {
        const next = { width: this.logicalSize, height: this.logicalSize, x: pointer.origin.x + x, y: pointer.origin.y + y };
        const snapped = fit(next, screen.getDisplayNearestPoint(point).workArea);
        const current = this.pet.getBounds();
        if (snapped.x !== current.x || snapped.y !== current.y || snapped.width !== current.width || snapped.height !== current.height) this.applySize(snapped);
      }
      return;
    }
    const clicked = input.kind === 'up' && !pointer.moved && Math.hypot(x, y) < 5 && !this.chatCovers(point) && this.hitsFigure(point);
    this.cancelPointer();
    if (clicked) {
      this.setAction(clickAction(this.current));
      if (!this.chat.isVisible()) this.openChat('chat');
    }
    this.syncHit();
  }

  private wheel(delta: unknown) {
    if (typeof delta !== 'number' || !Number.isFinite(delta) || !delta || this.pointer || this.chat.isVisible() ||
      !this.hitsFigure(screen.getCursorScreenPoint())) return;
    if (delta * this.zoom < 0) this.zoom = 0;
    this.zoom += Math.min(160, Math.abs(delta)) * Math.sign(delta);
    if (Math.abs(this.zoom) < 28) return;
    const direction = Math.sign(this.zoom);
    this.zoom %= 28;
    this.resize(this.logicalSize - direction * 12);
  }

  private resize(value: number) {
    if (!Number.isFinite(value)) throw Error('窗口尺寸无效。');
    const bounds = this.pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const size = petSize(value);
    this.logicalSize = size;
    const { width, height, anchor } = this.current.canvas;
    this.applySize(resizeAtAnchor(bounds, size, { x: anchor.x / width, y: anchor.y / height }, area));
    this.saveBoundsSoon();
    this.syncHit();
    return this.logicalSize;
  }

  private applySize(target: Rect) {
    setWindowBounds(this.pet, target);
    const actual = this.pet.getBounds();
    if (actual.width > 400 || actual.height > 400) this.pet.setBounds({ ...target, width: 399, height: 399 });
    if (actual.width < 80 || actual.height < 80) this.pet.setBounds({ ...target, width: 81, height: 81 });
  }

  private fitDisplay() {
    if (this.pet.isDestroyed()) return;
    const bounds = this.pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const next = fit({ ...bounds, width: this.logicalSize, height: this.logicalSize }, area);
    if (next.x !== bounds.x || next.y !== bounds.y || next.width !== bounds.width || next.height !== bounds.height) this.applySize(next);
    if (this.chat.isVisible()) this.placeChat();
  }

  private saveBoundsSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBounds(), 280);
  }

  private saveBounds() {
    if (!this.pet || this.pet.isDestroyed()) return;
    const { x, y } = this.pet.getBounds();
    try { this.storage.save({ position: { x, y }, size: this.logicalSize, outfitId: this.current.id }); }
    catch (error) { console.error('保存桌宠窗口状态失败', error); }
  }

  private settings(): SettingsView {
    const { outfitId, position, encryptedCloudKey, encryptedDeepSeekKey, size, looks, ...settings } = this.storage.profile;
    return { ...settings, size: this.logicalSize, hasCloudKey: Boolean(encryptedCloudKey), hasDeepSeekKey: Boolean(encryptedDeepSeekKey), canAutoLaunch: this.canAutoLaunch };
  }

  private saveSettings(update: unknown) {
    if (!update || typeof update !== 'object') throw Error('设置格式无效。');
    const patch = update as SettingsUpdate;
    const next: Partial<Profile> = {};
    if (patch.chatSize !== undefined) {
      next.chatSize = readChatSize(patch.chatSize);
      if (!next.chatSize) throw Error('聊天視窗尺寸無效。');
    }
    if (patch.localProvider === 'deepseek' || patch.localProvider === 'qwen' || patch.localProvider === 'ollama') next.localProvider = patch.localProvider;
    const strings = ['model', 'cloudEndpoint', 'cloudModel', 'pythonPath', 'searxngUrl'] as const;
    for (const item of strings) {
      if (patch[item] === undefined) continue;
      if (typeof patch[item] !== 'string' || patch[item].length > 500 || /[\u0000-\u001f]/.test(patch[item])) throw Error('配置文本格式无效。');
      next[item] = patch[item].trim();
    }
    if (patch.searchProvider === 'ddgs' || patch.searchProvider === 'searxng' || patch.searchProvider === 'deepseek') next.searchProvider = patch.searchProvider;
    if (typeof patch.cloudEnabled === 'boolean') next.cloudEnabled = patch.cloudEnabled;
    if (patch.cloudProvider === 'compatible' || patch.cloudProvider === 'deepseek') next.cloudProvider = patch.cloudProvider;
    if (typeof patch.deepseekThinking === 'boolean') next.deepseekThinking = patch.deepseekThinking;
    if (typeof patch.contextTurns === 'number' && Number.isFinite(patch.contextTurns)) next.contextTurns = Math.min(40, Math.max(1, Math.round(patch.contextTurns)));
    const merged = { ...this.storage.profile, ...next };
    if (merged.cloudEndpoint) cloudUrl(merged.cloudEndpoint);
    if (merged.cloudEnabled && merged.cloudProvider === 'compatible' && (!merged.cloudEndpoint || !merged.cloudModel)) throw Error('启用兼容 API 时需要填写服务地址与模型名。');
    if (merged.searchProvider === 'searxng') publicUrl(merged.searxngUrl);
    for (const [value, field] of [[patch.cloudKey, 'encryptedCloudKey'], [patch.deepseekKey, 'encryptedDeepSeekKey']] as const) {
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 4000 || /[\u0000-\u001f]/.test(value)) throw Error('密钥格式无效。');
      if (!value.trim()) next[field] = undefined;
      else {
        if (!safeStorage.isEncryptionAvailable()) throw Error('系统密钥存储不可用。');
        next[field] = safeStorage.encryptString(value.trim()).toString('base64');
      }
    }
    if (typeof patch.autoLaunch === 'boolean' && this.canAutoLaunch && patch.autoLaunch !== this.storage.profile.autoLaunch) {
      const launch = { path: path.resolve(path.dirname(process.execPath), '..', path.basename(process.execPath)), args: ['--hidden'] };
      app.setLoginItemSettings({ ...launch, openAtLogin: patch.autoLaunch });
      next.autoLaunch = patch.autoLaunch;
    }
    const previousProvider = this.storage.profile.localProvider;
    this.storage.save(next);
    if (next.chatSize) this.placeChat();
    const selectedProvider = this.storage.profile.localProvider;
    if (selectedProvider !== previousProvider) {
      this.dialogue.cancel();
      if (previousProvider !== 'ollama') this.localModels[previousProvider].stop();
      if (selectedProvider !== 'ollama') void this.localModels[selectedProvider].start(true);
    }
    return this.settings();
  }

  private registerIpc() {
    const allowed = (event: IpcMainInvokeEvent | IpcMainEvent, window: BrowserWindow) =>
      !!event.senderFrame && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url.startsWith(`${baseUrl}/`);
    const invoke = (channel: string, target: BrowserWindow | 'both' | 'studio', handler: (...args: unknown[]) => unknown) => {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!(target === 'both' ? allowed(event, this.pet) || allowed(event, this.chat) : target === 'studio' ? this.studio && allowed(event, this.studio) : allowed(event, target))) throw Error('IPC 来源无效。');
        return handler(...args);
      });
    };
    ipcMain.on('pet:input', (event, value: unknown) => { if (allowed(event, this.pet)) this.input(value); });
    ipcMain.on('pet:wheel', (event, value: unknown) => { if (allowed(event, this.pet)) this.wheel(value); });
    ipcMain.on('pet:ready', (event, revision: unknown, pixels: unknown) => {
      if (!allowed(event, this.pet) || revision !== this.assetRevision) return;
      if (this.currentLook()) {
        const mask = this.frameMask(pixels);
        if (!mask) return;
        this.mask = mask;
      }
      this.displayedRevision = revision;
      this.syncHit();
    });
    ipcMain.on('pet:pose-mask', (event, revision: unknown, pixels: unknown) => {
      if (!allowed(event, this.pet) || revision !== this.revision || this.displayedRevision !== this.assetRevision ||
        (!this.current.animations[this.action]?.reaction && !this.clipSet())) return;
      const mask = this.frameMask(pixels);
      if (mask) { this.reactionMask = mask; this.syncHit(); }
    });
    ipcMain.on('pet:ended', (event, revision: unknown) => {
      if (allowed(event, this.pet) && revision === this.revision && !this.current.animations[this.action]?.loop) this.setAction('idle');
    });
    invoke('pet:save-clip', this.pet, (revision, action, clip) => {
      const media = this.clipSet();
      if (revision !== this.assetRevision || !media?.bake) throw Error('動畫已換裝，取消舊片段。');
      return this.videos.save(media, this.current, action, clip);
    });
    invoke('pet:state', this.pet, () => this.snapshot());
    invoke('pet:show', 'both', () => this.showPet());
    invoke('pet:hide', 'both', () => this.hidePet());
    invoke('pet:list', 'both', () => this.library.list());
    invoke('pet:get-size', 'both', () => this.logicalSize);
    invoke('pet:size', 'both', value => this.resize(Number((value as { width?: unknown } | null)?.width)));
    invoke('pet:select', this.chat, id => this.selectOutfit(id));
    invoke('pet:import', this.chat, async () => {
      const response = await dialog.showOpenDialog(this.chat, { title: '选择包含 manifest.json 的服装文件夹', properties: ['openDirectory'] });
      if (response.canceled) return null;
      const outfit = this.library.import(response.filePaths[0]);
      this.refreshTray();
      return outfit;
    });
    invoke('pet:reload', this.chat, () => {
      const list = this.library.scan();
      const next = list.find(item => item.id === this.current.id) ?? list[0];
      if (!next) throw Error('找不到可用的角色包。');
      this.selectOutfit(next.id, true, true);
      if (this.library.problems.length) throw Error(this.library.problems.slice(0, 3).join('\n'));
      return list;
    });
    invoke('chat:state', this.chat, async () => {
      const status = await this.dialogue.checkModel();
      return { outfit: this.current, messages: this.storage.history(this.current.characterId), settings: this.settings(), status };
    });
    invoke('chat:history', this.chat, id => {
      if (!validId(id) || !this.library.list().some(item => item.characterId === id)) throw Error('角色不存在。');
      return this.storage.history(id);
    });
    invoke('chat:hide', this.chat, () => this.hideChat());
    invoke('chat:resize', this.chat, size => this.resizeChat(size));
    invoke('chat:source', this.chat, url => {
      if (typeof url !== 'string' || url.length > 2048) throw Error('链接无效。');
      return shell.openExternal(publicUrl(url).toString());
    });
    invoke('chat:send', this.chat, value => this.dialogue.send(value, this.current, event => {
      if (!this.chat.isDestroyed()) this.chat.webContents.send('chat:chunk', event);
    }));
    invoke('chat:cancel', this.chat, id => { if (typeof id === 'string') this.dialogue.cancel(id); });
    invoke('settings:save', this.chat, update => this.saveSettings(update));
    invoke('settings:model', this.chat, retry => {
      const provider = this.storage.profile.localProvider;
      if (retry === true && provider !== 'ollama') void this.localModels[provider].start(true);
      return this.dialogue.checkModel();
    });
    invoke('settings:deepseek-test', this.chat, () => this.dialogue.testDeepSeek());
    invoke('wardrobe:open', this.chat, () => this.openStudio());
    invoke('wardrobe:state', 'studio', () => this.studioState());
    invoke('wardrobe:apply', 'studio', (id, value) => this.changeLook(id, value, true));
    invoke('wardrobe:preset', 'studio', id => this.changeLook(id, undefined, false));
    ipcMain.on('wardrobe:close', event => { if (this.studio && allowed(event, this.studio)) this.studio.close(); });
    invoke('search:query', this.chat, text => performSearch(text, this.storage.profile, DDGS));
  }

  quit() {
    this.quitting = true;
    this.dialogue.cancel();
    for (const model of Object.values(this.localModels)) model.stop();
    clearTimeout(this.actionTimer);
    clearTimeout(this.saveTimer);
    clearInterval(this.cursorTimer);
    this.saveBounds();
    this.tray?.destroy();
  }
}

if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  const customData = app.commandLine.getSwitchValue('user-data-dir');
  if (customData) { fs.mkdirSync(customData, { recursive: true }); app.setPath('userData', path.resolve(customData)); }
  if (process.platform === 'win32') app.setAppUserModelId(appId);
  let desktop: Desktop | undefined;
  let ready = false;
  app.on('before-quit', () => desktop?.quit());
  app.on('second-instance', () => { if (ready) desktop?.showPet(); });
  app.on('activate', () => { if (ready) desktop?.showPet(); });
  app.on('window-all-closed', () => {});
  void app.whenReady().then(async () => {
    desktop = new Desktop();
    await desktop.start();
    ready = true;
  }).catch(error => { dialog.showErrorBox('月亮茶屋无法启动', (error as Error).message); app.quit(); });
}
