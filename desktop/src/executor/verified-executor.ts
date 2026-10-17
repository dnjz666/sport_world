import type { Capabilities, ProbeReport, Sample } from '../core/types.js';
import type { HdcClient } from '../hdc/client.js';
import type { LocationExecutor, PositionObserver, SendReceipt, StopReceipt } from './contract.js';
import { capabilitiesFromReport } from '../probe/capabilities.js';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function createVerifiedExecutor(capabilities: Capabilities, hdc: HdcClient, observer: PositionObserver): LocationExecutor {
  const capability = { ...capabilities };
  let state: 'idle' | 'prepared' | 'failed' | 'stopped' = 'idle';
  let sessionId = '';
  let remoteDir: string | undefined;
  let localDir: string | undefined;
  let directoryCreated = false;
  let lastSequence = 0;
  const remoteFiles = new Map<string, string>();
  const localFiles = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  }

  function requireProof(): void {
    if (capability.expiresAtMs !== null && (!Number.isFinite(capability.expiresAtMs) || capability.expiresAtMs <= Date.now())) {
      throw new Error('定位能力授权已过期');
    }
    if (!capability.canInject || capability.executionHost !== 'desktop') throw new Error('没有已验证的桌面定位能力');
    try {
      const report = JSON.parse(readFileSync(capability.proofPath, 'utf8').replace(/^\uFEFF/, '')) as ProbeReport;
      const current = capabilitiesFromReport(report, { targetId: capability.targetId, systemBuild: capability.systemBuild,
        nowMs: Date.now(), proofPath: capability.proofPath });
      if (!current.canInject || current.executionHost !== 'desktop' || current.expiresAtMs !== capability.expiresAtMs) {
        throw new Error('能力证据无效、过期或已改变');
      }
    } catch (error) { throw new Error(`能力证据检查失败: ${message(error)}`); }
  }

  async function command(args: string[], expected?: string, authorize = false): Promise<string> {
    const result = await hdc.runTarget(capability.targetId, args, { signal: AbortSignal.timeout(15000),
      ...(authorize ? { beforeRun: requireProof } : {}) });
    if (result.exitCode !== 0 || result.stderr.trim() || /\[Fail\]/i.test(result.stdout) ||
      (expected !== undefined && result.stdout.trim() !== expected)) {
      throw new Error(`HDC (${result.exitCode}): ${result.stdout.trim()} ${result.stderr.trim()}`.trim());
    }
    return result.stdout.trim();
  }

  async function requireBuild(): Promise<void> {
    const build = await command(['shell', 'param', 'get', 'const.product.software.version']);
    if (build !== capability.systemBuild) throw new Error('当前系统构建与定位能力证据不匹配');
  }

  async function removeLocal(path: string): Promise<void> {
    try { await unlink(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    localFiles.delete(path);
  }

  async function cleanup(): Promise<StopReceipt> {
    if (state === 'idle') return { accepted: false, errorCode: '执行器尚未准备，没有已确认的停止结果' };
    if (state === 'stopped') return { accepted: true, errorCode: null };
    state = 'failed';
    try {
      // Expired proof must never prevent a restoration attempt on the same explicit USB target.
      await command(['shell', 'testhelper', 'disable-location-mock'], 'Disable location mock successfully.');
    } catch (error) { return { accepted: false, errorCode: message(error) }; }
    const errors: string[] = [];
    for (const [path, digest] of remoteFiles) {
      try {
        const result = await command(['shell', 'sha256sum', path]);
        if (result.includes(path) && result.includes('No such file or directory')) {
          remoteFiles.delete(path); continue;
        }
        if (result !== `${digest}  ${path}`) throw new Error(`远端文件摘要不一致，保留文件: ${path}`);
        await command(['shell', 'rm', path], '');
        remoteFiles.delete(path);
      } catch (error) { errors.push(message(error)); }
    }
    if (directoryCreated && remoteFiles.size === 0) {
      try { await command(['shell', 'rmdir', remoteDir!], ''); directoryCreated = false; }
      catch (error) { errors.push(message(error)); }
    }
    for (const path of localFiles) {
      try { await removeLocal(path); } catch (error) { errors.push(message(error)); }
    }
    if (localDir && localFiles.size === 0) {
      try { await rmdir(localDir); localDir = undefined; } catch (error) { errors.push(message(error)); }
    }
    if (errors.length) return { accepted: false, errorCode: errors.join('\n') };
    state = 'stopped';
    return { accepted: true, errorCode: null };
  }

  return {
    prepare(context): Promise<void> {
      const requested = { ...context };
      return serialize(async () => {
        if (state !== 'idle') throw new Error('执行器已准备或使用，请创建新实例');
        if (requested.targetId !== capability.targetId) throw new Error('目标设备与定位能力证据不匹配');
        if (requested.mode !== 'usb') throw new Error('当前适配器仅支持 USB，脱机执行尚未验证');
        if (typeof requested.sessionId !== 'string' || !requested.sessionId.trim() || requested.sessionId.length > 128) {
          throw new Error('会话标识无效');
        }
        requireProof();
        await requireBuild();
        await observer.latest(); // Establish the independent channel; null never becomes a made-up location.
        sessionId = requested.sessionId;
        state = 'failed';
        remoteDir = '/data/local/tmp/swtrack-' + randomUUID().replaceAll('-', '');
        localDir = await mkdtemp(join(tmpdir(), 'sport-world-executor-'));
        await command(['shell', 'mkdir', remoteDir], '');
        directoryCreated = true;
        requireProof();
        await command(['shell', 'testhelper', 'enable-location-mock'], 'Enable location mock successfully.', true);
        state = 'prepared';
      });
    },
    send(input): Promise<SendReceipt> {
      const sample = { ...input };
      return serialize(async () => {
        if (state !== 'prepared') throw new Error('执行器未准备或已停止；需要先清理并创建新实例');
        const receipt = (accepted: boolean, errorCode: string | null): SendReceipt =>
          ({ sessionId, sequence: sample.sequence, accepted, errorCode });
        if (!Number.isSafeInteger(sample.sequence) || sample.sequence <= lastSequence ||
          ![sample.latitude, sample.longitude, sample.epochMs, sample.elapsedMs, sample.speedMps, sample.bearingDeg].every(Number.isFinite) ||
          Math.abs(sample.latitude) > 90 || Math.abs(sample.longitude) > 180 || sample.elapsedMs < 0 || sample.speedMps < 0 ||
          sample.bearingDeg < 0 || sample.bearingDeg >= 360 || !Number.isFinite(new Date(sample.epochMs).getTime())) {
          return receipt(false, '样本序号、坐标、时间、速度或方向无效');
        }
        try {
          requireProof();
          await requireBuild();
          const name = `sample-${sample.sequence}.gpx`;
          const localPath = join(localDir!, name);
          const remotePath = remoteDir! + '/' + name;
          const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<gpx version="1.1" creator="SportWorldTrack" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
            `<trkpt lat="${sample.latitude.toFixed(8)}" lon="${sample.longitude.toFixed(8)}"><time>${new Date(sample.epochMs).toISOString()}</time></trkpt>` +
            '</trkseg></trk></gpx>\n';
          const digest = createHash('sha256').update(xml).digest('hex');
          localFiles.add(localPath);
          try {
            await writeFile(localPath, xml, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            remoteFiles.set(remotePath, digest);
            const transfer = await command(['file', 'send', localPath, remotePath]);
            if (!transfer.includes('FileTransfer finish')) throw new Error(`GPX 传输未确认: ${transfer}`);
            const actualHash = await command(['shell', 'sha256sum', remotePath]);
            if (actualHash !== `${digest}  ${remotePath}`) throw new Error('GPX SHA-256 摘要不匹配，拒绝设置位置');
            requireProof();
            await command(['shell', 'testhelper', 'set-mocked-locations', remotePath, '1'], 'Set mocked locations successfully.', true);
            lastSequence = sample.sequence;
          } finally { await removeLocal(localPath); }
          return receipt(true, null);
        } catch (error) {
          state = 'failed';
          return receipt(false, message(error));
        }
      });
    },
    stop(): Promise<StopReceipt> { return serialize(cleanup); }
  };
}
