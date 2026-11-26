const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { inflateSync } = require('node:zlib');
const { chatPosition, hitMask, petSize, readChatSize, resizeAtAnchor } = require('../dist/main/geometry');
const { readOutfit, whiteMask } = require('../dist/main/outfits');
const { clickAction } = require('../dist/main/reactions');
const { VideoLibrary, clipSpec, mediaResponse } = require('../dist/main/video-library');
const { Storage, cloudUrl } = require('../dist/main/storage');
const { parseRequest, streamResponse, Dialogue } = require('../dist/main/dialogue');
const { LocalModel, qwenFilename } = require('../dist/main/local-model');
const { normalizeResults, performSearch } = require('../dist/main/search');

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teahouse-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('exact white triggers hits at different scales and monitor coordinates', () => {
  const mask = whiteMask(Uint8Array.from([255,255,255,255, 255,255,255,0, 0,0,0,255, 254,255,255,255]), 2, 2);
  const bounds = { x: -430, y: 80, width: 400, height: 400 };
  assert(hitMask(mask, bounds, { x: -231, y: 279 }));
  assert(!hitMask(mask, bounds, { x: -230, y: 279 }));
  assert(!hitMask(mask, bounds, { x: -431, y: 81 }));
  assert(!hitMask(mask, bounds, { x: -229, y: 300 }));
  assert.throws(() => whiteMask(new Uint8Array(16), 2, 2), /纯白/);
});

test('zoom clamps to product limits and preserves the waist anchor', () => {
  assert.equal(petSize(500), 400);
  assert.equal(petSize(5), 80);
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const from = { x: 700, y: 400, width: 160, height: 160 };
  assert.deepEqual(resizeAtAnchor(from, 320, { x: .5, y: .55 }, area), { x: 620, y: 312, width: 320, height: 320 });
  const next = chatPosition({ x: 1610, y: 920, width: 160, height: 160 }, { x: 0, y: 0, width: 378, height: 512 }, area);
  assert.equal(next.x, 1220);
  assert.equal(next.y, 528);
});

test('chat width and height are independent, and an oversized chat fits the active monitor', () => {
  assert.deepEqual(readChatSize({ width: 565.7, height: 724.4 }), { width: 566, height: 724 });
  assert.deepEqual(readChatSize({ width: 1, height: 9000 }), { width: 300, height: 1600 });
  assert.equal(readChatSize({ width: 512, height: NaN }), undefined);
  const area = { x: -1024, y: 0, width: 1024, height: 640 };
  const pet = { x: -237, y: 380, width: 180, height: 180 };
  assert.deepEqual(chatPosition(pet, { width: 1500, height: 750 }, area), area);
  assert.deepEqual(pet, { x: -237, y: 380, width: 180, height: 180 });
});

test('only the seven Moon Bell and fox outfits are bundled', () => {
  const root = path.join(__dirname, '../assets/characters');
  const outfits = fs.readdirSync(root).map(id => readOutfit(path.join(root, id)).manifest);
  assert.deepEqual(outfits.map(item => item.id).sort(), [
    'character_01', 'character_02', 'character_03', 'character_04', 'character_08', 'character_09', 'character_10',
  ]);
  assert.deepEqual(new Set(outfits.map(item => item.characterId)), new Set(['girl', 'fox']));
  for (const outfit of outfits) {
    assert.deepEqual(outfit.canvas, { width: 320, height: 320, anchor: { x: 160, y: 174 } });
    const { idle, drag, click } = outfit.animations;
    assert.deepEqual([idle.frames.length, idle.fps, idle.loop, drag.frames.length, drag.fps, drag.loop, click.frames.length, click.fps, click.loop], [4,4,true,2,4,true,3,6,false]);
  }
});

test('manifest rejects relative traversal and non-looping idle', t => {
  const dir = scratch(t);
  const source = path.join(__dirname, '../assets/characters/character_01');
  fs.cpSync(source, dir, { recursive: true });
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, mask: '../mask.png' }));
  assert.throws(() => readOutfit(dir), /路径无效/);
  manifest.animations.idle.loop = false;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => readOutfit(dir), /循环 idle/);
});

test('built-in outfits keep role reactions and use catnap on every click', () => {
  const root = path.join(__dirname, '../assets/characters');
  const expected = {
    girl: ['tea-serve', 'shy-wink', 'moon-bow'],
    fox: ['scent', 'tail-wag', 'leaf-pounce'],
  };
  for (const folder of fs.readdirSync(root)) {
    const source = path.join(root, folder);
    const { manifest, files } = readOutfit(source, true);
    const extras = Object.entries(manifest.animations).filter(([, animation]) => animation.reaction);
    assert.deepEqual(extras.map(([id]) => id), [...expected[manifest.characterId], 'catnap']);
    for (const [id, animation] of extras) {
      assert.equal(animation.reaction, id);
      assert.equal(animation.loop, false);
      assert(animation.frames.length >= 10 && animation.frames.every(file => files.has(file)));
    }
    assert.equal(clickAction(manifest), 'catnap');
    const imported = readOutfit(source).manifest;
    assert(!Object.values(imported.animations).some(animation => animation.reaction));
    assert.equal(clickAction(imported), 'click');
    const wave = manifest.animations.click;
    assert.equal(wave.wave, true);
    assert.deepEqual(clipSpec(wave), { count: 54, fps: 24 });
    assert.deepEqual([...new Set(wave.frames)], imported.animations.click.frames);
    assert.equal(wave.frames.at(-1), wave.frames[0]);
    assert.deepEqual(clipSpec(imported.animations.click), { count: 3, fps: 6 });
  }
});

test('every built-in animation has a WebM and matching frame hit data', async t => {
  const root = path.join(__dirname, '../assets');
  const videos = new VideoLibrary(path.join(root, 'video'), scratch(t));
  const outfits = fs.readdirSync(path.join(root, 'characters')).sort();
  assert.deepEqual(fs.readdirSync(path.join(root, 'video')).sort(), outfits);
  const bounds = { x: 0, y: 0, width: 320, height: 320 };
  let pairCount = 0;
  for (const id of outfits) {
    const { manifest } = readOutfit(path.join(root, 'characters', id), true);
    const media = videos.get(manifest);
    assert.deepEqual(media.available, Object.keys(manifest.animations));
    const expectedFiles = media.available.flatMap(action => [action + '.webm', action + '.hit']).sort();
    assert.deepEqual(fs.readdirSync(path.join(root, 'video', id)).sort(), expectedFiles);
    for (const action of media.available) {
      const url = `${media.root}/${action}`;
      const stride = manifest.canvas.width * manifest.canvas.height / 8;
      const hits = inflateSync(fs.readFileSync(videos.asset(url + '.hit').file));
      assert.equal(hits.length, stride * media.specs[action].count);
      const mask = { ...bounds, packed: true, pixels: hits.subarray(0, stride) };
      assert.equal(hitMask(mask, bounds, { x: 5, y: 5 }), false);
      assert.equal(hitMask(mask, bounds, { x: 160, y: 150 }), true);
      const asset = videos.asset(url + '.webm');
      const response = await mediaResponse(new Request('file://' + url, { headers: { range: 'bytes=0-3' } }), asset);
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-type'), 'video/webm');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      pairCount++;
    }
  }
  assert.equal(pairCount, 49);
  assert.equal(videos.asset('/clip/cache/../catnap.webm'), undefined);
});

test('removes only retired clips from the existing wardrobe cache', async t => {
  const cache = scratch(t);
  const key = 'a'.repeat(32);
  const folder = path.join(cache, key);
  fs.mkdirSync(folder);
  const retained = ['catnap.webm', 'catnap.hit'];
  const removed = ['big-bite.webm', 'big-bite.hit', 'slack-off.webm', 'slack-off.hit', 'blow-bubbles.webm', 'blow-bubbles.hit', 'dance.webm', 'dance.hit'];
  for (const file of [...retained, ...removed]) fs.writeFileSync(path.join(folder, file), '');
  const videos = new VideoLibrary('', cache);
  assert.equal(videos.asset('/clip/cache/' + key + '/dance.webm'), undefined);
  await videos.pruneOldClips();
  await videos.pruneOldClips();
  assert.deepEqual(fs.readdirSync(folder).sort(), retained.sort());
});

test('existing fox outfits keep other cached clips and regenerate the corrected scent clip', async t => {
  const cache = scratch(t);
  const { manifest } = readOutfit(path.join(__dirname, '../assets/characters/character_08'), true);
  const look = { active: true, hair: 'braids', hairColor: '#81534e', eyeColor: '#568fd1' };
  const videos = new VideoLibrary('', cache);
  const { root } = videos.get(manifest, look);
  const folder = path.join(cache, root.split('/').at(-1));
  fs.mkdirSync(folder);
  for (const file of ['idle.webm', 'idle.hit', 'scent.webm', 'scent.hit', 'click.webm', 'click.hit']) fs.writeFileSync(path.join(folder, file), '');
  assert.deepEqual(videos.get(manifest, look).available, ['idle']);
  assert.equal(videos.asset(root + '/scent.webm').file, path.join(folder, 'scent-v2.webm'));
  assert.equal(videos.asset(root + '/click.webm').file, path.join(folder, 'click-v2.webm'));
  fs.writeFileSync(path.join(folder, 'scent-v2.webm'), '');
  fs.writeFileSync(path.join(folder, 'scent-v2.hit'), '');
  await videos.pruneOldClips();
  assert.deepEqual(videos.get(manifest, look).available, ['idle', 'scent']);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['idle.hit', 'idle.webm', 'scent-v2.hit', 'scent-v2.webm']);
});

test('storage restores size and outfit and keeps character histories separate', t => {
  const dir = scratch(t);
  const first = new Storage(dir);
  first.save({ outfitId: 'character_08', size: 240, position: { x: -10, y: 40 }, contextTurns: 5 });
  first.append('fox', { role: 'user', content: '茶' }, { role: 'assistant', content: '请用茶。' });
  const next = new Storage(dir);
  assert.equal(next.profile.outfitId, 'character_08');
  assert.equal(next.profile.size, 240);
  assert.deepEqual(next.profile.chatSize, { width: 378, height: 512 });
  assert.equal(next.history('fox').length, 2);
  assert.deepEqual(next.history('girl'), []);
  assert.throws(() => next.history('../invalid'), /ID/);
  next.save({ chatSize: { width: 530, height: 680 } });
  const resized = new Storage(dir).profile;
  assert.equal(resized.size, 240);
  assert.deepEqual(resized.chatSize, { width: 530, height: 680 });
});

test('an older profile starts with managed DeepSeek; missing files expose an actionable status', async t => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ model: 'qwen2.5:3b' }));
  const storage = new Storage(folder);
  assert.equal(storage.profile.localProvider, 'deepseek');
  const states = [];
  const local = new LocalModel(folder, 'deepseek', [path.join(folder, 'model.gguf')], value => states.push(value.localState));
  assert.equal(await local.start(), undefined);
  assert.deepEqual(states, ['loading', 'error']);
  const dialogue = new Dialogue(storage, '', () => '', () => { throw Error('unexpected remote call'); }, { deepseek: local });
  assert.match((await dialogue.checkModel()).detail, /缺少本机 DeepSeek 文件/);
  storage.save({ localProvider: 'ollama' });
  assert.equal(new Storage(folder).profile.localProvider, 'ollama');
  local.stop();
});

test('managed DeepSeek uses the local stream without Ollama or the cloud', async t => {
  const storage = new Storage(scratch(t));
  const outfit = readOutfit(path.join(__dirname, '../assets/characters/character_01')).manifest;
  const local = {
    status: () => ({ models: [], detail: 'ready', provider: 'local-deepseek', localState: 'ready' }),
    start: async () => ({ provider: 'local-deepseek', model: 'local-alias', endpoint: 'http://127.0.0.1:43210/v1/chat/completions', key: 'session-only' }),
  };
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:43210/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer session-only');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'local-alias');
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    assert.match(body.messages[0].content, /你好/);
    return new Response('data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好，歡迎來到月亮茶屋！"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const dialogue = new Dialogue(storage, '', () => { throw Error('no cloud credentials needed'); }, request, { deepseek: local });
  const chunks = [];
  const answer = await dialogue.send({ id: 'chat', characterId: 'girl', message: '你好' }, outfit, value => chunks.push(value.text));
  assert.deepEqual(chunks, ['你好，歡迎來到月亮茶屋！']);
  assert.equal(answer.content, chunks[0]);
  assert.equal(request.mock.callCount(), 1);
});

test('saved Qwen selection uses only its local stream and keeps the system prompt and history', async t => {
  const folder = scratch(t);
  new Storage(folder).save({ localProvider: 'qwen' });
  const storage = new Storage(folder);
  assert.equal(storage.profile.localProvider, 'qwen');
  const missing = new LocalModel(folder, 'qwen', [path.join(folder, qwenFilename)], () => {});
  await missing.start();
  assert.match(missing.status().detail, /缺少本机 千問 文件/);
  storage.append('girl', { role: 'user', content: '我喜歡桂花茶' }, { role: 'assistant', content: '記住了' });
  const outfit = readOutfit(path.join(__dirname, '../assets/characters/character_01')).manifest;
  const qwen = {
    status: () => ({ models: [], detail: '千問已就緒', provider: 'local-qwen', localState: 'ready' }),
    start: async () => ({ provider: 'local-qwen', model: 'qwen-alias', endpoint: 'http://127.0.0.1:43210/v1/chat/completions', key: 'session-only' }),
  };
  const request = t.mock.fn(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:43210/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer session-only');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen-alias');
    assert.deepEqual(body.messages.map(item => item.role), ['system', 'user', 'assistant', 'user']);
    assert.match(body.messages[0].content, /月亮茶屋/);
    assert.equal(body.messages[1].content, '我喜歡桂花茶');
    assert.equal(body.messages[3].content, '我喜歡什麼茶？');
    return new Response('data: {"choices":[{"delta":{"content":"桂花茶"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const dialogue = new Dialogue(storage, '', () => { throw Error('unexpected cloud credentials'); }, request, { deepseek: { start: () => { throw Error('unexpected DeepSeek'); } }, qwen });
  assert.equal((await dialogue.checkModel()).provider, 'local-qwen');
  const reply = await dialogue.send({ id: 'qwen', characterId: 'girl', message: '我喜歡什麼茶？' }, outfit, () => {});
  assert.equal(reply.content, '桂花茶');
  assert.equal(request.mock.callCount(), 1);
});

test('search commands validate empty and long inputs', () => {
  const message = (value, useSearch = false) => ({ id: 'id', characterId: 'girl', message: value, useSearch });
  assert.equal(parseRequest(message('/search 月亮')).query, '月亮');
  assert(parseRequest(message('月亮', true)).search);
  assert(!parseRequest(message('/searching 月亮')).search);
  assert.throws(() => parseRequest(message('/search')), /搜索词/);
  assert.throws(() => parseRequest(message('字'.repeat(3001))), /3000/);
  assert.throws(() => parseRequest(message('  ')), /3000/);
});

test('results are filtered, normalized and deduplicated', () => {
  const results = normalizeResults([
    { href: 'https://example.com/a#abc', title: '  资料  ', body: '摘要\n 正文' },
    { url: 'https://example.com/a#xyz', title: '重复' },
    { href: 'file:///c:/test.txt' },
    { href: 'https://name:password@example.com/b' },
  ]);
  assert.deepEqual(results, [{ url: 'https://example.com/a', title: '资料', snippet: '摘要 正文' }]);
  assert.throws(() => cloudUrl('http://nonlocal.example/api'), /HTTPS/);
});

test('SearXNG uses JSON query encoding and reports a refused format', async t => {
  const request = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), '茶 & 月亮');
    assert.equal(url.searchParams.get('format'), 'json');
    return new Response(null, { status: 403 });
  });
  await assert.rejects(performSearch('茶 & 月亮', { searchProvider: 'searxng', searxngUrl: 'http://127.0.0.1:8080' }, ''), /启用 json/);
  assert.equal(request.mock.callCount(), 1);
});

test('decodes Ollama NDJSON and cloud SSE across split UTF-8 packets', async () => {
  const response = text => {
    const data = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < data.length; i += 3) controller.enqueue(data.subarray(i, i + 3));
      controller.close();
    } }));
  };
  const chunks = [];
  assert.equal(await streamResponse(response('{"message":{"content":"月"},"done":false}\n{"message":{"content":"亮"},"done":true}'), 'ollama', part => chunks.push(part)), '月亮');
  assert.deepEqual(chunks, ['月','亮']);
  const cloud = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  assert.equal(await streamResponse(response(cloud), 'cloud', () => {}), '你好');
  await assert.rejects(streamResponse(response('{"message":{"content":"未完"}}'), 'ollama', () => {}), /提前结束/);
});

test('dialogue prefers the configured local model, streams, and stores the completed round', async t => {
  const storage = new Storage(scratch(t));
  storage.save({ model: 'test:3b' });
  const calls = [];
  const transport = async (url, options) => {
    calls.push(String(url));
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'test:3b' }] });
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test:3b');
    assert(body.stream);
    assert.match(body.messages[0].content, /月铃/);
    return new Response('{"message":{"content":"请用茶。"},"done":true}\n');
  };
  const chat = new Dialogue(storage, '', () => '', transport);
  const outfit = readOutfit(path.join(__dirname, '../assets/characters/character_02')).manifest;
  const events = [];
  const answer = await chat.send({ id: 'round', characterId: 'girl', message: '你好', useSearch: false }, outfit, event => events.push(event));
  assert.deepEqual(events, [{ id: 'round', text: '请用茶。' }]);
  assert.equal(answer.content, '请用茶。');
  assert.equal(storage.history('girl').length, 2);
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat']);
});

test('cloud fallback is opt-in and unavailable local models are reported', async t => {
  const storage = new Storage(scratch(t));
  const outfit = readOutfit(path.join(__dirname, '../assets/characters/character_08')).manifest;
  let cloudSent = 0;
  const service = new Dialogue(storage, '', () => 'offline-fixture', async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [] });
    assert.equal(url, 'https://example.com/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer offline-fixture');
    cloudSent++;
    return new Response('data: {"choices":[{"delta":{"content":"见到你真好。"}}]}\n\ndata: [DONE]\n\n');
  });
  const input = { id: 'test', characterId: 'fox', message: '你好', useSearch: false };
  await assert.rejects(service.send(input, outfit, () => {}), /本地模型未就绪/);
  assert.equal(cloudSent, 0);
  storage.save({ cloudEnabled: true, cloudEndpoint: 'https://example.com/v1', cloudModel: 'fixture-model' });
  await service.send(input, outfit, () => {});
  assert.equal(cloudSent, 1);
});
