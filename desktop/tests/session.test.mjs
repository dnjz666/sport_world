import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { SessionController } from '../dist/core/session.js';
import { createReplay } from '../dist/core/replay.js';
import { compileRoute } from '../dist/core/route.js';
import { HdcClient } from '../dist/hdc/client.js';
import { createJournal } from '../dist/logging/journal.js';

const track = JSON.parse(readFileSync(new URL('./fixtures/track.json', import.meta.url), 'utf8'));
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function fixture(capabilityOverrides = {}) {
  const time = { monotonic: 1000, epoch: 1800000000000, phone: 1850000000000 };
  const device = { connected: true, build: 'synthetic-build', stopAccepted: true, observationMode: 'normal',
    observedPoint: { latitude: 0.01, longitude: 0.01 }, cached: null, lastObservation: null,
    observeGate: null, sendGate: null, prepareGate: null, stopGate: null,
    sends: [], prepares: [], stops: 0, events: [], failLogKind: null, sendReceipt: null, observationDelayMs: 0 };
  const clock = { monotonicMs: () => time.monotonic, epochMs: () => time.epoch };
  const advance = (ms) => { time.monotonic += ms; time.epoch += ms; time.phone += ms; };
  const capabilities = { canInject: true, executionHost: 'desktop', verifiedStandalone: false, targetId: 'phone-a',
    systemBuild: 'synthetic-build', expiresAtMs: null, proofPath: 'synthetic-proof', ...capabilityOverrides };
  const observer = { latest: async () => {
    if (device.observationMode === 'none') { time.monotonic += 10000; return null; }
    if (device.observationMode === 'cached') return structuredClone(device.cached);
    time.phone += 1000;
    const sample = { ...device.observedPoint, epochMs: time.phone, receivedAtMs: time.phone,
      accuracyM: device.observationMode === 'bad_accuracy' ? 51 : 5, source: null,
      isMock: device.observationMode === 'mock' ? true : null };
    device.lastObservation = structuredClone(sample);
    time.monotonic += device.observationDelayMs;
    const gate = device.observeGate; device.observeGate = null;
    if (gate) { gate.entered.resolve(); await gate.release.promise; }
    return sample;
  } };
  const executor = {
    prepare: async (context) => {
      device.prepares.push(structuredClone(context));
      if (device.prepareGate) { device.prepareGate.entered.resolve(); await device.prepareGate.release.promise; }
    },
    send: async (sample) => {
      const sessionId = device.prepares.at(-1).sessionId;
      device.sends.push(structuredClone(sample));
      if (device.sendGate) { device.sendGate.entered.resolve(); await device.sendGate.release.promise; }
      return device.sendReceipt ?? { sessionId, sequence: sample.sequence, accepted: true, errorCode: null };
    },
    stop: async () => {
      device.stops++;
      if (device.stopGate) { device.stopGate.entered.resolve(); await device.stopGate.release.promise; }
      return { accepted: device.connected && device.stopAccepted, errorCode: device.connected ? (device.stopAccepted ? null : 'native error 201') : 'USB disconnected' };
    }
  };
  const journal = { append: async (event) => {
    if (event.kind === device.failLogKind) throw new Error('disk full');
    device.events.push(structuredClone(event));
  } };
  const hdc = new HdcClient({ executable: 'synthetic-hdc', run: async (_exe, args) => {
    const stdout = args[2] === 'list' ? (device.connected ? 'phone-a USB Connected localhost hdc' : 'phone-b USB Connected localhost hdc') :
      args.includes('date') ? String(Math.floor(time.phone / 1000)) : device.build;
    return { exitCode: 0, stdout, stderr: '' };
  } });
  const route = structuredClone(track);
  const settings = { paceSecPerKm: 300, laps: 2, direction: 'forward', sampleIntervalMs: 1000 };
  const controller = new SessionController({ replayFactory: createReplay, executor, observer, journal, clock, hdc, capabilities });
  const configure = () => controller.dispatch({ type: 'configure', route, settings, targetId: 'phone-a', mode: 'usb' });
  const start = async () => { await configure(); return controller.dispatch({ type: 'start' }); };
  const recover = async () => {
    for (let i = 0; i < 4 && controller.snapshot().state !== 'stopped'; i++) { advance(1000); await controller.tick(); }
    return controller.snapshot();
  };
  return { controller, device, time, advance, clock, capabilities, route, settings, configure, start, recover };
}

test('normal_controls_match_output', async () => {
  const { controller, device, advance, start, recover, route } = fixture();
  await start();
  assert.equal(controller.snapshot().state, 'running');
  assert.equal(device.stops, 1); // Known-clear preflight before a normal baseline.
  await controller.tick();
  advance(30000); await controller.tick();
  near(controller.snapshot().distanceM, 100);
  await controller.dispatch({ type: 'pause' });
  advance(60000); await controller.tick();
  assert.equal(controller.snapshot().expected.elapsedMs, 30000);
  assert.equal(controller.snapshot().expected.speedMps, 0);
  await controller.dispatch({ type: 'resume' });
  advance(30000); await controller.tick();
  assert.equal(controller.snapshot().expected.elapsedMs, 60000);
  advance(1000000); await controller.tick();
  assert.equal(controller.snapshot().state, 'recovery_required');
  near(controller.snapshot().distanceM, compileRoute(route).lengthM * 2);
  assert.equal((await recover()).state, 'stopped');
  assert.equal(device.stops, 2);
  const count = device.sends.length;
  advance(10000); await controller.tick();
  assert.equal(device.sends.length, count);
  for (const kind of ['expected', 'sent', 'observed', 'cleanup', 'recovery_started', 'recovery']) assert.ok(device.events.some((event) => event.kind === kind), kind);
  const recovery = device.events.find((event) => event.kind === 'recovery_started').data;
  assert.deepEqual(recovery.baseline, { latitude: 0.01, longitude: 0.01 });
  assert.ok(recovery.fenceEpochMs > device.events.find((event) => event.kind === 'cleanup').epochMs);
  assert.equal(recovery.criteria.timeoutMs, 45000);
  assert.equal(recovery.criteria.requiredSamples, 3);
  assert.equal(recovery.injectedPoints.length, device.sends.length);
});

test('disconnect_enters_recovery_required', async () => {
  const { controller, device, start, recover } = fixture();
  await start(); await controller.tick();
  device.connected = false;
  await controller.tick();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.connected = true;
  await assert.rejects(() => controller.dispatch({ type: 'start' }), { code: 'RECOVERY_REQUIRED' });
  await controller.dispatch({ type: 'stop' });
  assert.equal((await recover()).state, 'stopped');
});

test('cleanup_failure_never_marks_stopped', async () => {
  const { controller, device, start, recover } = fixture();
  await start(); await controller.tick();
  device.stopAccepted = false;
  await controller.dispatch({ type: 'stop' });
  assert.equal(controller.snapshot().state, 'recovery_required');
  assert.match(controller.snapshot().lastError.message, /201/);
  await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.stopAccepted = true;
  await controller.dispatch({ type: 'stop' });
  assert.equal((await recover()).state, 'stopped');
});

test('preflight_cleanup_failure_requires_explicit_recovery', async () => {
  const { controller, device, start } = fixture();
  device.stopAccepted = false;
  await assert.rejects(start, { code: 'PREFLIGHT_CLEANUP_FAILED' });
  assert.equal(controller.snapshot().state, 'recovery_required');
  await assert.rejects(() => controller.dispatch({ type: 'start' }), { code: 'RECOVERY_REQUIRED' });
  assert.equal(device.prepares.length, 0);
});

test('disconnect_during_recovery_invalidates_old_cleanup_and_samples', async () => {
  const { controller, device, start, recover } = fixture();
  await start(); await controller.tick();
  await controller.dispatch({ type: 'stop' });
  device.connected = false; await controller.tick();
  device.connected = true; await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  await controller.dispatch({ type: 'stop' });
  assert.equal((await recover()).state, 'stopped');
});

test('active_config_is_immutable', async () => {
  const { controller, route, settings, capabilities, start, advance, configure } = fixture();
  await start();
  const id = controller.snapshot().sessionId;
  route.points[0].latitude = 80; settings.paceSecPerKm = 1; capabilities.targetId = 'phone-b';
  await assert.rejects(configure, { code: 'ACTIVE_SESSION' });
  advance(30000); await controller.tick();
  assert.equal(controller.snapshot().sessionId, id);
  near(controller.snapshot().distanceM, 100);
  near(controller.snapshot().expected.longitude, 0.0008993203637245, 1e-9);
  const snapshot = controller.snapshot(); snapshot.sent.sample.latitude = 90;
  assert.equal(controller.snapshot().sent.sample.latitude, 0);
});

test('stale_callback_ignored', async () => {
  const { controller, device, start, configure, recover, advance } = fixture();
  await start();
  const gate = { entered: deferred(), release: deferred() };
  device.observedPoint = { latitude: 40, longitude: 50 };
  device.observeGate = gate;
  const oldTick = controller.tick();
  await gate.entered.promise;
  device.observedPoint = { latitude: 0.01, longitude: 0.01 };
  await controller.dispatch({ type: 'stop' }); await recover();
  await configure(); await controller.dispatch({ type: 'start' });
  advance(1000); await controller.tick();
  const current = controller.snapshot();
  gate.release.resolve(); await oldTick;
  assert.deepEqual(controller.snapshot(), current);
  assert.equal(controller.snapshot().observed.latitude, 0.01);
});

test('fresh_independent_observation_required', async () => {
  const { controller, device, start, recover } = fixture();
  await start(); await controller.tick();
  device.cached = structuredClone(device.lastObservation); device.observationMode = 'cached';
  await controller.dispatch({ type: 'stop' }); await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.observationMode = 'normal';
  await controller.tick();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.cached = structuredClone(device.lastObservation); device.observationMode = 'cached';
  await controller.tick(); await controller.tick();
  assert.equal(controller.snapshot().state, 'recovery_required'); // Repeated callback is not three independent samples.
  device.observationMode = 'normal';
  assert.equal((await recover()).state, 'stopped');
});

test('wrong_recovery_position_does_not_replace_original_baseline', async () => {
  const { controller, device, start, recover, configure } = fixture();
  await start(); await controller.tick();
  device.observedPoint = { latitude: 0.010459, longitude: 0.01 }; // About 51 m from original baseline.
  await controller.dispatch({ type: 'stop' }); await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  await assert.rejects(configure, { code: 'RECOVERY_REQUIRED' });
  device.observedPoint = { latitude: 0.01, longitude: 0.01 };
  assert.equal((await recover()).state, 'stopped');
});

test('mock_or_inaccurate_recovery_samples_never_confirm_recovery', async () => {
  const { controller, device, start, recover } = fixture();
  await start(); await controller.tick();
  device.observationMode = 'mock';
  await controller.dispatch({ type: 'stop' }); await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.observationMode = 'bad_accuracy'; await recover();
  assert.equal(controller.snapshot().state, 'recovery_required');
  device.observationMode = 'normal';
  assert.equal((await recover()).state, 'stopped');
});

test('baseline_required_before_prepare_enables_mock', async () => {
  const { controller, device, configure } = fixture();
  await configure();
  device.observationMode = 'none';
  await assert.rejects(() => controller.dispatch({ type: 'start' }), { code: 'BASELINE_UNAVAILABLE' });
  assert.equal(device.prepares.length, 0);
  assert.equal(device.sends.length, 0);
  assert.notEqual(controller.snapshot().state, 'running');
  assert.ok(device.events.some((event) => event.kind === 'fault' && event.data.error.code === 'BASELINE_UNAVAILABLE'));
});

test('baseline_sample_crossing_acquisition_deadline_cannot_enable_mock', async () => {
  const { controller, device, configure } = fixture();
  await configure(); device.observationDelayMs = 8000;
  await assert.rejects(() => controller.dispatch({ type: 'start' }), { code: 'BASELINE_UNAVAILABLE' });
  assert.equal(device.prepares.length, 0);
  assert.equal(device.sends.length, 0);
});

test('stop_during_prepare_invalidates_late_completion', async () => {
  const { controller, device, configure, recover } = fixture();
  await configure();
  const gate = { entered: deferred(), release: deferred() }; device.prepareGate = gate;
  const starting = controller.dispatch({ type: 'start' });
  await gate.entered.promise;
  const stopping = controller.dispatch({ type: 'stop' });
  assert.equal(controller.snapshot().state, 'stopping');
  gate.release.resolve();
  await Promise.allSettled([starting, stopping]);
  assert.equal((await recover()).state, 'stopped');
  assert.equal(device.sends.length, 0);
});

test('concurrent_ticks_are_coalesced_and_interval_is_respected', async () => {
  const { controller, device, start, advance } = fixture();
  await start();
  const gate = { entered: deferred(), release: deferred() }; device.sendGate = gate;
  const first = controller.tick(); await gate.entered.promise;
  advance(30000);
  const overlapping = controller.tick(); gate.release.resolve();
  await Promise.all([first, overlapping]);
  assert.equal(device.sends.length, 1);
  device.sendGate = null;
  await controller.tick();
  assert.equal(device.sends.length, 2);
  near(controller.snapshot().distanceM, 100);
  await controller.tick();
  assert.equal(device.sends.length, 2);
});

test('journal_failure_still_attempts_cleanup_and_is_visible', async () => {
  const { controller, device, start } = fixture();
  await start();
  device.failLogKind = 'expected';
  await controller.tick();
  assert.equal(device.sends.length, 0);
  assert.equal(controller.snapshot().state, 'recovery_required');
  assert.equal(controller.snapshot().lastError.code, 'JOURNAL_WRITE_FAILED');
  assert.ok(device.stops >= 2);
});

test('unverified_expired_or_wrong_device_capability_cannot_start', async () => {
  for (const mode of ['unverified', 'expired', 'build']) {
    const f = fixture(mode === 'unverified' ? { canInject: false } : mode === 'expired' ? { expiresAtMs: 1800000000000 - 1 } : {});
    if (mode === 'build') f.device.build = 'other-build';
    await f.controller.dispatch({ type: 'configure', route: f.route, settings: f.settings, targetId: 'phone-a', mode: 'usb' });
    await assert.rejects(() => f.controller.dispatch({ type: 'start' }), { code: mode === 'build' ? 'BUILD_MISMATCH' : mode === 'expired' ? 'AUTHORIZATION_EXPIRED' : 'CAPABILITY_UNAVAILABLE' });
    assert.equal(f.device.prepares.length, 0);
  }
});

test('recovery_timeout_does_not_mark_stopped', async () => {
  const { controller, device, start, advance } = fixture();
  await start(); await controller.tick();
  device.observationMode = 'none';
  await controller.dispatch({ type: 'stop' });
  advance(46000); await controller.tick();
  assert.equal(controller.snapshot().state, 'recovery_required');
  assert.equal(controller.snapshot().lastError.code, 'RECOVERY_TIMEOUT');
  await controller.tick();
  const timeouts = device.events.filter((event) => event.kind === 'recovery' && event.data.reason === 'timeout');
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].data.confirmed, false);
});

test('recovery_observation_crossing_deadline_cannot_confirm_restored', async () => {
  const { controller, device, start, advance } = fixture();
  await start(); await controller.tick();
  await controller.dispatch({ type: 'stop' });
  await controller.tick(); // Two valid post-cleanup samples so far.
  advance(44000);
  const gate = { entered: deferred(), release: deferred() }; device.observeGate = gate;
  const pending = controller.tick(); await gate.entered.promise;
  advance(2000); gate.release.resolve(); await pending;
  assert.equal(controller.snapshot().state, 'recovery_required');
  assert.equal(controller.snapshot().lastError.code, 'RECOVERY_TIMEOUT');
  assert.equal(device.events.some((event) => event.kind === 'recovery' && event.data.confirmed), false);
});

function tempDirectory(t) {
  const path = mkdtempSync(join(tmpdir(), 'sport-world-journal-test-'));
  t.after(() => {
    assert.ok(resolve(path).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(path).startsWith('sport-world-journal-test-'));
    rmSync(path, { recursive: true });
  });
  return path;
}
const event = (kind, data) => ({ kind, epochMs: 1800000000000, sessionId: 'synthetic-session', targetId: 'synthetic-phone', data });

test('journal_serializes_private_jsonl_and_snapshots_input', async (t) => {
  const file = join(tempDirectory(t), 'nested', 'events.jsonl');
  const journal = createJournal(file);
  const input = event('expected', { sample: { latitude: 0, longitude: 0.001 } });
  const first = journal.append(input);
  input.data.sample.latitude = 90;
  await Promise.all([first, journal.append(event('observed', { source: null, isMock: null }))]);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.kind), ['expected', 'observed']);
  assert.equal(rows[0].data.sample.latitude, 0);
  assert.equal(rows[1].data.isMock, null);
});

test('journal_redacts_nested_credentials_and_private_key_text', async (t) => {
  const file = join(tempDirectory(t), 'events.jsonl');
  const journal = createJournal(file);
  await journal.append(event('error', { password: 'no-pass', nested: { accessToken: 'no-token', signingProfile: 'no-profile' },
    error: 'password=no-inline token=no-inline-token', pem: '-----BEGIN PRIVATE KEY-----\nno-private-key\n-----END PRIVATE KEY-----' }));
  const text = readFileSync(file, 'utf8');
  for (const secret of ['no-pass', 'no-token', 'no-profile', 'no-inline', 'no-private-key']) assert.equal(text.includes(secret), false);
  assert.match(text, /REDACTED/);
});

test('journal_redacts_credentials_inside_native_json_error_text', async (t) => {
  const file = join(tempDirectory(t), 'events.jsonl');
  await createJournal(file).append(event('error', { message: 'native {"password":"encoded-pass","token":"encoded-token"}' }));
  const text = readFileSync(file, 'utf8');
  assert.equal(text.includes('encoded-pass'), false);
  assert.equal(text.includes('encoded-token'), false);
});

test('journal_redacts_credential_aliases_inside_native_error_text', async (t) => {
  const file = join(tempDirectory(t), 'events.jsonl');
  const secrets = { accessToken: 'alias-access', signingProfile: 'alias-profile', refresh_token: 'alias-refresh',
    privateKey: 'alias-key', clientSecret: 'alias-client', keystorePassword: 'alias-store', credentials: 'alias-credentials' };
  await createJournal(file).append(event('error', { message: 'native ' + JSON.stringify(secrets) }));
  const text = readFileSync(file, 'utf8');
  for (const secret of Object.values(secrets)) assert.equal(text.includes(secret), false, secret);
});

test('journal_io_failure_rejects_and_does_not_poison_next_write', async (t) => {
  const blocked = join(tempDirectory(t), 'parent'); writeFileSync(blocked, 'owned blocking file');
  const journal = createJournal(join(blocked, 'events.jsonl'));
  await assert.rejects(() => journal.append(event('expected', {})));
  unlinkSync(blocked);
  await journal.append(event('recovered-writer', {}));
  assert.equal(JSON.parse(readFileSync(join(blocked, 'events.jsonl'), 'utf8')).kind, 'recovered-writer');
});
