import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { createApplication, stopSession } from '../dist/index.js';
import { controlFixture } from './helpers/control-fixture.mjs';

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'track-application-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); assert.ok(basename(root).startsWith('track-application-')); rmSync(root, { recursive: true }); });
  return root;
}

test('application_without_report_starts_with_unknown_capability', async (t) => {
  const fixture = controlFixture(); const cwd = directory(t);
  const application = await createApplication({ cwd, hdc: fixture.hdc, env: {} });
  t.after(() => application.close());
  assert.equal((await (await fetch(application.url + '/api/state')).json()).state, 'unknown');
  const response = await fetch(application.url + '/api/session', { method: 'POST', headers: { Origin: application.url, 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.command) });
  assert.equal(response.status, 409);
  assert.equal((await (await fetch(application.url + '/api/state')).json()).expected, null);
});

test('application_loads_default_report_and_honors_override', async (t) => {
  const cwd = directory(t); const { hdc } = controlFixture();
  const reports = join(cwd, 'docs', 'verification'); mkdirSync(reports, { recursive: true });
  const evidence = join(cwd, 'evidence.txt'); writeFileSync(evidence, 'synthetic proof');
  const report = { status: 'passed', targetId: 'synthetic-phone', systemBuild: 'synthetic-build',
    targetApp: { bundleName: 'synthetic-reader', version: '1' }, executionHost: 'desktop', g0: true, g1: true, g2: true,
    verifiedStandalone: false, expiresAtMs: null, evidencePaths: [evidence], reason: 'synthetic fixture' };
  writeFileSync(join(reports, 'm0-report.json'), JSON.stringify(report));
  const application = await createApplication({ cwd, hdc, env: {} }); t.after(() => application.close());
  assert.equal((await (await fetch(application.url + '/api/state')).json()).state, 'disconnected');
  const denied = await createApplication({ cwd, hdc, env: { M0_REPORT_PATH: join(cwd, 'missing.json') } }); t.after(() => denied.close());
  assert.equal((await (await fetch(denied.url + '/api/state')).json()).state, 'unknown');
});

test('configured_application_writes_journal_only_under_private_session_directory', async (t) => {
  const cwd = directory(t); const fixture = controlFixture();
  const evidence = join(cwd, 'evidence.txt'); writeFileSync(evidence, 'synthetic evidence');
  const reportPath = join(cwd, 'proof.json');
  writeFileSync(reportPath, JSON.stringify({ status: 'passed', targetId: 'synthetic-phone', systemBuild: 'synthetic-build',
    targetApp: { bundleName: 'synthetic-app', version: '1' }, executionHost: 'desktop', g0: true, g1: true, g2: true,
    verifiedStandalone: false, expiresAtMs: null, evidencePaths: [evidence], reason: 'synthetic' }));
  const app = await createApplication({ cwd, hdc: fixture.hdc, env: { M0_REPORT_PATH: reportPath } });
  t.after(() => app.close());
  // No native prepare/start: configuration alone should produce a real journal event.
  const response = await fetch(app.url + '/api/session', { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.command) });
  assert.equal(response.status, 200);
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = readdirSync(join(cwd, 'local-data', 'sessions'));
  assert.equal(files.length, 1); assert.ok(files[0].endsWith('.jsonl'));
  const event = JSON.parse(readFileSync(join(cwd, 'local-data', 'sessions', files[0]), 'utf8').trim());
  assert.equal(event.kind, 'configured'); assert.equal(event.targetId, 'synthetic-phone');
  // The fixture has no native cleanup transport; close must report its failure instead of claiming restored.
  assert.equal((await app.close()).state, 'recovery_required');
});

test('shutdown_waits_for_independent_recovery', async () => {
  const { controller, command } = controlFixture();
  await controller.dispatch(command); await controller.dispatch({ type: 'start' }); await controller.tick();
  const result = await stopSession(controller);
  assert.equal(result.state, 'stopped');
  assert.equal(result.observed.latitude, 0.01);
});

test('shutdown_failure_or_timeout_does_not_claim_recovered', async () => {
  for (const failedCleanup of [true, false]) {
    const { controller, command, device } = controlFixture();
    await controller.dispatch(command); await controller.dispatch({ type: 'start' }); await controller.tick();
    if (failedCleanup) device.stopAccepted = false;
    else device.observed = { latitude: 0.02, longitude: 0.02 };
    assert.equal((await stopSession(controller, 30)).state, 'recovery_required');
  }
});
