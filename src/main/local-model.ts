import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism } from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { LocalProvider, ModelStatus } from '../shared/contracts';

export type ManagedProvider = Exclude<LocalProvider, 'ollama'>;
type LocalEngine = { provider: `local-${ManagedProvider}`; model: string; endpoint: string; key: string };
export const qwenFilename = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';
const models = {
  deepseek: {
    label: 'DeepSeek', name: 'DeepSeek-R1-1.5B', alias: 'deepseek-r1',
    arguments: ['--reasoning-format', 'deepseek', '--reasoning-budget', '384', '--reasoning-budget-message', '\n现在直接给出最终回答。\n'],
  },
  qwen: { label: '千問', name: 'Qwen2.5-1.5B-Instruct', alias: 'qwen2.5', arguments: [] },
};
type Run = { controller: AbortController; child?: ChildProcess; engine?: LocalEngine; startup?: Promise<LocalEngine | undefined> };

function choosePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      listener.close(error => error ? reject(error) : typeof address === 'object' && address
        ? resolve(address.port) : reject(Error('无法分配本机端口。')));
    });
  });
}

export class LocalModel {
  private run?: Run;
  private state: ModelStatus;
  private spec: typeof models[ManagedProvider];

  constructor(private directory: string, private provider: ManagedProvider, private modelFiles: string[], private changed: (status: ModelStatus) => void) {
    this.spec = models[provider];
    this.state = this.stoppedStatus();
  }

  status() { return this.state; }

  private stoppedStatus(): ModelStatus {
    return { models: [], detail: `本机 ${this.spec.label} 尚未启动` };
  }

  start(retry = false): Promise<LocalEngine | undefined> {
    if (this.run) return this.run.startup!;
    if (this.state.localState === 'error' && !retry) return Promise.resolve(undefined);
    const run: Run = { controller: new AbortController() };
    this.run = run;
    this.update('loading', `正在载入本机 ${this.spec.label}…`);
    run.startup = this.launch(run).catch(error => {
      if (this.run === run) {
        this.stop();
        this.update('error', (error as Error).message);
      }
      return undefined;
    });
    return run.startup;
  }

  stop() {
    const run = this.run;
    this.run = undefined;
    run?.controller.abort();
    run?.child?.kill();
    this.state = this.stoppedStatus();
  }

  private update(localState: ModelStatus['localState'], detail: string) {
    const provider = `local-${this.provider}` as const;
    this.state = { models: [], detail, localState, ...(localState === 'ready' ? { provider, activeModel: this.spec.name } : {}) };
    this.changed(this.state);
  }

  private async launch(run: Run): Promise<LocalEngine> {
    const { label, alias: aliasPrefix } = this.spec;
    const executable = path.join(this.directory, 'llama-server.exe');
    const model = this.modelFiles.find(file => statSync(file, { throwIfNoEntry: false })?.isFile());
    if (!model || !statSync(executable, { throwIfNoEntry: false })?.isFile()) {
      throw Error(`缺少本机 ${label} 文件，请使用含模型的月亮茶屋便携版。`);
    }
    const port = await choosePort();
    const signal = run.controller.signal;
    signal.throwIfAborted();
    const origin = `http://127.0.0.1:${port}`;
    const key = randomBytes(32).toString('hex');
    const alias = `${aliasPrefix}-${key.slice(0, 12)}`;
    const engine: LocalEngine = { provider: `local-${this.provider}`, model: alias, endpoint: `${origin}/v1/chat/completions`, key };
    const child = spawn(executable, [
      '--model', model, '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '--alias', alias,
      '--ctx-size', '8192', '--parallel', '1', '--threads', String(Math.min(8, availableParallelism())),
      ...this.spec.arguments, '--no-webui',
    ], { cwd: this.directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    run.child = child;
    let startupLog = '';
    let failure: Error | undefined;
    child.stderr.on('data', text => {
      if (!run.engine) startupLog = (startupLog + String(text)).slice(-2400);
    });
    child.once('error', () => {
      failure = Error(`本机 ${label} 引擎无法启动，请检查安装文件。`);
    });
    child.once('exit', code => {
      failure = Error(`本机 ${label} 引擎已退出（${code ?? '已关闭'}）。可在设置中重试。`);
      if (this.run === run && run.engine) {
        this.stop();
        this.update('error', failure.message);
      }
    });
    const deadline = Date.now() + 70_000;
    while (Date.now() < deadline && !failure) {
      signal.throwIfAborted();
      const options = {
        headers: { authorization: `Bearer ${key}` }, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(850)]),
      } as const;
      const health = await fetch(`${origin}/health`, options).catch(() => undefined);
      const available = health?.ok && (await health.json().catch(() => undefined))?.status === 'ok';
      if (!available) await health?.body?.cancel().catch(() => undefined);
      const response = available ? await fetch(`${origin}/v1/models`, options).catch(() => undefined) : undefined;
      if (response?.ok) {
        const list = await response.json().catch(() => undefined);
        if (!failure && Array.isArray(list?.data) && list.data.some((item: { id?: unknown }) => item?.id === alias)) {
          signal.throwIfAborted();
          run.engine = engine;
          this.update('ready', `本机 ${label} · 已就绪`);
          return engine;
        }
      } else await response?.body?.cancel().catch(() => undefined);
      await delay(250, undefined, { signal });
    }
    if (startupLog) console.error(`本机 ${label} 启动记录`, startupLog);
    throw failure ?? Error(`本机 ${label} 载入超时。可在设置中重试。`);
  }
}
