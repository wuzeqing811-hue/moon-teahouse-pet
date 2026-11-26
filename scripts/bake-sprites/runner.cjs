const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { app, BrowserWindow, protocol } = require('electron');

const project = path.resolve(__dirname, '../..');
const { readOutfit } = require(path.join(project, 'dist/main/outfits.js'));
const { clipSpec } = require(path.join(project, 'dist/main/video-library.js'));
const modules = new Set(['bake.js', 'webm.js', 'rig.js', 'reaction-art.js', 'illustrated.js', 'joints.js']);
const source = path.join(project, 'assets/characters');
const destination = path.join(project, 'assets/video');
const packages = new Map(fs.readdirSync(source, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => {
  const pack = readOutfit(path.join(source, item.name), true);
  return [pack.manifest.id, pack];
}));
const report = app.commandLine.getSwitchValue('qa-report');
const requestedAction = app.commandLine.getSwitchValue('action');
function record(value) { console.log(value); if (report) fs.appendFileSync(report, value + '\n'); }

protocol.registerSchemesAsPrivileged([{ scheme: 'spritebake', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'local' || request.method !== 'GET') return new Response(null, { status: 404 });
  if (url.pathname === '/') return new Response('<!doctype html><title>Moon Teahouse Sprite Baker</title>', { headers: { 'Content-Type': 'text/html' } });
  const name = url.pathname.slice(1);
  const asset = /^asset\/([a-z0-9_-]+)\/(.+)$/.exec(name);
  const file = modules.has(name) ? path.join(project, 'dist/renderer', name) : asset && packages.get(asset[1])?.files.get(asset[2]);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { 'Content-Type': asset ? 'image/png' : 'text/javascript' } });
}

async function render(outfit, action, spec) {
  const { openBakeScene } = await import('/bake.js');
  if (window.sceneId !== outfit.id) {
    window.sceneId = outfit.id;
    window.scene = openBakeScene(outfit);
  }
  const result = await window.scene(action, spec);
  const element = document.createElement('video');
  element.muted = true;
  element.preload = 'auto';
  const url = URL.createObjectURL(new Blob([result.video], { type: 'video/webm' }));
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('VP9 decode timed out')), 7000);
      element.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      element.onerror = () => { clearTimeout(timeout); reject(Error(element.error.message)); };
      element.src = url;
      element.load();
    });
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth; canvas.height = element.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(element, 0, 0);
    const transparent = ctx.getImageData(5, 5, 1, 1).data[3];
    const opaque = ctx.getImageData(160, 150, 1, 1).data[3];
    if (transparent > 1 || opaque < 240 || Math.abs(element.duration - spec.count / spec.fps) > .025 ||
        canvas.width !== outfit.canvas.width || canvas.height !== outfit.canvas.height) {
      throw Error(JSON.stringify({ action, transparent, opaque, duration: element.duration, width: canvas.width, height: canvas.height }));
    }
    return result;
  } finally {
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
  }
}

app.whenReady().then(async () => {
  protocol.handle('spritebake', serve);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  await win.loadURL('spritebake://local/');
  let count = 0;
  let bytes = 0;
  for (const { manifest } of packages.values()) {
    const clips = Object.entries(manifest.animations).filter(([action]) => !requestedAction || action === requestedAction);
    if (!clips.length) continue;
    const directory = path.join(destination, manifest.id);
    fs.mkdirSync(directory, { recursive: true });
    for (const [action, clip] of clips) {
      const spec = clipSpec(clip);
      const args = [manifest, action, spec].map(value => JSON.stringify(value)).join(',');
      const { video, hits } = await win.webContents.executeJavaScript('(' + render + ')(' + args + ')');
      assert(video instanceof Uint8Array && hits instanceof Uint8Array);
      assert.equal(inflateSync(hits).length, Math.ceil(manifest.canvas.width * manifest.canvas.height / 8) * spec.count);
      fs.writeFileSync(path.join(directory, action + '.webm'), video);
      fs.writeFileSync(path.join(directory, action + '.hit'), hits);
      count++;
      bytes += video.length;
    }
    record('Baked ' + manifest.id + ' (' + clips.length + ' clips)');
  }
  if (!count) throw Error('No built-in animation matched --action=' + requestedAction);
  record('SUCCESS ' + count + ' transparent VP9 clips, ' + bytes + ' video bytes');
  app.quit();
}).catch(error => { record(error.stack); app.exit(1); });
