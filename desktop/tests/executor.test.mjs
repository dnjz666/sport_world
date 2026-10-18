import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { HdcClient } from '../dist/hdc/client.js';
import { capabilitiesFromReport } from '../dist/probe/capabilities.js';
import { createVerifiedExecutor } from '../dist/executor/verified-executor.js';
import { createPositionObserver } from '../dist/executor/observer.js';

const output = (stdout = '', exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const sample = { sequence: 1, latitude: 0, longitude: 0.001, elapsedMs: 30000,
  epochMs: 1800000000000, speedMps: 1000 / 300, bearingDeg: 90 };
const context = { sessionId: 'synthetic-session', targetId: 'phone-a', mode: 'usb' };

function fixture(t, capOverrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sport-world-executor-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(directory).startsWith('sport-world-executor-test-'));
    rmSync(directory, { recursive: true });
  });
  const proofPath = join(directory, 'proof.json');
  const evidence = join(directory, 'evidence.txt');
  writeFileSync(evidence, 'Synthetic capability proof; no real device.');
  const report = { status: 'passed', targetId: 'phone-a', systemBuild: 'synthetic-build',
    targetApp: { bundleName: 'synthetic.target', version: '1' }, executionHost: 'desktop',
    g0: true, g1: true, g2: true, verifiedStandalone: false, expiresAtMs: Date.now() + 60000,
    evidencePaths: [evidence], reason: 'Synthetic test fixture' };
  writeFileSync(proofPath, JSON.stringify(report));
  const caps = { ...capabilitiesFromReport(report, { targetId: 'phone-a', systemBuild: 'synthetic-build',
    nowMs: Date.now(), proofPath }), ...capOverrides };
  const device = { connected: true, systemBuild: 'synthetic-build', files: new Map(), calls: [],
    phoneMs: Math.floor(Date.now() / 1000) * 1000, pid: '4242', logs: '', mockEnabled: false,
    setResult: output('Set mocked locations successfully.'), disableResult: output('Disable location mock successfully.'),
    corruptTransfer: false, beforeSet: async () => {}, beforeMkdir: async () => {}, beforeList: async () => {},
    hashResult: null, removeFailureOnce: false };
  const hdc = new HdcClient({ executable: 'synthetic-hdc.exe', run: async (_exe, args) => {
    device.calls.push([...args]);
    if (args[2] === 'list') {
      await device.beforeList();
      return output(device.connected ? 'phone-a USB Connected localhost hdc\nphone-b USB Connected localhost hdc' : 'phone-b USB Connected localhost hdc');
    }
    assert.deepEqual(args.slice(0, 4), ['-s', '127.0.0.1:8710', '-t', 'phone-a']);
    const command = args.slice(4);
    if (command.join(' ') === 'shell param get const.product.software.version') return output(device.systemBuild + '\n');
    if (command.join(' ') === 'shell date +%s') return output(String(device.phoneMs / 1000));
    if (command.join(' ') === 'shell pidof com.example.m0locationreader') return output(device.pid);
    if (command[1] === 'hilog') {
      assert.deepEqual(command, ['shell', 'hilog', '-x', '-T', 'M0Reader', '-P', device.pid]);
      return output(device.logs);
    }
    if (command[1] === 'mkdir') { await device.beforeMkdir(); return output(); }
    if (command[0] === 'file') {
      assert.deepEqual(command.slice(0, 2), ['file', 'send']);
      const content = readFileSync(command[2], 'utf8');
      device.files.set(command[3], device.corruptTransfer ? content + 'corrupted' : content);
      return output('FileTransfer finish, Size:1');
    }
    if (command[1] === 'sha256sum') {
      const paths = command.slice(2);
      const normal = paths.map((path) => { const content = device.files.get(path);
        return content === undefined ? 'sha256sum: ' + path + ': No such file or directory' : sha(content) + '  ' + path; }).join('\n') + '\n';
      return device.hashResult ? device.hashResult(paths, normal) : output(normal);
    }
    if (command[1] === 'rm') {
      if (device.removeFailureOnce) { device.removeFailureOnce = false; device.files.delete(command[2]); return output('rm failed: native error 201'); }
      for (const path of command.slice(2)) device.files.delete(path);
      return output();
    }
    if (command[1] === 'rmdir') return output();
    if (command[1] === 'testhelper') {
      if (command[2] === 'enable-location-mock') { device.mockEnabled = true; return output('Enable location mock successfully.'); }
      if (command[2] === 'disable-location-mock') { device.mockEnabled = false; return device.disableResult; }
      if (command[2] === 'set-mocked-locations') {
        assert.ok(device.files.has(command[3]));
        assert.equal(command[4], '1');
        await device.beforeSet();
        return device.setResult;
      }
    }
    throw new Error('Unexpected native command: ' + JSON.stringify(command));
  } });
  const observer = createPositionObserver(hdc, 'phone-a');
  const executor = createVerifiedExecutor(caps, hdc, observer);
  t.after(async () => {
    device.connected = true;
    device.beforeList = async () => {};
    device.disableResult = output('Disable location mock successfully.');
    await executor.stop();
  });
  return { caps, report, proofPath, device, observer, executor, hdc };
}

const writes = (device) => device.calls.filter((args) => args.includes('enable-location-mock') || args.includes('set-mocked-locations'));
function observed(device, changes = {}) {
  return { latitude: 1, longitude: 2, epochMs: device.phoneMs, receivedAtMs: device.phoneMs,
    accuracyM: 5, source: null, isMock: null, ...changes };
}
const log = (value) => '10-17 12:00:00.000 4242 4242 I A00000/M0Reader: ' + JSON.stringify(value);

test('unverified_executor_refuses_prepare', async (t) => {
  for (const overrides of [{ canInject: false }, { executionHost: 'none' }, { proofPath: 'missing-proof.json' }]) {
    const { executor, device } = fixture(t, overrides);
    await assert.rejects(() => executor.prepare(context), /能力|证据/);
    assert.equal(writes(device).length, 0);
  }
});

test('target_change_refused', async (t) => {
  const { executor, device } = fixture(t);
  await assert.rejects(() => executor.prepare({ ...context, targetId: 'phone-b' }), /目标/);
  assert.equal(writes(device).length, 0);
  await executor.prepare(context);
  device.connected = false;
  const receipt = await executor.send(sample);
  assert.equal(receipt.accepted, false);
  assert.match(receipt.errorCode, /USB|连接/);
  assert.equal(device.calls.some((args) => args[3] === 'phone-b'), false);
});

test('expired_authorization_refused', async (t) => {
  const initialTime = Date.now();
  t.mock.method(Date, 'now', () => initialTime);
  const { executor, device } = fixture(t, { expiresAtMs: initialTime - 1 });
  await assert.rejects(() => executor.prepare(context), /过期/);
  assert.equal(writes(device).length, 0);
});

test('expiration_after_prepare_stops_send_but_allows_disable', async (t) => {
  const initialTime = Date.now();
  t.mock.method(Date, 'now', () => initialTime);
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  t.mock.method(Date, 'now', () => initialTime + 120000);
  const receipt = await executor.send(sample);
  assert.equal(receipt.accepted, false);
  assert.match(receipt.errorCode, /过期/);
  assert.equal(device.calls.some((args) => args.includes('set-mocked-locations')), false);
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.mockEnabled, false);
});

test('authorization_expiring_during_prepare_is_not_enabled', async (t) => {
  let currentTime = Date.now();
  t.mock.method(Date, 'now', () => currentTime);
  const { executor, device } = fixture(t);
  device.beforeMkdir = async () => { currentTime += 120000; };
  try {
    await assert.rejects(() => executor.prepare(context), /过期/);
    assert.equal(writes(device).length, 0);
  } finally { await executor.stop(); }
});

test('authorization_expiring_in_enable_usb_check_is_not_dispatched', async (t) => {
  let currentTime = Date.now();
  t.mock.method(Date, 'now', () => currentTime);
  const { executor, device } = fixture(t);
  device.beforeList = async () => {
    if (device.calls.some((args) => args.includes('mkdir'))) currentTime += 120000;
  };
  try {
    await assert.rejects(() => executor.prepare(context), /过期/);
    assert.equal(writes(device).length, 0);
  } finally { await executor.stop(); }
});

test('authorization_expiring_in_send_usb_check_is_not_dispatched', async (t) => {
  let currentTime = Date.now();
  t.mock.method(Date, 'now', () => currentTime);
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  device.beforeList = async () => {
    if (device.calls.some((args) => args.includes('sha256sum'))) currentTime += 120000;
  };
  try {
    const receipt = await executor.send(sample);
    assert.equal(receipt.accepted, false);
    assert.match(receipt.errorCode, /过期/);
    assert.equal(device.calls.some((args) => args.includes('set-mocked-locations')), false);
  } finally { assert.equal((await executor.stop()).accepted, true); }
});

test('injection_error_preserved', async (t) => {
  for (const failure of [output('error code: 201 Permission denied'), output('native out', 7, 'native error 801')]) {
    const { executor, device } = fixture(t);
    await executor.prepare(context);
    device.setResult = failure;
    const receipt = await executor.send(sample);
    assert.equal(receipt.accepted, false);
    assert.match(receipt.errorCode, /201|801/);
    if (failure.exitCode === 7) { assert.match(receipt.errorCode, /7/); assert.match(receipt.errorCode, /native out/); }
    assert.equal((await executor.stop()).accepted, true);
  }
});

test('accepted_does_not_mean_observed', async (t) => {
  const { executor, device, observer } = fixture(t);
  await executor.prepare(context);
  const receipt = await executor.send(sample);
  assert.equal(receipt.accepted, true);
  assert.equal(await observer.latest(), null);
  assert.deepEqual(receipt, { sessionId: context.sessionId, sequence: 1, accepted: true, errorCode: null });
  const xml = [...device.files.values()][0];
  assert.match(xml, /<gpx[^>]*version="1.1"/);
  assert.match(xml, /<trkpt lat="0(?:\.0+)?" lon="0.001(?:0*)?">/);
  assert.match(xml, /<time>2027-01-15T08:00:00.000Z<\/time>/);
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.files.size, 0);
});

test('verified_executor_can_clear_before_prepare_and_reuse_only_after_cleanup', async (t) => {
  const { executor, device } = fixture(t);
  assert.equal((await executor.stop()).accepted, true);
  assert.ok(device.calls.some((args) => args.includes('disable-location-mock')));
  await executor.prepare(context);
  await executor.send(sample);
  await assert.rejects(() => executor.prepare({ ...context, sessionId: 'blocked-active' }));
  await executor.stop();
  await executor.prepare({ ...context, sessionId: 'synthetic-second-session' });
  const receipt = await executor.send(sample);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.sessionId, 'synthetic-second-session');
  const directories = device.calls.filter((args) => args.includes('mkdir')).map((args) => args.at(-1));
  assert.equal(new Set(directories).size, 2);
  await executor.stop();
  assert.equal(device.files.size, 0);
});

test('a_new_preflight_stop_reissues_disable_instead_of_reusing_an_old_receipt', async (t) => {
  const { executor, device } = fixture(t);
  await executor.stop();
  const previous = device.calls.filter((args) => args.includes('disable-location-mock')).length;
  device.mockEnabled = true; // A later session cannot trust the previous session's cached receipt.
  await executor.stop();
  assert.equal(device.calls.filter((args) => args.includes('disable-location-mock')).length, previous + 1);
  assert.equal(device.mockEnabled, false);
});

test('wrong_build_and_standalone_rejected_before_enable', async (t) => {
  const { executor, device } = fixture(t);
  device.systemBuild = 'changed-build';
  await assert.rejects(() => executor.prepare(context), /构建/);
  await assert.rejects(() => executor.prepare({ ...context, mode: 'standalone' }), /USB|脱机/);
  assert.equal(writes(device).length, 0);
});

test('transfer_hash_mismatch_prevents_injection_and_preserves_unowned_content', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  device.corruptTransfer = true;
  const receipt = await executor.send(sample);
  assert.equal(receipt.accepted, false);
  assert.match(receipt.errorCode, /摘要|SHA/);
  assert.equal(device.calls.some((args) => args.includes('set-mocked-locations')), false);
  const stop = await executor.stop();
  assert.equal(stop.accepted, false);
  assert.equal(device.mockEnabled, false);
  assert.equal(device.files.size, 1);
});

test('cleanup_failure_is_preserved_and_retryable', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  await executor.send(sample);
  device.disableResult = output('Disable failed: error code 201');
  const failed = await executor.stop();
  assert.equal(failed.accepted, false);
  assert.match(failed.errorCode, /201/);
  assert.equal(device.files.size, 1);
  device.disableResult = output('Disable location mock successfully.');
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.files.size, 0);
});

test('large_session_stop_cleans_owned_files_with_bounded_native_roundtrips', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  for (let sequence = 1; sequence <= 80; sequence++) assert.equal((await executor.send({ ...sample, sequence })).accepted, true);
  const before = device.calls.length;
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.mockEnabled, false);
  assert.equal(device.files.size, 0);
  const native = device.calls.slice(before).filter((args) => args[4] === 'shell');
  assert.ok(native.length <= 16, `80-point cleanup used ${native.length} native roundtrips`);
  assert.equal(native[0][6], 'disable-location-mock');
});

test('batched_stop_preserves_changed_file_and_cleans_other_owned_files', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  for (let sequence = 1; sequence <= 20; sequence++) await executor.send({ ...sample, sequence });
  const [changed, original] = [...device.files][7]; device.files.set(changed, 'external replacement');
  const receipt = await executor.stop();
  assert.equal(receipt.accepted, false);
  assert.match(receipt.errorCode, /摘要/);
  assert.deepEqual([...device.files.keys()], [changed]);
  assert.equal(device.files.get(changed), 'external replacement');
  device.files.set(changed, original);
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.files.size, 0);
});

test('batched_stop_handles_absent_file_and_retries_partial_remove_failure', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  for (let sequence = 1; sequence <= 4; sequence++) await executor.send({ ...sample, sequence });
  device.files.delete([...device.files.keys()][1]);
  device.removeFailureOnce = true;
  assert.equal((await executor.stop()).accepted, false);
  assert.equal(device.mockEnabled, false);
  assert.equal((await executor.stop()).accepted, true);
  assert.equal(device.files.size, 0);
});

test('unrecognized_batch_hash_output_cannot_authorize_any_deletion', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  for (let sequence = 1; sequence <= 3; sequence++) await executor.send({ ...sample, sequence });
  const owned = new Map(device.files);
  device.hashResult = (_paths, normal) => output(normal + sha('unowned') + '  /data/local/tmp/unowned.gpx\n');
  const before = device.calls.length;
  assert.equal((await executor.stop()).accepted, false);
  assert.deepEqual(device.files, owned);
  assert.equal(device.calls.slice(before).some((args) => args[5] === 'rm'), false);
  device.hashResult = null;
  assert.equal((await executor.stop()).accepted, true);
});

test('stop_serializes_after_inflight_send_and_blocks_later_sends', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  device.beforeSet = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const sending = executor.send(sample);
  await started;
  const stopping = executor.stop();
  release();
  assert.equal((await sending).accepted, true);
  assert.equal((await stopping).accepted, true);
  await assert.rejects(() => executor.send({ ...sample, sequence: 2 }), /准备|停止/);
  const native = device.calls.filter((args) => args.includes('testhelper'));
  assert.equal(native.at(-1).includes('disable-location-mock'), true);
  assert.equal(device.files.size, 0);
});

test('invalid_samples_rejected_before_transfer', async (t) => {
  const { executor, device } = fixture(t);
  await executor.prepare(context);
  for (const change of [{ latitude: 91 }, { longitude: NaN }, { speedMps: -1 }, { bearingDeg: 360 },
    { elapsedMs: -1 }, { epochMs: Infinity }, { sequence: 0 }, { sequence: 1.5 }]) {
    const receipt = await executor.send({ ...sample, ...change });
    assert.equal(receipt.accepted, false);
    assert.match(receipt.errorCode, /样本/);
  }
  assert.equal(device.calls.some((args) => args[4] === 'file'), false);
  await executor.stop();
});

test('observer_filters_buffered_logs_and_preserves_unknown_markers', async (t) => {
  const { observer, device } = fixture(t);
  device.logs = log(observed(device));
  assert.equal(await observer.latest(), null);
  device.phoneMs += 2000;
  const current = observed(device);
  device.logs += '\n' + log(current);
  assert.deepEqual(await observer.latest(), current);
  device.phoneMs += 10000;
  assert.equal(await observer.latest(), null);
});

test('observer_resets_on_reader_restart_or_connection_loss', async (t) => {
  const { observer, device } = fixture(t);
  await observer.latest();
  device.phoneMs += 2000;
  device.logs = log(observed(device));
  assert.ok(await observer.latest());
  device.pid = '4243';
  assert.equal(await observer.latest(), null);
  device.phoneMs += 2000;
  device.logs = log(observed(device));
  assert.ok(await observer.latest());
  device.connected = false;
  await assert.rejects(() => observer.latest(), /USB|连接/);
  device.connected = true;
  assert.equal(await observer.latest(), null);
});

test('observer_rejects_malformed_or_nonfresh_callbacks', async (t) => {
  const { observer, device } = fixture(t);
  await observer.latest();
  device.phoneMs += 2000;
  const bad = [{ latitude: 91 }, { epochMs: device.phoneMs - 10000 }, { receivedAtMs: device.phoneMs + 2000 },
    { accuracyM: -1 }, { isMock: 'false' }, { source: 7 }];
  device.logs = ['M0Reader: {broken', 'M0ReaderStatus: ' + JSON.stringify(observed(device)),
    ...bad.map((change) => log(observed(device, change)))].join('\n');
  assert.equal(await observer.latest(), null);
  device.logs += '\n' + log(observed(device, { source: '1', isMock: true }));
  assert.deepEqual(await observer.latest(), observed(device, { source: '1', isMock: true }));
});
