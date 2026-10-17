import type { ProbeReport, Capabilities } from '../core/types.js';
import { readFileSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';

export function capabilitiesFromReport(report: ProbeReport, context: { targetId: string; systemBuild: string; nowMs: number; proofPath: string }): Capabilities {
  const denied: Capabilities = { canInject: false, executionHost: 'none', verifiedStandalone: false,
    targetId: context.targetId, systemBuild: context.systemBuild, expiresAtMs: null, proofPath: context.proofPath };
  try {
    if (!report || report.status !== 'passed' || report.g0 !== true || report.g1 !== true || report.g2 !== true) return denied;
    if (!context.targetId || !context.systemBuild || !Number.isFinite(context.nowMs)) return denied;
    if (report.targetId !== context.targetId || report.systemBuild !== context.systemBuild) return denied;
    if (typeof report.targetApp?.bundleName !== 'string' || !report.targetApp.bundleName.trim() || typeof report.targetApp.version !== 'string' || !report.targetApp.version.trim()) return denied;
    if (report.executionHost !== 'desktop' && report.executionHost !== 'phone') return denied;
    if (typeof report.verifiedStandalone !== 'boolean' || typeof report.reason !== 'string') return denied;
    if (report.expiresAtMs !== null && (!Number.isFinite(report.expiresAtMs) || report.expiresAtMs <= context.nowMs)) return denied;
    if (!statSync(context.proofPath).isFile()) return denied;
    const saved: unknown = JSON.parse(readFileSync(context.proofPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!isDeepStrictEqual(saved, report)) return denied;
    if (!Array.isArray(report.evidencePaths) || report.evidencePaths.length === 0) return denied;
    for (const path of report.evidencePaths) {
      if (typeof path !== 'string' || !path.trim() || !statSync(resolve(path)).isFile()) return denied;
    }
    return { ...denied, canInject: true, executionHost: report.executionHost,
      verifiedStandalone: report.verifiedStandalone, expiresAtMs: report.expiresAtMs };
  } catch {
    return denied;
  }
}
