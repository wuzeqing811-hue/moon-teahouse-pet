const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Storage } = require('../dist/main/storage');
const { Dialogue, parseRequest, streamResponse } = require('../dist/main/dialogue');
const { DeepSeekProgress, testDeepSeek } = require('../dist/main/deepseek');

const outfit = { characterId: 'girl', persona: '你是月铃。' };
const request = (message, useSearch = false) => ({ id: 'round', characterId: 'girl', message, useSearch });
const event = (choice) => `data: ${JSON.stringify({ choices: [choice] })}\r\n\r\n`;
const completed = 'data: [DONE]\r\n\r\n';

function state(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'teahouse-deepseek-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return { folder, storage: new Storage(folder) };
}

test('prior profiles retain their compatible API settings and separate credentials', t => {
  const { folder } = state(t);
  fs.writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ cloudEnabled: true, cloudEndpoint: 'https://example.com/v1', cloudModel: 'fixture', encryptedCloudKey: 'fixture-old-key', searchProvider: 'searxng' }));
  const profile = new Storage(folder).profile;
  assert.equal(profile.cloudProvider, 'compatible');
  assert.equal(profile.encryptedCloudKey, 'fixture-old-key');
  assert.equal(profile.encryptedDeepSeekKey, undefined);
  assert.equal(profile.searchProvider, 'searxng');
});

test('DeepSeek fallback preserves local priority and uses only the DeepSeek credential', async t => {
  const { storage } = state(t);
  let localAvailable = true;
  const keys = [];
  const posts = [];
  const mock = async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: localAvailable ? [{ name: 'local-model' }] : [] });
    posts.push(url);
    if (url.endsWith('/api/chat')) return new Response('{"message":{"content":"本地回复"},"done":true}\n');
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer deepseek-fixture');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.safety_check, { level: 'high' });
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.messages.slice(0, -1).map(message => message.role), ['system', 'user', 'assistant']);
    return new Response(event({ delta: { content: '云端回复' }, finish_reason: 'stop' }) + completed);
  };
  storage.save({ cloudEnabled: true, cloudProvider: 'deepseek' });
  const chat = new Dialogue(storage, '', provider => { keys.push(provider); return 'deepseek-fixture'; }, mock);
  assert.equal((await chat.send(request('你好'), outfit, () => {})).content, '本地回复');
  localAvailable = false;
  assert.equal((await chat.send(request('请继续'), outfit, () => {})).content, '云端回复');
  assert(keys.every(key => key === 'deepseek'));
  assert.deepEqual(posts, ['http://127.0.0.1:11434/api/chat', 'https://api.deepseek.com/chat/completions']);
});

test('native web search streams progress and persists normalized code-point citations', async t => {
  const { storage } = state(t);
  storage.save({ cloudEnabled: true, cloudProvider: 'deepseek', searchProvider: 'deepseek', deepseekThinking: true });
  const fixtures = [
    ': keep-alive\r\n\r\n',
    event({ delta: { reasoning_content: '此字段应被忽略' } }),
    event({ server_tool_event: { type: 'call_started', call: { type: 'deepseek_web_search', action: { type: 'search' } } } }),
    event({ delta: { content: '🌙月亮' } }),
    event({ delta: { content: '。' } }),
    event({ finish_reason: 'stop', delta: { annotations: [
      { type: 'url_citation', url_citation: { url: 'https://example.com/post#anchor', title: '短标题', start_index: 1, end_index: 3 } },
      { type: 'url_citation', url_citation: { url: 'https://example.com/post', start_index: 1, end_index: 3 } },
      { type: 'url_citation', url_citation: { url: 'file:///unsafe', start_index: 1, end_index: 2 } },
    ], server_tool_calls: [{ calls: [{ sources: [{ url: 'https://example.com/post', title: '来源标题', snippet: '来源摘要' }] }] }] } }),
    completed,
  ];
  const chat = new Dialogue(storage, '', () => 'fixture', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.tools, [{ type: 'deepseek_web_search' }]);
    assert.deepEqual(payload.thinking, { type: 'enabled' });
    assert.match(payload.messages.at(-1).content, /桌宠/);
    return new Response(fixtures.join(''));
  });
  const chunks = [];
  const answer = await chat.send(request('/search 桌宠'), outfit, value => chunks.push(value));
  assert.equal(answer.content, '🌙月亮。');
  assert.deepEqual(chunks.map(item => item.stage).filter(Boolean), ['thinking', 'searching']);
  assert.deepEqual(chunks.map(item => item.text).filter(Boolean), ['🌙月亮', '。']);
  assert.deepEqual(answer.sources, [{ url: 'https://example.com/post', title: '来源标题', snippet: '来源摘要' }]);
  assert.deepEqual(answer.citations, [{ url: 'https://example.com/post', end: 3 }]);
  assert.deepEqual(storage.history('girl')[1].citations, answer.citations);
});

test('explicit URL reading uses only the read tool and requires DeepSeek opt-in', async t => {
  const { storage } = state(t);
  let calls = 0;
  const chat = new Dialogue(storage, '', () => 'fixture', async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).tools, [{ type: 'deepseek_read_url' }]);
    return new Response(event({ delta: { content: '网页摘要' }, finish_reason: 'length' }) + completed);
  });
  await assert.rejects(chat.send(request('/read https://example.com/test'), outfit, () => {}), /启用 DeepSeek/);
  assert.equal(calls, 0);
  assert.throws(() => parseRequest(request('/read http://127.0.0.1/admin')), /公开网页地址/);
  assert.throws(() => parseRequest(request('/read file:///secret')), /公开网页地址/);
  storage.save({ cloudEnabled: true, cloudProvider: 'deepseek' });
  assert.equal((await chat.send(request('/read https://example.com/test', true), outfit, () => {})).truncated, true);
  assert.equal(calls, 1);
});

test('incomplete or refused DeepSeek streams and actionable HTTP errors surface clearly', async () => {
  const progress = new DeepSeekProgress(() => {});
  await assert.rejects(streamResponse(new Response(event({ delta: { content: '少了结束标记' }, finish_reason: 'stop' })), 'deepseek', () => {}, progress), /提前结束/);
  await assert.rejects(streamResponse(new Response(event({ finish_reason: 'content_filter' }) + completed), 'deepseek', () => {}), /审核/);
  await assert.rejects(streamResponse(new Response(null, { status: 402 }), 'deepseek', () => {}), /余额/);
  await assert.rejects(streamResponse(new Response(null, { status: 429 }), 'deepseek', () => {}), /频繁/);
});

test('credential check reads models without sending a chat request', async () => {
  const result = await testDeepSeek('fixture', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/models');
    assert.equal(options.headers.authorization, 'Bearer fixture');
    assert.equal(options.body, undefined);
    return Response.json({ data: [{ id: 'deepseek-flash' }] });
  });
  assert.match(result, /已连接/);
  await assert.rejects(testDeepSeek('invalid', async () => new Response(null, { status: 401 })), /密钥无效/);
});
