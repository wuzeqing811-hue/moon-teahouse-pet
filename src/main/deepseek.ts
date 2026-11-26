import type { ChatEvent, Citation, Message, SearchResult } from '../shared/contracts';
import { normalizeResults } from './search';
import { publicUrl } from './storage';

const baseUrl = 'https://api.deepseek.com';
export const deepSeekModel = 'deepseek-flash';
export const deepSeekEndpoint = `${baseUrl}/chat/completions`;
export type DeepSeekTool = 'deepseek_web_search' | 'deepseek_read_url';

export function deepSeekOptions(thinking: boolean, tool?: DeepSeekTool) {
  return { thinking: { type: thinking ? 'enabled' : 'disabled' }, safety_check: { level: 'high' }, ...(tool ? { tools: [{ type: tool }] } : {}) };
}

export function deepSeekHttpError(status: number, reviewed = false) {
  if (reviewed) return 'DeepSeek 内容审核未通过。';
  switch (status) {
    case 400: case 422: return `DeepSeek 无法处理这次请求（${status}）。请尝试缩短消息或减少上下文轮数。`;
    case 401: return 'DeepSeek API 密钥无效或已撤销，请更新密钥。';
    case 402: return 'DeepSeek API 账户余额不足。';
    case 429: return 'DeepSeek 请求过于频繁，请稍候再试。';
    case 500: case 503: case 504: return `DeepSeek 服务暂时不可用（${status}），请稍候再试。`;
    default: return `DeepSeek 返回 HTTP ${status}。`;
  }
}

export async function testDeepSeek(key: string, request: typeof fetch) {
  if (!key) throw Error('请先保存 DeepSeek API 密钥。');
  let response: Response;
  try {
    response = await request(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch { throw Error('无法连接 DeepSeek，请检查网络后再试。'); }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw Error(deepSeekHttpError(response.status)); }
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data?.data) || !data.data.some((model: { id?: string }) => model?.id === deepSeekModel)) {
    throw Error('DeepSeek 已连接，当前密钥未列出 deepseek-flash。');
  }
  return '已连接 DeepSeek，检测到 deepseek-flash。';
}

export function readWebAddress(value: string) {
  try {
    if (value.length > 2048 || /\s/.test(value) || !/^https?:\/\//i.test(value)) throw Error();
    const url = publicUrl(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || /^[\d.]+$/.test(host)) throw Error();
    return url.toString();
  } catch { throw Error('请输入一个公开网页地址，例如 /read https://example.com/。'); }
}

type WebCall = { type?: string; action?: { type?: string }; sources?: unknown[]; page?: unknown };
type Annotation = { type?: string; url_citation?: { url?: string; title?: string; start_index?: number; end_index?: number } };
export type DeepSeekChoice = {
  finish_reason?: string;
  server_tool_event?: { type?: string; call?: WebCall };
  delta?: { reasoning_content?: string; content?: string; annotations?: Annotation[]; server_tool_calls?: { calls?: WebCall[] }[] };
};

export class DeepSeekProgress {
  private rawSources: unknown[] = [];
  private annotations: Annotation[] = [];
  private stage?: ChatEvent['stage'];
  private truncated = false;

  constructor(private emit: (stage: NonNullable<ChatEvent['stage']>) => void) {}

  accept(choice: DeepSeekChoice) {
    const delta = choice.delta;
    const tool = choice.server_tool_event;
    let next = !delta?.content && delta?.reasoning_content ? 'thinking' as const : undefined;
    if (tool?.type === 'call_started') {
      const reading = tool.call?.type === 'deepseek_read_url' || tool.call?.action?.type === 'open_page' || tool.call?.action?.type === 'find_in_page';
      this.update(reading ? 'reading' : 'searching');
      next = undefined;
    }
    if (next) this.update(next);
    if (tool?.type === 'call_completed') this.addCall(tool.call);
    if (Array.isArray(delta?.annotations)) this.annotations = delta.annotations.slice(0, 200);
    if (Array.isArray(delta?.server_tool_calls)) {
      for (const step of delta.server_tool_calls) if (Array.isArray(step?.calls)) for (const call of step.calls) this.addCall(call);
    }
    if (choice.finish_reason === 'length') this.truncated = true;
  }

  private update(stage: NonNullable<ChatEvent['stage']>) {
    if (stage !== this.stage) { this.stage = stage; this.emit(stage); }
  }

  private addCall(call: WebCall | undefined) {
    const { page, sources } = call ?? {};
    const items = Array.isArray(sources) ? sources.slice(0, 100) : [];
    if (page) items.push(page);
    this.rawSources.push(...items.slice(0, Math.max(0, 400 - this.rawSources.length)));
  }

  finish(content: string): Pick<Message, 'sources' | 'citations' | 'truncated'> {
    const sourcesByUrl = new Map(normalizeResults(this.rawSources, 400).map(source => [source.url, source]));
    const length = Array.from(content).length;
    const cited: Array<{ source: SearchResult; end: number }> = [];
    for (const annotation of this.annotations) {
      const citation = annotation?.type === 'url_citation' ? annotation.url_citation : undefined;
      const start = citation?.start_index;
      const end = citation?.end_index;
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > length) continue;
      const [source] = normalizeResults([citation]);
      if (source) cited.push({ source: sourcesByUrl.get(source.url) ?? source, end });
    }
    cited.sort((a, b) => a.end - b.end);
    const sources = new Map<string, SearchResult>();
    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const { source, end } of cited) {
      if (!sources.has(source.url) && sources.size >= 15) continue;
      sources.set(source.url, source);
      const marker = `${end}:${source.url}`;
      if (!seen.has(marker)) { citations.push({ end, url: source.url }); seen.add(marker); }
    }
    for (const [url, source] of sourcesByUrl) { if (sources.size >= 15) break; if (!sources.has(url)) sources.set(url, source); }
    return { sources: sources.size ? [...sources.values()] : undefined, citations: citations.length ? citations : undefined, truncated: this.truncated || undefined };
  }
}
