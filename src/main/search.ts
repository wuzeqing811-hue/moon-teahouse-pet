import { execFile } from 'node:child_process';
import type { SearchResult, Settings } from '../shared/contracts';
import { publicUrl } from './storage';

function compact(input: unknown, max: number) {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function normalizeResults(raw: unknown, limit = 5): SearchResult[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawUrl = compact(item.href ?? item.url, 2048);
    try {
      const url = publicUrl(rawUrl);
      url.hash = '';
      const address = url.toString();
      if (seen.has(address)) continue;
      seen.add(address);
      results.push({ url: address, title: compact(item.title, 160) || url.hostname, snippet: compact(item.body ?? item.content ?? item.snippet, 700) });
      if (results.length >= limit) break;
    } catch { /* The search payload can include malformed links. */ }
  }
  return results;
}

async function pythonSearch(query: string, executable: string, script: string, signal?: AbortSignal) {
  const commands = executable ? [[executable, []] as const] : process.platform === 'win32' ?
    [['py', ['-3']], ['python', []]] as const : [['python3', []]] as const;
  let lastError: unknown;
  for (const [command, prefix] of commands) {
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const child = execFile(command, [...prefix, '-X', 'utf8', script], {
          timeout: 22_000, maxBuffer: 512_000, windowsHide: true, signal,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        }, (error, stdout) => {
          if (error) { reject(error); return; }
          try {
            const result = JSON.parse(stdout);
            if (result.error) reject(new Error(result.error));
            else resolve(result.results);
          } catch { reject(new Error('ddgs 返回了无法解析的内容。')); }
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(JSON.stringify({ query }));
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== 'ENOENT' && code !== '9009') break;
      if (!code) break;
    }
  }
  if ((lastError as NodeJS.ErrnoException & { killed?: boolean })?.killed) throw Error('ddgs 搜索超时。');
  throw Error(lastError instanceof Error && !('cmd' in lastError) && !('path' in lastError)
    ? lastError.message : 'ddgs 搜索未就绪。请安装 Python 3.10+ 和 ddgs，或在设置中配置 SearXNG。');
}

export async function performSearch(query: unknown, settings: Settings, script: string, abort?: AbortSignal): Promise<SearchResult[]> {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 300) throw Error('请输入 1–300 字的搜索词。');
  const terms = query.trim();
  if (settings.searchProvider === 'ddgs') return normalizeResults(await pythonSearch(terms, settings.pythonPath, script, abort));
  if (settings.searchProvider === 'deepseek') throw Error('DeepSeek 联网搜索请通过聊天框使用。');
  const url = publicUrl(settings.searxngUrl);
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/search$/, '') + '/search';
  url.search = '';
  url.hash = '';
  url.searchParams.set('q', terms);
  url.searchParams.set('format', 'json');
  const signals = [AbortSignal.timeout(14_000), ...(abort ? [abort] : [])];
  try {
    const response = await fetch(url, { signal: AbortSignal.any(signals), redirect: 'error' });
    if (response.status === 403) throw Error('SearXNG 拒绝 JSON 搜索，请启用 json 输出。');
    if (!response.ok) throw Error(`SearXNG 返回 HTTP ${response.status}。`);
    return normalizeResults((await response.json()).results);
  } catch (error) {
    if (abort?.aborted) throw error;
    if ((error as Error).name === 'TimeoutError') throw Error('SearXNG 搜索超时。');
    if (error instanceof TypeError || error instanceof SyntaxError) throw Error('SearXNG 无法连接或返回格式无效，请检查设置。');
    throw error;
  }
}
