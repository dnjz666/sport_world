import { HdcClient } from './hdc/client.js';
import { SessionController, type SessionSnapshot } from './core/session.js';
import type { Capabilities, ProbeReport } from './core/types.js';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createReplay } from './core/replay.js';
import { runProcess } from './hdc/process.js';
import { capabilitiesFromReport } from './probe/capabilities.js';
import { createPositionObserver } from './executor/observer.js';
import { createVerifiedExecutor } from './executor/verified-executor.js';
import { createJournal } from './logging/journal.js';
import { createControlServer } from './server.js';

export async function createApplication(options: { cwd?: string; env?: NodeJS.ProcessEnv; hdc?: HdcClient } = {}): Promise<{ url: string; close(): Promise<SessionSnapshot> }> {
  const cwd = options.cwd ?? process.cwd(); const env = options.env ?? process.env;
  const proofPath = resolve(cwd, env.M0_REPORT_PATH || 'docs/verification/m0-report.json');
  let report: ProbeReport | undefined;
  try { report = JSON.parse(readFileSync(proofPath, 'utf8').replace(/^\uFEFF/, '')) as ProbeReport; } catch { /* The UI still opens with injection disabled. */ }
  const targetId = typeof report?.targetId === 'string' ? report.targetId : '';
  const systemBuild = typeof report?.systemBuild === 'string' ? report.systemBuild : '';
  const capabilities: Capabilities = report ? capabilitiesFromReport(report, { targetId, systemBuild, nowMs: Date.now(), proofPath }) :
    { canInject: false, executionHost: 'none', verifiedStandalone: false, targetId, systemBuild, expiresAtMs: null, proofPath };
  const hdc = options.hdc ?? new HdcClient({ executable: resolve(cwd, env.HDC_PATH || 'tools/hdc/hdc.exe'), run: runProcess });
  const observer = createPositionObserver(hdc, targetId);
  const controller = new SessionController({ replayFactory: createReplay,
    executor: createVerifiedExecutor(capabilities, hdc, observer), observer, hdc, capabilities,
    journal: createJournal(join(cwd, 'local-data', 'sessions', `${Date.now()}-${randomUUID()}.jsonl`)),
    clock: { monotonicMs: () => performance.now(), epochMs: Date.now } });
  const server = await createControlServer(controller, hdc);
  let closing: Promise<SessionSnapshot> | undefined;
  return { url: server.url, close(): Promise<SessionSnapshot> {
    // Reject further commands and stop the scheduler before starting shutdown cleanup.
    closing ??= (async () => { await server.close(); return stopSession(controller); })();
    return closing;
  } };
}

export async function stopSession(controller: SessionController, timeoutMs = 60000): Promise<SessionSnapshot> {
  if (!controller.snapshot().sessionId) return controller.snapshot();
  let expired = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = (async (): Promise<SessionSnapshot> => {
    let state = await controller.dispatch({ type: 'stop' });
    while (!expired && state.state === 'recovery_required' && (!state.lastError || ['RECOVERY_PENDING'].includes(state.lastError.code))) {
      await delay(100);
      if (expired) break;
      await controller.tick(); state = controller.snapshot();
    }
    return controller.snapshot();
  })();
  try {
    return await Promise.race([cleanup, new Promise<SessionSnapshot>((resolve) => {
      timer = setTimeout(() => { expired = true; resolve(controller.snapshot()); }, timeoutMs);
    })]);
  } finally { expired = true; clearTimeout(timer); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void createApplication().then((application) => {
    console.log(`本地轨迹控制台：${application.url}`);
    console.log('按 Ctrl+C 停止服务；退出时会尝试关闭模拟并独立核对恢复。');
    let exiting = false;
    const shutdown = (): void => {
      if (exiting) return;
      exiting = true; console.log('正在停止服务并核对会话清理与恢复…');
      void application.close().then((state) => {
        if (state.state === 'stopped') console.log('独立样本已确认原会话恢复。');
        else if (['recovery_required', 'stopping'].includes(state.state)) console.error(`恢复未确认：${state.lastError?.message ?? state.state}。请按 prototype/probe/README.md 的关闭与独立复核步骤处理，保留原会话失败记录。`);
        else console.log('本地服务已关闭。');
        process.exit(['recovery_required', 'stopping'].includes(state.state) ? 1 : 0);
      }, () => { console.error('退出清理失败，手机状态未确认。请重新连接并停止复核。'); process.exit(1); });
    };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  }, () => { console.error('本地服务启动失败，请检查端口权限与项目文件。'); process.exitCode = 1; });
}
