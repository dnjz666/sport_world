import type { Clock, CompiledRoute, RunSettings, Sample } from './types.js';
import { pointAtDistance } from './route.js';

export interface Replay {
  start(): void;
  pause(): void;
  resume(): void;
  next(): Sample;
  /** True only after next() has emitted the terminal sample. */
  finished(): boolean;
}

export function createReplay(route: CompiledRoute, settings: RunSettings, clock: Clock): Replay {
  const { paceSecPerKm, laps, direction, sampleIntervalMs } = settings;
  const speedMps = 1000 / paceSecPerKm;
  if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0 || !Number.isFinite(speedMps)) {
    throw new Error('paceSecPerKm 必须为可换算速度的正有限数值');
  }
  if (!Number.isSafeInteger(laps) || laps <= 0) throw new Error('laps 必须为正安全整数');
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) {
    throw new Error('sampleIntervalMs 必须为正有限数值');
  }
  if (direction !== 'forward' && direction !== 'reverse') throw new Error('direction 必须为 forward 或 reverse');
  if (!Number.isFinite(route.lengthM) || route.lengthM <= 0) throw new Error('路线长度必须为正有限数值');

  const totalDistanceM = route.lengthM * laps;
  const durationMs = totalDistanceM / speedMps * 1000;
  if (!Number.isFinite(totalDistanceM) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('路线和运行参数产生的总距离或时长无法表示');
  }

  const startPosition = pointAtDistance(route, 0, direction);
  let lastPosition = startPosition;
  let lastElapsedMs = 0;
  let state: 'idle' | 'running' | 'paused' | 'finished' = 'idle';
  let anchorMs = 0;
  let accumulatedMs = 0;
  let sequence = 0;

  function requireActive(): void {
    if (state === 'idle') throw new Error('轨迹尚未启动，请先调用 start()');
    if (state === 'finished') throw new Error('轨迹已完成，请创建新的轨迹');
  }

  function runningElapsedMs(): number {
    return Math.min(durationMs, accumulatedMs + (clock.monotonicMs() - anchorMs));
  }

  return {
    start(): void {
      if (state !== 'idle') throw new Error('轨迹已经启动，不能重复启动');
      anchorMs = clock.monotonicMs();
      state = 'running';
    },
    pause(): void {
      requireActive();
      if (state === 'paused') return;
      accumulatedMs = runningElapsedMs();
      state = 'paused';
    },
    resume(): void {
      requireActive();
      if (state === 'running') return;
      anchorMs = clock.monotonicMs();
      state = 'running';
    },
    next(): Sample {
      requireActive();
      const elapsedMs = state === 'paused' ? accumulatedMs : runningElapsedMs();
      const complete = state === 'running' && elapsedMs >= durationMs;
      if (complete) {
        lastElapsedMs = durationMs;
        // Use the exact start point even when multi-lap floating-point modulo has a remainder.
        lastPosition = startPosition;
      } else if (state === 'running') {
        lastElapsedMs = elapsedMs;
        lastPosition = pointAtDistance(route, speedMps * (elapsedMs / 1000), direction);
      }
      // A paused tick preserves the last output, even if pause() fell between ticks.
      const sample: Sample = {
        sequence: sequence + 1,
        ...lastPosition,
        elapsedMs: lastElapsedMs,
        epochMs: clock.epochMs(),
        speedMps: complete || state === 'paused' ? 0 : speedMps
      };
      sequence++;
      if (complete) state = 'finished';
      return sample;
    },
    finished(): boolean {
      return state === 'finished';
    }
  };
}
