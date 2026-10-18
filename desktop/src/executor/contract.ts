import type { ObservedLocation, Sample } from '../core/types.js';

export interface SendReceipt { sessionId: string; sequence: number; accepted: boolean; errorCode: string | null }
export interface StopReceipt { accepted: boolean; errorCode: string | null }
export interface PositionObserver { latest(): Promise<ObservedLocation | null> }
export interface LocationExecutor {
  prepare(context: { sessionId: string; targetId: string; mode: 'usb' | 'standalone' }): Promise<void>;
  send(sample: Sample): Promise<SendReceipt>;
  stop(): Promise<StopReceipt>;
}
