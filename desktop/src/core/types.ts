export interface GeoPoint { latitude: number; longitude: number }
export interface RouteConfig { schemaVersion: 1; name: string; coordinateSystem: 'WGS-84'; points: GeoPoint[] }
export interface CompiledRoute { points: GeoPoint[]; segmentLengthsM: number[]; cumulativeLengthsM: number[]; lengthM: number }
export interface RunSettings { paceSecPerKm: number; laps: number; direction: 'forward' | 'reverse'; sampleIntervalMs: number }
export interface Sample { sequence: number; latitude: number; longitude: number; elapsedMs: number; epochMs: number; speedMps: number; bearingDeg: number }
export interface Clock { monotonicMs(): number; epochMs(): number }
export interface ObservedLocation { latitude: number; longitude: number; epochMs: number; receivedAtMs: number; accuracyM: number | null; source: string | null; isMock: boolean | null }
export interface ProbeReport {
  status: 'passed' | 'blocked' | 'unsupported';
  targetId: string | null;
  systemBuild: string | null;
  targetApp: { bundleName: string | null; version: string | null };
  executionHost: 'desktop' | 'phone' | 'none';
  g0: boolean; g1: boolean; g2: boolean;
  verifiedStandalone: boolean;
  expiresAtMs: number | null;
  evidencePaths: string[];
  reason: string;
}
export interface Capabilities {
  canInject: boolean;
  executionHost: 'desktop' | 'phone' | 'none';
  verifiedStandalone: boolean;
  targetId: string;
  systemBuild: string;
  expiresAtMs: number | null;
  proofPath: string;
}
export type SessionState = 'disconnected' | 'unknown' | 'unsupported' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'recovery_required';
