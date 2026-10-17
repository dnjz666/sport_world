import type { HdcClient } from '../hdc/client.js';
import type { PositionObserver } from './contract.js';
import type { ObservedLocation } from '../core/types.js';

function parseSample(input: unknown): ObservedLocation | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as ObservedLocation;
  if (!Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
    !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
    !Number.isFinite(value.epochMs) || value.epochMs <= 0 ||
    !Number.isFinite(value.receivedAtMs) || value.receivedAtMs <= 0 ||
    (value.accuracyM !== null && (!Number.isFinite(value.accuracyM) || value.accuracyM < 0)) ||
    (value.source !== null && typeof value.source !== 'string') ||
    (value.isMock !== null && typeof value.isMock !== 'boolean')) return null;
  return { latitude: value.latitude, longitude: value.longitude, epochMs: value.epochMs,
    receivedAtMs: value.receivedAtMs, accuracyM: value.accuracyM, source: value.source, isMock: value.isMock };
}

export function createPositionObserver(hdc: HdcClient, targetId: string): PositionObserver {
  let readerPid = '';
  let fenceMs = 0;
  let previousPhoneMs = 0;
  let pending: Promise<ObservedLocation | null> | undefined;

  async function read(args: string[]): Promise<string> {
    const result = await hdc.runTarget(targetId, ['shell', ...args], { signal: AbortSignal.timeout(15000) });
    if (result.exitCode !== 0 || result.stderr.trim() || /\[Fail\]/i.test(result.stdout)) {
      throw new Error(`独立读取失败 (${result.exitCode}): ${result.stdout} ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  async function poll(): Promise<ObservedLocation | null> {
    try {
      const timestamp = await read(['date', '+%s']);
      if (!/^\d+$/.test(timestamp)) throw new Error('无法读取设备采样时间');
      const phoneMs = Number(timestamp) * 1000;
      if (!Number.isSafeInteger(phoneMs) || phoneMs <= 0) throw new Error('设备采样时间无效');
      const pid = await read(['pidof', 'com.example.m0locationreader']);
      if (!pid) { readerPid = ''; fenceMs = 0; return null; }
      if (!/^\d+$/.test(pid)) throw new Error('独立读取应用的 PID 不唯一或无效');
      if (pid !== readerPid || phoneMs < previousPhoneMs) fenceMs = phoneMs + 1000;
      readerPid = pid;
      previousPhoneMs = phoneMs;
      const logs = await read(['hilog', '-x', '-T', 'M0Reader', '-P', pid]);
      let latest: ObservedLocation | null = null;
      for (const line of logs.split(/\r?\n/)) {
        const match = /\bM0Reader:\s*(\{.*\})\s*$/.exec(line);
        if (!match) continue;
        let sample: ObservedLocation | null;
        try { sample = parseSample(JSON.parse(match[1]!)); } catch { continue; }
        if (!sample || sample.epochMs < fenceMs || sample.receivedAtMs < fenceMs ||
          sample.receivedAtMs < phoneMs - 5000 || sample.receivedAtMs >= phoneMs + 1000 ||
          sample.epochMs >= phoneMs + 1000 || Math.abs(sample.receivedAtMs - sample.epochMs) > 5000) continue;
        if (!latest || sample.receivedAtMs > latest.receivedAtMs ||
          (sample.receivedAtMs === latest.receivedAtMs && sample.epochMs > latest.epochMs)) latest = sample;
      }
      return latest;
    } catch (error) {
      readerPid = ''; fenceMs = 0; previousPhoneMs = 0;
      throw error;
    }
  }

  return { latest(): Promise<ObservedLocation | null> {
    if (!pending) pending = poll().finally(() => { pending = undefined; });
    return pending;
  } };
}
