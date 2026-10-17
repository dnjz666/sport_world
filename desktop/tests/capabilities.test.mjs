import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilitiesFromReport } from '../dist/probe/capabilities.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sport-world-capability-'));
  const evidence = join(dir, 'observed.json'); const proof = join(dir, 'report.json');
  const extraDir = join(dir, 'directory-is-not-proof');
  writeFileSync(evidence, '{"synthetic":true}'); mkdirSync(extraDir);
  t.after(() => {
    for (const path of [evidence, proof]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(extraDir); rmdirSync(dir);
  });
  const report = { status: 'passed', targetId: 'synthetic-phone', systemBuild: 'synthetic-build',
    targetApp: { bundleName: 'example.test', version: '1.0' }, executionHost: 'desktop',
    g0: true, g1: true, g2: true, verifiedStandalone: false, expiresAtMs: null, evidencePaths: [evidence], reason: 'Synthetic unit-test fixture, not real device proof' };
  const context = { targetId: 'synthetic-phone', systemBuild: 'synthetic-build', nowMs: 1000, proofPath: proof };
  return { report, context, evidence, extraDir, save: () => writeFileSync(proof, JSON.stringify(report)) };
}

test('proof_required_for_capability', (t) => {
  const f = fixture(t); assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false); f.save();
  for (const gate of ['g0', 'g1', 'g2']) {
    f.report[gate] = false; f.save(); assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false); f.report[gate] = true;
  }
  f.save(); unlinkSync(f.evidence); assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false);
});

test('expired_or_wrong_device_proof_rejected', (t) => {
  const f = fixture(t); f.report.expiresAtMs = f.context.nowMs - 1; f.save();
  assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false);
  f.report.expiresAtMs = f.context.nowMs; f.save(); assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false);
  f.report.expiresAtMs = null; f.save();
  assert.equal(capabilitiesFromReport(f.report, { ...f.context, targetId: 'another-phone' }).canInject, false);
  assert.equal(capabilitiesFromReport(f.report, { ...f.context, systemBuild: 'another-build' }).canInject, false);
});

test('complete_matching_evidence_enables_only_reported_capabilities', (t) => {
  const f = fixture(t); f.report.expiresAtMs = 2000; f.save();
  assert.deepEqual(capabilitiesFromReport(f.report, f.context), { canInject: true, executionHost: 'desktop', verifiedStandalone: false,
    targetId: 'synthetic-phone', systemBuild: 'synthetic-build', expiresAtMs: 2000, proofPath: f.context.proofPath });
});

test('malformed_or_unrelated_proof_does_not_enable_injection', (t) => {
  const f = fixture(t); writeFileSync(f.context.proofPath, '{broken');
  assert.equal(capabilitiesFromReport(f.report, f.context).canInject, false);
  f.save(); f.report.verifiedStandalone = true;
  const denied = capabilitiesFromReport(f.report, f.context);
  assert.equal(denied.canInject, false); assert.equal(denied.verifiedStandalone, false);
  assert.equal(capabilitiesFromReport(f.report, { ...f.context, proofPath: f.extraDir }).canInject, false);
});

test('invalid_report_fields_fail_closed', (t) => {
  const f = fixture(t);
  for (const patch of [{ status: 'blocked' }, { executionHost: 'none' }, { g0: 'true' }, { evidencePaths: [] },
    { expiresAtMs: NaN }, { targetApp: { bundleName: null, version: null } }, { targetId: null }]) {
    const report = { ...f.report, ...patch }; writeFileSync(f.context.proofPath, JSON.stringify(report));
    assert.equal(capabilitiesFromReport(report, f.context).canInject, false);
  }
  f.save(); assert.equal(capabilitiesFromReport(f.report, { ...f.context, nowMs: NaN }).canInject, false);
});
