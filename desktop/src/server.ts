import type { SessionController } from './core/session.js';
import type { HdcClient } from './hdc/client.js';
import type { SessionCommand } from './core/session.js';
import type { RunSettings } from './core/types.js';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseRoute, compileRoute } from './core/route.js';
import { createReplay } from './core/replay.js';

function problem(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

async function readCommand(request: IncomingMessage): Promise<SessionCommand> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'JSON_REQUIRED', '请使用 application/json 提交会话指令');
  }
  const body = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 262144) { reject(problem(413, 'BODY_TOO_LARGE', '路线输入超过 256 KiB，请减少点数')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
    request.on('aborted', () => reject(problem(400, 'REQUEST_ABORTED', '请求已中断')));
  });
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw problem(400, 'INVALID_JSON', 'JSON 格式损坏，请检查括号和引号'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'INVALID_COMMAND', '会话指令必须为 JSON 对象');
  const input = value as Record<string, unknown>;
  if (input.type !== 'configure') {
    if (!['start', 'pause', 'resume', 'stop'].includes(input.type as string) || Object.keys(input).length !== 1) {
      throw problem(400, 'INVALID_COMMAND', '请选择配置、开始、暂停、继续或停止');
    }
    return { type: input.type as 'start' | 'pause' | 'resume' | 'stop' };
  }
  if (Object.keys(input).some((key) => !['type', 'route', 'settings', 'targetId', 'mode'].includes(key))) {
    throw problem(400, 'INVALID_COMMAND', '配置含有未知字段');
  }
  if (typeof input.targetId !== 'string' || !input.targetId.trim()) throw problem(400, 'TARGET_REQUIRED', '请先选择 USB 设备');
  if (input.mode !== 'usb' && input.mode !== 'standalone') throw problem(400, 'INVALID_MODE', '运行模式无效');
  try {
    const route = parseRoute(input.route);
    if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) throw new Error('请填写配速、圈数与方向');
    const settings = input.settings as RunSettings;
    createReplay(compileRoute(route), settings, { monotonicMs: () => 0, epochMs: Date.now });
    return { type: 'configure', route, settings, targetId: input.targetId, mode: input.mode };
  } catch (error) { throw problem(400, 'INVALID_CONFIGURATION', error instanceof Error ? error.message : String(error)); }
}

export async function createControlServer(controller: SessionController, hdc: HdcClient): Promise<{ url: string; close(): Promise<void> }> {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
  ]);
  let url = ''; let closing = false; let closePromise: Promise<void> | undefined;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const json = (status: number, value: unknown): void => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
    };
    void (async () => {
      if (request.headers.host !== new URL(url).host || (request.headers.origin !== undefined && request.headers.origin !== url) ||
        request.headers['sec-fetch-site'] === 'cross-site' || (request.method === 'POST' && request.headers.origin !== url)) {
        throw problem(403, 'FOREIGN_ORIGIN', '控制请求必须来自当前本机页面');
      }
      if (closing) throw problem(503, 'SHUTTING_DOWN', '服务正在关闭');
      const path = new URL(request.url ?? '/', url).pathname;
      if (request.method === 'GET' && path === '/api/state') { json(200, controller.snapshot()); return; }
      if (request.method === 'GET' && path === '/api/targets') {
        try { json(200, { targets: await hdc.listTargets({ signal: AbortSignal.timeout(15000) }) }); }
        catch (error) { throw problem(409, 'HDC_UNAVAILABLE', error instanceof Error ? error.message : String(error)); }
        return;
      }
      if (request.method === 'POST' && path === '/api/session') {
        const command = await readCommand(request);
        if (command.type !== 'stop' && request.headers['x-session-id'] !== undefined && request.headers['x-session-id'] !== controller.snapshot().sessionId) {
          throw problem(409, 'SESSION_CHANGED', '会话已在其他页面更改，请重新应用配置');
        }
        try { json(200, await controller.dispatch(command)); }
        catch (error) {
          const detail = error as Error & { code?: string };
          throw problem(409, typeof detail.code === 'string' ? detail.code : 'SESSION_REJECTED', detail.message ?? '会话操作失败');
        }
        return;
      }
      const asset = assets.get(path);
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        const data = await readFile(new URL('../web/' + asset[0], import.meta.url));
        response.writeHead(200, { 'Content-Type': asset[1]! }); response.end(request.method === 'HEAD' ? undefined : data); return;
      }
      if (asset || ['/api/state', '/api/targets', '/api/session'].includes(path)) {
        throw problem(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持');
      }
      throw problem(404, 'NOT_FOUND', '页面或接口不存在');
    })().catch((error: Error & { status?: number; code?: string }) => {
      if (!response.destroyed) json(error.status ?? 500, { code: error.code ?? 'INTERNAL_ERROR', message: error.status ? error.message : '本地服务异常，请查看会话状态并停止' });
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法取得本地服务端口');
  url = `http://127.0.0.1:${address.port}`;
  const timer = setInterval(() => { void controller.tick().catch(() => { console.error('会话调度异常，请停止并检查恢复状态'); }); }, 250);
  timer.unref();
  return { url, close(): Promise<void> {
    if (!closePromise) {
      closing = true; clearInterval(timer);
      closePromise = new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
    }
    return closePromise;
  } };
}
