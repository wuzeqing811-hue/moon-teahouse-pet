import type { Message, ModelStatus, Outfit, SearchResult, SettingsUpdate, SettingsView } from '../shared/contracts';

const api = window.petAPI;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => byId<HTMLInputElement>(id);
const select = (id: string) => byId<HTMLSelectElement>(id);
const button = (id: string) => byId<HTMLButtonElement>(id);
const textarea = byId<HTMLTextAreaElement>('message');
const messages = byId('messages');
const conversation = byId('conversation');
const settingsPanel = byId('settings-panel');
const settingsStatus = byId('settings-status');
const chatError = byId('chat-error');
let outfit: Outfit | undefined;
let allOutfits: Outfit[] = [];
let config: SettingsView | undefined;
let modelStatus: ModelStatus | undefined;
let outfitRevision = 0;
let modelRevision = 0;
let pending: { id: string; request: string; row: HTMLElement; answer: HTMLElement; text: HTMLParagraphElement; received: boolean; sources?: HTMLElement } | undefined;
let ready = false;

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error: /, '');
}

function notice(error?: unknown) {
  chatError.hidden = !error;
  chatError.textContent = error ? cleanError(error) : '';
}

function inspectSources(sources: SearchResult[]) {
  const list = document.createElement('ol');
  list.className = 'sources';
  sources.forEach((item, index) => {
    if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return;
    const li = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = `[${index + 1}] ${item.title}`;
    link.title = item.url;
    link.onclick = () => void api.chat.openSource(item.url).catch(notice);
    li.append(link);
    if (item.snippet) {
      const snippet = document.createElement('p');
      snippet.className = 'source-body';
      snippet.textContent = item.snippet;
      li.append(snippet);
    }
    list.append(li);
  });
  return list;
}

function bubble(message: Message) {
  const row = document.createElement('article');
  row.className = 'bubble ' + message.role;
  row.setAttribute('aria-label', message.role === 'user' ? '你' : outfit?.characterName ?? '桌宠');
  const text = document.createElement('p');
  text.className = 'bubble-text';
  if (!message.citations?.length || !message.sources?.length) text.textContent = message.content;
  else {
    const chars = Array.from(message.content);
    const indices = new Map(message.sources.map((source, index) => [source.url, index + 1]));
    let previous = 0;
    for (const citation of message.citations) {
      const number = indices.get(citation.url);
      if (!number || !Number.isInteger(citation.end) || citation.end < previous || citation.end > chars.length) continue;
      text.append(chars.slice(previous, citation.end).join(''));
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'citation-marker';
      link.textContent = `[${number}]`;
      link.title = message.sources[number - 1].title;
      link.onclick = () => void api.chat.openSource(citation.url).catch(notice);
      text.append(link);
      previous = citation.end;
    }
    text.append(chars.slice(previous).join(''));
  }
  row.append(text);
  if (message.truncated) {
    const note = document.createElement('p');
    note.className = 'reply-note';
    note.textContent = '回复达到输出上限。';
    row.append(note);
  }
  if (message.sources?.length) row.append(inspectSources(message.sources));
  return { row, text };
}

function scrollToEnd() { messages.scrollTop = messages.scrollHeight; }

function showHistory(history: Message[]) {
  if (history.length) messages.replaceChildren(...history.map(message => bubble(message).row));
  else {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = `发条消息，开始和${outfit?.characterName ?? '桌宠'}聊天。`;
    messages.replaceChildren(empty);
  }
  scrollToEnd();
}

function showOutfit(next: Outfit) {
  outfit = next;
  byId('name').textContent = next.characterName;
  const portrait = byId<HTMLImageElement>('portrait');
  if (next.tray) portrait.src = `/asset/${next.id}/${next.tray}`;
  portrait.hidden = !next.tray;
  byId('portrait-fallback').hidden = Boolean(next.tray);
  select('outfit').value = next.id;
}

async function onOutfit(next: Outfit) {
  const newCharacter = outfit?.characterId !== next.characterId;
  showOutfit(next);
  if (!newCharacter) return;
  const revision = ++outfitRevision;
  if (pending) {
    void api.chat.cancel(pending.id).catch(() => undefined);
    pending = undefined;
    textarea.value = '';
  }
  setBusy(false);
  notice();
  messages.replaceChildren();
  try {
    const history = await api.chat.history(next.characterId);
    if (revision === outfitRevision && !pending) showHistory(history);
  } catch (error) { if (revision === outfitRevision) notice(error); }
}

function setBusy(busy: boolean) {
  button('send').disabled = busy || !ready;
  button('stop').hidden = !busy;
  button('stop').disabled = false;
}

async function send() {
  const request = textarea.value.trim();
  if (!ready || !outfit || !request || pending) return;
  const id = crypto.randomUUID();
  const user = bubble({ role: 'user', content: request }).row;
  const { row, text } = bubble({ role: 'assistant', content: '正在准备回复…' });
  messages.querySelector('.empty')?.remove();
  messages.append(user, row);
  pending = { id, request, row: user, answer: row, text, received: false };
  textarea.value = '';
  notice();
  setBusy(true);
  scrollToEnd();
  try {
    const answer = await api.chat.send({ id, characterId: outfit.characterId, message: request, useSearch: input('use-search').checked });
    if (pending?.id !== id) return;
    row.replaceWith(bubble(answer).row);
    scrollToEnd();
  } catch (error) {
    if (pending?.id !== id) return;
    user.remove();
    row.remove();
    if (!textarea.value) textarea.value = request;
    if (!messages.childElementCount) showHistory([]);
    notice(error);
  } finally {
    if (pending?.id === id) { pending = undefined; setBusy(false); }
  }
}

api.chat.onChunk(event => {
  if (pending?.id !== event.id) return;
  const atEnd = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 35;
  if (event.stage && !pending.received) {
    pending.text.textContent = { thinking: '正在思考…', searching: '正在搜索网页…', reading: '正在读取网页…' }[event.stage];
  }
  if (event.text) {
    if (!pending.received) pending.text.textContent = '';
    pending.received = true;
    pending.text.append(document.createTextNode(event.text));
  }
  if (event.sources?.length) {
    pending.sources?.remove();
    pending.sources = inspectSources(event.sources);
    pending.answer.append(pending.sources);
  }
  if (atEnd) scrollToEnd();
});
api.chat.onOutfit(next => void onOutfit(next));
api.chat.onPanel(panel => {
  showSettings(panel !== 'chat');
  if (panel === 'pet-size') input('pet-size').focus();
  void refreshModel().catch(notice);
});
api.chat.onModel(status => { modelRevision++; models(status); });
byId<HTMLFormElement>('composer').onsubmit = event => { event.preventDefault(); void send(); };
textarea.onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
};
button('stop').onclick = () => {
  if (!pending) return;
  button('stop').disabled = true;
  void api.chat.cancel(pending.id).catch(notice);
};
button('close').onclick = () => void api.chat.hide().catch(notice);
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.chat.hide().catch(notice); });

function models(status: ModelStatus) {
  modelStatus = status;
  byId('provider-detail').textContent = status.detail;
  const info = button('model-state');
  info.textContent = status.detail;
  info.title = status.detail;
  const choices = select('model');
  const previous = choices.value || config?.model || '';
  choices.replaceChildren(new Option('自动选择已安装模型', ''), ...status.models.map(name => new Option(name, name)));
  if (previous && !status.models.includes(previous)) choices.add(new Option(`${previous}（未检测到）`, previous));
  choices.value = previous;
}

async function refreshModel(retry = false) {
  const revision = ++modelRevision;
  const status = await api.settings.checkModel(retry);
  if (revision === modelRevision) models(status);
}

async function loadOutfits() {
  allOutfits = await api.pet.getOutfits();
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const item of allOutfits) {
    const group = groups.get(item.characterId) ?? document.createElement('optgroup');
    group.label = item.characterName;
    group.append(new Option(item.name, item.id));
    groups.set(item.characterId, group);
  }
  const chooser = select('outfit');
  chooser.replaceChildren(...groups.values());
  if (outfit) chooser.value = outfit.id;
}

function fields() {
  byId('ollama-fields').hidden = select('local-provider').value !== 'ollama';
  byId('cloud-fields').hidden = !input('cloud-enabled').checked;
  const deepseek = select('cloud-provider').value === 'deepseek';
  byId('compatible-fields').hidden = deepseek;
  byId('deepseek-fields').hidden = !deepseek;
  byId('python-field').hidden = select('search-provider').value !== 'ddgs';
  byId('searxng-field').hidden = select('search-provider').value !== 'searxng';
  byId('deepseek-search-hint').hidden = select('search-provider').value !== 'deepseek';
}

function populate(settings: SettingsView) {
  config = settings;
  select('local-provider').value = settings.localProvider;
  input('context-turns').value = String(settings.contextTurns);
  input('cloud-enabled').checked = settings.cloudEnabled;
  select('cloud-provider').value = settings.cloudProvider;
  input('cloud-endpoint').value = settings.cloudEndpoint;
  input('cloud-model').value = settings.cloudModel;
  input('cloud-key').value = '';
  input('cloud-key').placeholder = settings.hasCloudKey ? '已保存，留空继续使用' : '按服务要求填写';
  input('clear-key').checked = false;
  input('clear-key').disabled = !settings.hasCloudKey;
  input('deepseek-key').value = '';
  input('deepseek-key').placeholder = settings.hasDeepSeekKey ? '已保存，留空继续使用' : '输入 DeepSeek API 密钥';
  input('clear-deepseek-key').checked = false;
  input('clear-deepseek-key').disabled = !settings.hasDeepSeekKey;
  input('deepseek-thinking').checked = settings.deepseekThinking;
  byId('deepseek-status').textContent = '';
  textarea.placeholder = settings.cloudEnabled && settings.cloudProvider === 'deepseek' ? '输入消息、/search 关键词或 /read 网页地址' : '输入消息，或 /search 关键词';
  select('search-provider').value = settings.searchProvider;
  input('python-path').value = settings.pythonPath;
  input('searxng-url').value = settings.searxngUrl;
  input('auto-launch').checked = settings.autoLaunch;
  input('auto-launch').disabled = !settings.canAutoLaunch;
  byId('launch-hint').hidden = settings.canAutoLaunch;
  input('pet-size').value = String(settings.size);
  input('chat-width').value = String(settings.chatSize.width);
  input('chat-height').value = String(settings.chatSize.height);
  fields();
}

function showSettings(show: boolean) {
  settingsPanel.hidden = !show;
  conversation.hidden = show;
  button('toggle-settings').textContent = show ? '返回聊天' : '设置';
  button('toggle-settings').setAttribute('aria-expanded', String(show));
  if (!show) { textarea.focus(); scrollToEnd(); return; }
  settingsPanel.scrollTop = 0;
  void loadOutfits().catch(error => { settingsStatus.textContent = cleanError(error); });
  void api.pet.getSize().then(size => { input('pet-size').value = String(size); }).catch(error => { settingsStatus.textContent = cleanError(error); });
}

button('toggle-settings').onclick = () => showSettings(settingsPanel.hidden);
button('model-state').onclick = () => showSettings(true);
button('ollama-help').onclick = () => void api.chat.openSource('https://ollama.com/download').catch(error => { settingsStatus.textContent = cleanError(error); });
button('check-model').onclick = () => {
  button('check-model').disabled = true;
  void refreshModel(true).catch(error => { settingsStatus.textContent = cleanError(error); }).finally(() => { button('check-model').disabled = false; });
};
select('local-provider').onchange = fields;
select('search-provider').onchange = fields;
select('cloud-provider').onchange = fields;
input('cloud-enabled').onchange = fields;
button('test-deepseek').onclick = async () => {
  button('test-deepseek').disabled = true;
  const status = byId('deepseek-status');
  status.textContent = '正在检测…';
  try { status.textContent = await api.settings.testDeepSeek(); }
  catch (error) { status.textContent = cleanError(error); }
  finally { button('test-deepseek').disabled = false; }
};
select('outfit').onchange = () => void api.pet.selectOutfit(select('outfit').value).catch(error => {
  settingsStatus.textContent = cleanError(error);
  if (outfit) select('outfit').value = outfit.id;
});

function tasks(id: string, work: () => Promise<void>) {
  button(id).onclick = async () => {
    settingsStatus.textContent = '';
    button(id).disabled = true;
    try { await work(); } catch (error) { settingsStatus.textContent = cleanError(error); }
    finally { button(id).disabled = false; }
  };
}
tasks('import-outfit', async () => {
  const imported = await api.pet.importOutfit();
  if (!imported) return;
  await loadOutfits();
  await api.pet.selectOutfit(imported.id);
  settingsStatus.textContent = `已导入 ${imported.name}。`;
});
tasks('open-wardrobe', () => api.wardrobe.open());
tasks('reload-outfits', async () => {
  try { await api.pet.reloadOutfits(); settingsStatus.textContent = '角色列表已刷新。'; }
  finally { await loadOutfits(); }
});
function chatSizeInputs() {
  return { width: input('chat-width').valueAsNumber, height: input('chat-height').valueAsNumber };
}

tasks('apply-chat-size', async () => {
  if (!input('chat-width').reportValidity() || !input('chat-height').reportValidity()) return;
  const result = await api.chat.resize(chatSizeInputs());
  const status = byId('chat-size-status');
  status.textContent = `聊天視窗已調整為 ${result.width} × ${result.height} px。`;
  status.hidden = false;
});
tasks('apply-size', async () => {
  const size = input('pet-size');
  if (!size.reportValidity()) return;
  const result = await api.pet.setSize({ width: size.valueAsNumber, height: size.valueAsNumber });
  size.value = String(result);
  settingsStatus.textContent = `玩偶大小已設為 ${result} px。`;
});

byId<HTMLFormElement>('settings-form').onsubmit = async event => {
  event.preventDefault();
  button('save').disabled = true;
  settingsStatus.textContent = '';
  const localProvider = select('local-provider').value;
  const searchProvider = select('search-provider').value;
  const update: SettingsUpdate = {
    chatSize: chatSizeInputs(),
    localProvider: localProvider === 'ollama' || localProvider === 'qwen' ? localProvider : 'deepseek',
    model: select('model').value, contextTurns: input('context-turns').valueAsNumber,
    cloudEnabled: input('cloud-enabled').checked, cloudEndpoint: input('cloud-endpoint').value, cloudModel: input('cloud-model').value,
    cloudProvider: select('cloud-provider').value === 'deepseek' ? 'deepseek' : 'compatible', deepseekThinking: input('deepseek-thinking').checked,
    searchProvider: searchProvider === 'searxng' || searchProvider === 'deepseek' ? searchProvider : 'ddgs', pythonPath: input('python-path').value,
    searxngUrl: input('searxng-url').value, autoLaunch: input('auto-launch').checked,
  };
  if (input('clear-key').checked) update.cloudKey = '';
  else if (input('cloud-key').value) update.cloudKey = input('cloud-key').value;
  if (input('clear-deepseek-key').checked) update.deepseekKey = '';
  else if (input('deepseek-key').value) update.deepseekKey = input('deepseek-key').value;
  try {
    populate(await api.settings.save(update));
    settingsStatus.textContent = '设置已保存。';
    await refreshModel();
  } catch (error) { settingsStatus.textContent = cleanError(error); }
  finally { button('save').disabled = false; }
};

setBusy(false);
void api.chat.getState().then(state => {
  if (!outfitRevision || outfit?.characterId === state.outfit.characterId) { showOutfit(state.outfit); showHistory(state.messages); }
  populate(state.settings);
  if (!modelStatus) models(state.status);
  ready = true;
  setBusy(false);
}).catch(notice);
