import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, Point, Settings } from '../shared/contracts';
import { petSize, clamp, defaultChatSize, readChatSize } from './geometry';

export type Profile = Settings & { outfitId: string; size: number; position?: Point; encryptedCloudKey?: string; encryptedDeepSeekKey?: string; looks: Record<string, unknown> };
const defaults: Profile = {
  outfitId: '', size: 0, localProvider: 'deepseek', model: '', cloudEnabled: false, cloudEndpoint: '', cloudModel: '',
  chatSize: { ...defaultChatSize },
  cloudProvider: 'compatible', deepseekThinking: false, looks: {},
  searchProvider: 'ddgs', pythonPath: '', searxngUrl: 'http://127.0.0.1:8080', contextTurns: 10, autoLaunch: false,
};

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) {
      fs.renameSync(file, `${file}.invalid-${Date.now()}`);
      return undefined;
    }
    throw error;
  }
}

function writeJson(file: string, data: unknown) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function object(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown, fallback = '', max = 500) { return typeof value === 'string' ? value.slice(0, max) : fallback; }

export function publicUrl(value: string, allowLoopbackHttp = true) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && (!allowLoopbackHttp || url.protocol !== 'http:'))) throw Error('请输入有效的 HTTP(S) 地址。');
  return url;
}

export function cloudUrl(value: string) {
  const url = publicUrl(value);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('云端 API 请使用 HTTPS 地址。');
  if (url.search || url.hash) throw Error('API 地址不应包含查询参数或片段。');
  return url;
}

export class Storage {
  profile: Profile;
  private readonly settingsFile: string;
  private readonly histories: string;

  constructor(folder: string) {
    this.histories = path.join(folder, 'history');
    fs.mkdirSync(this.histories, { recursive: true });
    this.settingsFile = path.join(folder, 'settings.json');
    const current = object(readJson(this.settingsFile));
    const position = object(current.position);
    this.profile = {
      ...defaults, outfitId: str(current.outfitId), size: typeof current.size === 'number' && current.size > 0 ? petSize(current.size) : 0,
      chatSize: readChatSize(current.chatSize) ?? { ...defaultChatSize },
      model: str(current.model), localProvider: current.localProvider === 'ollama' || current.localProvider === 'qwen' ? current.localProvider : 'deepseek',
      cloudEnabled: current.cloudEnabled === true, cloudEndpoint: str(current.cloudEndpoint),
      cloudModel: str(current.cloudModel), encryptedCloudKey: str(current.encryptedCloudKey, '', 20000) || undefined,
      cloudProvider: current.cloudProvider === 'deepseek' ? 'deepseek' : 'compatible', deepseekThinking: current.deepseekThinking === true,
      encryptedDeepSeekKey: str(current.encryptedDeepSeekKey, '', 20000) || undefined,
      looks: object(current.looks),
      searchProvider: current.searchProvider === 'searxng' || current.searchProvider === 'deepseek' ? current.searchProvider : 'ddgs',
      pythonPath: str(current.pythonPath), searxngUrl: str(current.searxngUrl, defaults.searxngUrl),
      contextTurns: typeof current.contextTurns === 'number' ? clamp(Math.round(current.contextTurns), 1, 40) : defaults.contextTurns,
      autoLaunch: current.autoLaunch === true,
      position: typeof position.x === 'number' && Number.isFinite(position.x) && typeof position.y === 'number' && Number.isFinite(position.y)
        ? { x: position.x, y: position.y } : undefined,
    };
  }

  save(patch: Partial<Profile>) {
    const next = { ...this.profile, ...patch };
    writeJson(this.settingsFile, next);
    this.profile = next;
  }

  private historyFile(id: string) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) throw Error('角色 ID 无效。');
    return path.join(this.histories, `${id}.json`);
  }

  history(id: string): Message[] {
    const raw = readJson(this.historyFile(id));
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') as Message[];
  }

  append(id: string, user: Message, answer: Message) {
    const history = [...this.history(id), user, answer].slice(-400);
    writeJson(this.historyFile(id), history);
  }
}
