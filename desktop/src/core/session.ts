import type { RouteConfig, RunSettings, SessionState, Sample, ObservedLocation, Clock, Capabilities, CompiledRoute, GeoPoint } from './types.js';
import type { createReplay, Replay } from './replay.js';
import type { LocationExecutor, PositionObserver, SendReceipt } from '../executor/contract.js';
import type { Journal } from '../logging/journal.js';
import type { HdcClient } from '../hdc/client.js';
import { compileRoute } from './route.js';
import { distanceMeters } from './geo.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type SessionCommand = { type: 'configure'; route: RouteConfig; settings: RunSettings; targetId: string; mode: 'usb' | 'standalone' }
  | { type: 'start' | 'pause' | 'resume' | 'stop' };
export interface SessionSnapshot {
  sessionId: string | null; state: SessionState; elapsedMs: number; distanceM: number; lap: number;
  expected: Sample | null; sent: { sample: Sample; receipt: SendReceipt } | null; observed: ObservedLocation | null;
  lastError: { code: string; message: string } | null;
}
export interface SessionDependencies {
  replayFactory: typeof createReplay; executor: LocationExecutor; observer: PositionObserver; journal: Journal;
  clock: Clock; hdc: HdcClient; capabilities: Capabilities;
}

interface Fault { code: string; message: string }
const recoveryCriteria = { timeoutMs: 45000, requiredSamples: 3, maxAccuracyM: 50, maxBaselineDistanceM: 50,
  minInjectedDistanceM: 100, maxTimestampDeltaMs: 5000 } as const;
function failure(code: string, message: string): Error & Fault { return Object.assign(new Error(message), { code }); }
function fault(error: unknown, code: string): Fault {
  return { code: typeof (error as Fault)?.code === 'string' ? (error as Fault).code : code,
    message: error instanceof Error ? error.message : String(error) };
}
function validObservation(value: ObservedLocation | null): value is ObservedLocation {
  return value !== null && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && Number.isFinite(value.epochMs) &&
    Number.isFinite(value.receivedAtMs) && value.epochMs > 0 && value.receivedAtMs > 0 &&
    (value.accuracyM === null || (Number.isFinite(value.accuracyM) && value.accuracyM >= 0)) &&
    (value.source === null || typeof value.source === 'string') && (value.isMock === null || typeof value.isMock === 'boolean');
}

export class SessionController {
  private readonly dependencies: SessionDependencies;
  private view: SessionSnapshot;
  private config?: { route: CompiledRoute; settings: RunSettings; targetId: string; mode: 'usb' | 'standalone' };
  private replay?: Replay;
  private generation = 0;
  private configuring = false;
  private startToken: number | undefined;
  private preparation: Promise<void> | undefined;
  private stopping: Promise<SessionSnapshot> | undefined;
  private inflight: { generation: number; promise: Promise<void> } | undefined;
  private baseline: GeoPoint | undefined;
  private observationFence = 0;
  private injected: GeoPoint[] = [];
  private mayHaveInjected = false;
  private cleanupAccepted = false;
  private recoveryFence = 0;
  private recoverySince = 0;
  private recoveryTimedOut = false;
  private recoverySamples = new Set<string>();
  private journalFailed = false;
  private lastSampleAt = -Infinity;

  constructor(dependencies: SessionDependencies) {
    this.dependencies = { ...dependencies, capabilities: { ...dependencies.capabilities } };
    this.view = { sessionId: null, state: dependencies.capabilities.canInject ? 'disconnected' : 'unknown',
      elapsedMs: 0, distanceM: 0, lap: 0, expected: null, sent: null, observed: null, lastError: null };
  }

  snapshot(): SessionSnapshot { return structuredClone(this.view); }

  private current(token: number): boolean { return token === this.generation; }

  private async record(kind: string, data: Record<string, unknown>): Promise<void> {
    if (!this.view.sessionId || !this.config) return;
    try {
      await this.dependencies.journal.append({ kind, epochMs: this.dependencies.clock.epochMs(),
        sessionId: this.view.sessionId, targetId: this.config.targetId, data });
    } catch (error) {
      this.journalFailed = true;
      this.view.lastError = { code: 'JOURNAL_WRITE_FAILED', message: `会话日志写入失败: ${fault(error, '').message}` };
      throw failure(this.view.lastError.code, this.view.lastError.message);
    }
  }

  private async recordSafely(kind: string, data: Record<string, unknown>): Promise<void> {
    try { await this.record(kind, data); } catch { /* Cleanup must continue when the journal is unavailable. */ }
  }

  private checkCapability(): void {
    const capability = this.dependencies.capabilities;
    if (!capability.canInject || capability.executionHost !== 'desktop') throw failure('CAPABILITY_UNAVAILABLE', '定位能力尚未验证');
    if (capability.expiresAtMs !== null && (!Number.isFinite(capability.expiresAtMs) || capability.expiresAtMs <= this.dependencies.clock.epochMs())) {
      throw failure('AUTHORIZATION_EXPIRED', '定位授权已过期');
    }
    if (this.config?.mode !== 'usb') throw failure('UNSUPPORTED_MODE', '当前执行器仅支持已验证的 USB 模式');
    if (this.journalFailed) throw failure('JOURNAL_WRITE_FAILED', '日志不可用，请修复日志并重新建立控制器');
  }

  private async deviceTime(): Promise<number> {
    const result = await this.dependencies.hdc.runTarget(this.config!.targetId, ['shell', 'date', '+%s'], { signal: AbortSignal.timeout(15000) });
    const text = result.stdout.trim();
    const value = Number(text) * 1000;
    if (result.exitCode || result.stderr.trim() || !/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0) {
      throw failure('DEVICE_TIME_UNAVAILABLE', '无法核实设备上的采样时间');
    }
    return value;
  }

  private async observation(token: number, fence: number): Promise<ObservedLocation | null> {
    const observed = await this.dependencies.observer.latest();
    if (!this.current(token)) return null;
    const now = await this.deviceTime();
    if (!this.current(token) || !validObservation(observed) || observed.epochMs < fence || observed.receivedAtMs < fence ||
      observed.receivedAtMs < now - 5000 || observed.receivedAtMs >= now + 1000 || observed.epochMs >= now + 1000 ||
      Math.abs(observed.receivedAtMs - observed.epochMs) > 5000) return null;
    this.view.observed = structuredClone(observed);
    await this.record('observed', { sample: observed });
    return this.current(token) ? observed : null;
  }

  private async collectBaseline(token: number, fence: number): Promise<GeoPoint | null> {
    const deadline = this.dependencies.clock.monotonicMs() + 35000;
    const samples = new Map<string, ObservedLocation>();
    while (this.current(token) && this.dependencies.clock.monotonicMs() < deadline) {
      const observed = await this.observation(token, fence);
      if (!this.current(token)) return null;
      if (this.dependencies.clock.monotonicMs() >= deadline) break;
      if (observed && observed.isMock !== true && observed.accuracyM !== null && observed.accuracyM <= 50) {
        samples.set(`${observed.epochMs}:${observed.receivedAtMs}`, observed);
        if (samples.size > 5) samples.delete(samples.keys().next().value!);
        if (samples.size === 5) {
          const values = [...samples.values()];
          const median = (numbers: number[]): number => numbers.sort((a, b) => a - b)[2]!;
          const baseline = { latitude: median(values.map((sample) => sample.latitude)), longitude: median(values.map((sample) => sample.longitude)) };
          if (values.every((sample) => distanceMeters(sample, baseline) <= 10)) return baseline;
        }
      }
      await delay(50);
    }
    if (!this.current(token)) return null;
    throw failure('BASELINE_UNAVAILABLE', '未取得五个新的稳定正常基线样本；请保持独立读取应用前台运行');
  }

  async dispatch(command: SessionCommand): Promise<SessionSnapshot> {
    if (!command || typeof command !== 'object') throw failure('INVALID_COMMAND', '会话指令格式无效');
    if (command.type === 'stop') return this.beginStop();
    if (command.type === 'configure') {
      if (this.view.state === 'recovery_required') throw failure('RECOVERY_REQUIRED', '必须先清理并确认原会话恢复');
      if (this.startToken !== undefined || ['running', 'paused', 'stopping'].includes(this.view.state)) throw failure('ACTIVE_SESSION', '会话活动期间不能重新配置');
      if (this.configuring) throw failure('BUSY', '配置检查正在进行');
      if (typeof command.targetId !== 'string' || !command.targetId.trim() || command.targetId !== this.dependencies.capabilities.targetId) {
        throw failure('TARGET_MISMATCH', '必须显式选择与能力证据一致的 USB 目标');
      }
      if (!['usb', 'standalone'].includes(command.mode)) throw failure('INVALID_MODE', '运行模式无效');
      const route = compileRoute(command.route);
      const settings = { ...command.settings };
      this.dependencies.replayFactory(route, settings, this.dependencies.clock);
      this.configuring = true;
      try {
        await this.dependencies.hdc.requireTarget(command.targetId, { signal: AbortSignal.timeout(15000) });
        this.generation++;
        this.config = { route, settings, targetId: command.targetId, mode: command.mode };
        this.view = { sessionId: randomUUID(), state: this.dependencies.capabilities.canInject ? 'ready' : 'unknown',
          elapsedMs: 0, distanceM: 0, lap: 1, expected: null, sent: null, observed: null, lastError: null };
        await this.record('configured', { settings, routeLengthM: route.lengthM, mode: command.mode,
          systemBuild: this.dependencies.capabilities.systemBuild });
      } finally { this.configuring = false; }
      return this.snapshot();
    }
    if (command.type === 'start') return this.start();
    if (command.type === 'pause' || command.type === 'resume') {
      if (this.view.state !== 'running' && this.view.state !== 'paused') throw failure('INVALID_STATE', '仅运行中的会话可以暂停或继续');
      if (command.type === 'pause') { this.replay!.pause(); this.view.state = 'paused'; }
      else { this.replay!.resume(); this.view.state = 'running'; }
      try { await this.record('state', { state: this.view.state }); }
      catch (error) { await this.beginStop(fault(error, 'JOURNAL_WRITE_FAILED')); throw error; }
      return this.snapshot();
    }
    throw failure('INVALID_COMMAND', '不支持的会话指令');
  }

  private async start(): Promise<SessionSnapshot> {
    if (this.view.state === 'recovery_required' || this.view.state === 'stopping') throw failure('RECOVERY_REQUIRED', '必须先清理并确认原会话恢复');
    if (!this.config) throw failure('NOT_CONFIGURED', '请先配置路线和显式设备');
    if (this.configuring || this.startToken !== undefined || ['running', 'paused'].includes(this.view.state)) throw failure('ACTIVE_SESSION', '会话正在运行或准备');
    this.checkCapability();
    if (this.view.state === 'stopped') {
      this.view = { sessionId: randomUUID(), state: 'ready', elapsedMs: 0, distanceM: 0, lap: 1,
        expected: null, sent: null, observed: null, lastError: null };
    }
    const token = ++this.generation;
    this.startToken = token;
    this.baseline = undefined; this.injected = []; this.mayHaveInjected = false; this.cleanupAccepted = false;
    try {
      await this.record('start_requested', { mode: this.config.mode });
      const build = await this.dependencies.hdc.runTarget(this.config.targetId, ['shell', 'param', 'get', 'const.product.software.version'], { signal: AbortSignal.timeout(15000) });
      if (!this.current(token)) return this.snapshot();
      if (build.exitCode || build.stderr.trim() || build.stdout.trim() !== this.dependencies.capabilities.systemBuild) {
        throw failure('BUILD_MISMATCH', '当前系统构建与已验证能力不匹配');
      }
      const cleared = await this.dependencies.executor.stop();
      if (!this.current(token)) return this.snapshot();
      await this.record('preflight_cleanup', { receipt: cleared });
      if (!cleared.accepted) throw failure('PREFLIGHT_CLEANUP_FAILED', cleared.errorCode ?? '启动前关闭残留模拟失败');
      const fence = await this.deviceTime() + 1000;
      if (!this.current(token)) return this.snapshot();
      const baseline = await this.collectBaseline(token, fence);
      if (!this.current(token) || !baseline) return this.snapshot();
      this.baseline = baseline;
      this.observationFence = fence;
      await this.record('baseline', { point: baseline, samples: 5 });
      if (!this.current(token)) return this.snapshot();
      this.checkCapability();
      this.mayHaveInjected = true;
      this.preparation = this.dependencies.executor.prepare({ sessionId: this.view.sessionId!, targetId: this.config.targetId, mode: this.config.mode });
      await this.preparation;
      if (!this.current(token)) return this.snapshot();
      this.replay = this.dependencies.replayFactory(this.config.route, this.config.settings, this.dependencies.clock);
      this.replay.start(); this.lastSampleAt = -Infinity;
      this.view.state = 'running'; this.view.lastError = null;
      await this.record('state', { state: 'running' });
      return this.snapshot();
    } catch (error) {
      if (this.current(token)) {
        this.view.lastError = fault(error, 'START_FAILED');
        await this.recordSafely('fault', { error: this.view.lastError });
        if (!this.current(token)) throw error;
        if (this.mayHaveInjected) await this.beginStop(this.view.lastError);
        else this.view.state = this.view.lastError.code === 'PREFLIGHT_CLEANUP_FAILED' ? 'recovery_required' : 'unknown';
      }
      throw error;
    } finally {
      if (this.startToken === token) this.startToken = undefined;
    }
  }

  private beginStop(reason?: Fault): Promise<SessionSnapshot> {
    if (this.stopping) return this.stopping;
    if (!this.config || this.view.state === 'stopped') return Promise.resolve(this.snapshot());
    const token = ++this.generation;
    this.startToken = undefined;
    this.view.state = 'stopping';
    const pendingPreparation = this.preparation;
    const work = (async (): Promise<SessionSnapshot> => {
      try {
        await pendingPreparation?.catch(() => {});
        const receipt = await this.dependencies.executor.stop();
        if (!this.current(token)) return this.snapshot();
        this.cleanupAccepted = receipt.accepted;
        await this.recordSafely('cleanup', { receipt, reason: reason ?? null });
        if (!receipt.accepted) throw failure(reason?.code ?? 'CLEANUP_FAILED', `${reason?.message ?? ''} ${receipt.errorCode ?? '停止清理未确认'}`.trim());
        if (!this.mayHaveInjected) {
          this.view.state = this.journalFailed ? 'unknown' : 'ready';
          if (!this.journalFailed) this.view.lastError = null;
          return this.snapshot();
        }
        this.recoveryFence = await this.deviceTime() + 1000;
        this.recoverySince = this.dependencies.clock.monotonicMs();
        this.recoveryTimedOut = false;
        this.recoverySamples.clear();
        this.view.state = 'recovery_required';
        if (!this.journalFailed) this.view.lastError = reason ?? { code: 'RECOVERY_PENDING', message: '关闭已接受，等待三个新的正常恢复样本' };
        await this.recordSafely('recovery_started', { baseline: this.baseline, fenceEpochMs: this.recoveryFence,
          criteria: recoveryCriteria, injectedPoints: this.injected });
        if (!this.current(token)) return this.snapshot();
        await this.pollRecovery(token);
      } catch (error) {
        this.view.state = 'recovery_required';
        if (!this.journalFailed) this.view.lastError = fault(error, 'CLEANUP_FAILED');
        await this.recordSafely('fault', { error: this.view.lastError });
      }
      return this.snapshot();
    })();
    this.stopping = work;
    void work.finally(() => { if (this.stopping === work) this.stopping = undefined; });
    return work;
  }

  private async recoveryExpired(token: number): Promise<boolean> {
    if (!this.current(token)) return true;
    const elapsedMs = this.dependencies.clock.monotonicMs() - this.recoverySince;
    if (elapsedMs < recoveryCriteria.timeoutMs) return false;
    if (!this.recoveryTimedOut) {
      this.recoveryTimedOut = true;
      if (!this.journalFailed) this.view.lastError = { code: 'RECOVERY_TIMEOUT', message: '原会话恢复等待超时，需要重新停止并复核，不能更换基线' };
      await this.recordSafely('recovery', { confirmed: false, reason: 'timeout', elapsedMs, samples: this.recoverySamples.size });
    }
    return true;
  }

  private async pollRecovery(token: number): Promise<void> {
    if (!this.cleanupAccepted || !this.baseline || !this.recoveryFence || await this.recoveryExpired(token)) return;
    const observed = await this.observation(token, this.recoveryFence);
    if (await this.recoveryExpired(token) || !observed || observed.isMock === true || observed.accuracyM === null || observed.accuracyM > recoveryCriteria.maxAccuracyM ||
      distanceMeters(observed, this.baseline) > recoveryCriteria.maxBaselineDistanceM || this.injected.some((point) => distanceMeters(observed, point) < recoveryCriteria.minInjectedDistanceM)) return;
    this.recoverySamples.add(`${observed.epochMs}:${observed.receivedAtMs}`);
    if (this.recoverySamples.size < recoveryCriteria.requiredSamples || this.journalFailed) return;
    await this.record('recovery', { confirmed: true, samples: this.recoverySamples.size });
    if (!this.current(token)) return;
    this.view.state = 'stopped'; this.view.lastError = null;
  }

  tick(): Promise<void> {
    const token = this.generation;
    if (this.inflight?.generation === token) return this.inflight.promise;
    const promise = this.runTick(token);
    const entry = { generation: token, promise };
    this.inflight = entry;
    void promise.finally(() => { if (this.inflight === entry) this.inflight = undefined; });
    return promise;
  }

  private async runTick(token: number): Promise<void> {
    if (!['running', 'paused', 'recovery_required'].includes(this.view.state)) return;
    try {
      await this.dependencies.hdc.requireTarget(this.config!.targetId, { signal: AbortSignal.timeout(15000) });
      if (!this.current(token)) return;
      if (this.view.state === 'recovery_required') { await this.pollRecovery(token); return; }
      this.checkCapability();
      const now = this.dependencies.clock.monotonicMs();
      if (now - this.lastSampleAt >= this.config!.settings.sampleIntervalMs) {
        const sample = this.replay!.next();
        this.lastSampleAt = now;
        this.view.expected = structuredClone(sample);
        this.view.elapsedMs = sample.elapsedMs;
        this.view.distanceM = Math.min(this.config!.route.lengthM * this.config!.settings.laps, sample.elapsedMs / this.config!.settings.paceSecPerKm);
        this.view.lap = this.replay!.finished() ? this.config!.settings.laps : Math.min(this.config!.settings.laps, Math.floor(this.view.distanceM / this.config!.route.lengthM) + 1);
        await this.record('expected', { sample });
        if (!this.current(token)) return;
        this.injected.push({ latitude: sample.latitude, longitude: sample.longitude });
        const receipt = await this.dependencies.executor.send(sample);
        if (!this.current(token)) return;
        if (receipt.sessionId !== this.view.sessionId || receipt.sequence !== sample.sequence) {
          await this.record('stale_callback', { receipt }); return;
        }
        this.view.sent = { sample: structuredClone(sample), receipt: { ...receipt } };
        await this.record('sent', { sample, receipt });
        if (!this.current(token)) return;
        if (!receipt.accepted) throw failure('INJECTION_FAILED', receipt.errorCode ?? '定位样本发送未接受');
        if (this.replay!.finished()) { await this.beginStop(); return; }
      }
      await this.observation(token, this.observationFence);
    } catch (error) {
      if (!this.current(token)) return;
      const problem = fault(error, 'DISCONNECTED');
      this.view.lastError = problem;
      await this.recordSafely('fault', { error: problem });
      if (!this.current(token)) return;
      if (this.view.state === 'recovery_required') {
        this.generation++;
        this.cleanupAccepted = false; this.recoveryFence = 0; this.recoverySamples.clear();
        return;
      }
      await this.beginStop(problem);
    }
  }
}
