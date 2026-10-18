// Manual, bounded USB acceptance. Never included in npm test.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HdcClient } from '../dist/hdc/client.js';
import { runProcess } from '../dist/hdc/process.js';
import { capabilitiesFromReport } from '../dist/probe/capabilities.js';
import { createVerifiedExecutor } from '../dist/executor/verified-executor.js';
import { createPositionObserver } from '../dist/executor/observer.js';
import { distanceMeters } from '../dist/core/geo.js';

if (!process.argv.includes('--run-device-check')) throw new Error('Explicit --run-device-check is required');
const recoveryOnly = process.argv.includes('--recovery-only');
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.cwd() !== root.replace(/[\\/]$/, '')) throw new Error('Run from the repository root');
const proofPath = join(root, 'docs/verification/m0-report.json');
const report = JSON.parse((await readFile(proofPath, 'utf8')).replace(/^\uFEFF/, ''));
const token = randomUUID().replaceAll('-', '');
const folder = join(root, 'local-data', 'task5-' + token);
await mkdir(folder, { recursive: true });
const save = (name, data) => writeFile(join(folder, name), JSON.stringify(data, null, 2) + '\n');
const hdc = new HdcClient({ executable: join(root, 'tools/hdc/hdc.exe'), run: async (exe, args, options) => {
  const id = randomUUID();
  await appendFile(join(folder, 'commands.jsonl'), JSON.stringify({ id, args, startedAtMs: Date.now() }) + '\n');
  const result = await runProcess(exe, args, { signal: options.signal ?? AbortSignal.timeout(15000) });
  await appendFile(join(folder, 'commands.jsonl'), JSON.stringify({ id, result, endedAtMs: Date.now() }) + '\n');
  return result;
} });
async function call(args) {
  const result = await hdc.runTarget(report.targetId, args, { signal: AbortSignal.timeout(15000) });
  if (result.exitCode || result.stderr.trim() || /\[Fail\]/i.test(result.stdout)) {
    throw new Error('Device command rejected: ' + result.stdout + ' ' + result.stderr);
  }
  return result.stdout.trim();
}
const sh = (...args) => call(['shell', ...args]);
const phoneMs = async () => {
  const text = await sh('date', '+%s');
  if (!/^\d+$/.test(text)) throw new Error('Device time unavailable');
  return Number(text) * 1000;
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uiDir = '/data/local/tmp/swtrack-ui-' + token;
const uiFiles = new Map();
let uiCreated = false;
let uiSequence = 0;
let lastTouch = 0;
const summary = { recordedAt: new Date().toISOString(), passed: false, targetIdRedacted: true,
  acceptanceScope: recoveryOnly ? 'separate-usb-stop-recovery' : 'two-fixed-points-and-recovery',
  systemBuild: report.systemBuild, readerBundleName: 'com.example.m0locationreader',
  mode: 'usb', verifiedStandalone: false, exerciseRecordStarted: false,
  criteria: { baselineSamples: 5, baselineSpreadM: 10, maxAccuracyM: 50, injectionErrorM: 5,
    minPointSeparationM: 100, minimumInjectedSamples: 5, settleMs: 5000,
    minimumRecoverySamples: 3, recoveryRadiusM: 50, maxTimestampDeltaMs: 5000,
    minimumDistanceFromMockM: 100 }, fixedPoints: [], recovery: { passed: false }, cleanup: {} };

async function uiNodes() {
  const remote = uiDir + '/ui-' + (++uiSequence) + '.json';
  await sh('uitest', 'dumpLayout', '-p', remote);
  const hash = (await sh('sha256sum', remote)).split(/\s/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('UI digest unavailable');
  uiFiles.set(remote, hash);
  await save('ui-files.json', Object.fromEntries(uiFiles));
  const local = join(folder, 'ui-' + uiSequence + '.json');
  await call(['file', 'recv', remote, local]);
  const bytes = await readFile(local);
  if (digest(bytes) !== hash) throw new Error('UI transfer digest mismatch');
  const nodes = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.attributes) nodes.push(value.attributes);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  }
  walk(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
  return nodes;
}
async function clickReader(text) {
  const nodes = await uiNodes();
  if (!nodes.some((node) => String(node.text).includes('M0 独立定位读取'))) throw new Error('Reader must be visible and unlocked');
  const matches = nodes.filter((node) => node.text === text && String(node.enabled).toLowerCase() !== 'false');
  if (matches.length !== 1) throw new Error('Reader control unavailable: ' + text);
  const bounds = String(matches[0].bounds).match(/-?\d+/g)?.map(Number);
  if (bounds?.length !== 4 || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('Invalid reader bounds');
  await sh('uitest', 'uiInput', 'click', String(Math.floor((bounds[0] + bounds[2]) / 2)), String(Math.floor((bounds[1] + bounds[3]) / 2)));
  lastTouch = Date.now();
}
async function keepAwake() { if (Date.now() - lastTouch > 7000) await clickReader('开始读取'); }
const observer = createPositionObserver(hdc, report.targetId);
async function observe(phase) {
  await keepAwake();
  const location = await observer.latest();
  if (location) await appendFile(join(folder, 'observations.jsonl'), JSON.stringify({ phase, location }) + '\n');
  return location;
}
const key = (value) => value.epochMs + ':' + value.receivedAtMs;
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
let executor;
let prepareAttempted = false;
let sequence = 0;
let baseline;
let points;
let stoppedPhoneMs;
let error;

try {
  await hdc.requireTarget(report.targetId);
  const build = await sh('param', 'get', 'const.product.software.version');
  if (build !== report.systemBuild) throw new Error('System build changed');
  summary.testhelperVersion = await sh('testhelper', '--version');
  const capabilities = capabilitiesFromReport(report, { targetId: report.targetId, systemBuild: build, nowMs: Date.now(), proofPath });
  if (!capabilities.canInject) throw new Error('Capability proof not available');
  const initialDisable = await sh('testhelper', 'disable-location-mock');
  if (initialDisable !== 'Disable location mock successfully.') throw new Error('Preflight mock disable not confirmed');
  summary.preflight = { mockDisableConfirmed: true, freshBaselineAfterDisable: true };
  await sh('mkdir', uiDir); uiCreated = true;
  await clickReader('开始读取');
  const baselineSamples = new Map();
  const baselineDeadline = Date.now() + 35000;
  while (Date.now() < baselineDeadline && baselineSamples.size < 5) {
    const location = await observe('baseline');
    if (location?.accuracyM !== null && location?.accuracyM >= 0 && location?.accuracyM <= 50) baselineSamples.set(key(location), location);
    await delay(1000);
  }
  if (baselineSamples.size < 5) throw new Error('Five fresh baseline callbacks unavailable');
  const base = [...baselineSamples.values()];
  baseline = { latitude: median(base.map((value) => value.latitude)), longitude: median(base.map((value) => value.longitude)) };
  const spread = Math.max(...base.map((value) => distanceMeters(value, baseline)));
  if (spread > 10) throw new Error('Baseline spread exceeds 10 m');
  summary.baseline = { samples: base.length, spreadM: spread };
  const sign = baseline.latitude > 89 ? -1 : 1;
  points = [0.005, 0.0062].map((offset) => ({ latitude: baseline.latitude + sign * offset, longitude: baseline.longitude }));
  const separationM = distanceMeters(points[0], points[1]);
  if (separationM < 100 || points.some((point) => distanceMeters(point, baseline) < 100)) throw new Error('Test points too close');
  summary.pointSeparationM = separationM;
  await save('criteria-before-injection.json', { criteria: summary.criteria, baseline, baselineSamples: base, points, separationM });
  console.log(JSON.stringify({ phase: 'baseline', samples: base.length, spreadM: spread }));
  executor = createVerifiedExecutor(capabilities, hdc, observer);
  try {
    prepareAttempted = true;
    await executor.prepare({ sessionId: 'task5-' + token, targetId: report.targetId, mode: 'usb' });
    for (const [index, point] of (recoveryOnly ? points.slice(0, 1) : points).entries()) {
      const startPhoneMs = await phoneMs();
      const phase = 'point-' + (index + 1);
      const samples = new Map();
      const deadline = Date.now() + 40000;
      let accepted = 0;
      while (Date.now() < deadline && samples.size < 5) {
        await keepAwake();
        const receipt = await executor.send({ sequence: ++sequence, ...point, epochMs: await phoneMs(), elapsedMs: 0, speedMps: 0, bearingDeg: 0 });
        await appendFile(join(folder, 'receipts.jsonl'), JSON.stringify(receipt) + '\n');
        if (!receipt.accepted) throw new Error(receipt.errorCode);
        accepted++;
        await delay(1200);
        const location = await observe(phase);
        if (location && location.epochMs >= startPhoneMs + 5000 && location.receivedAtMs >= startPhoneMs + 5000) samples.set(key(location), location);
      }
      const errors = [...samples.values()].map((value) => distanceMeters(value, point));
      const result = { phase, samples: samples.size, acceptedSubmissions: accepted,
        maxErrorM: errors.length ? Math.max(...errors) : null, passed: errors.length >= 5 && Math.max(...errors) <= 5 };
      summary.fixedPoints.push(result);
      console.log(JSON.stringify(result));
      if (!result.passed) throw new Error('Fixed point criterion not met: ' + phase);
    }
  } finally {
    if (prepareAttempted) {
      summary.cleanup.stopReceipt = await executor.stop();
      stoppedPhoneMs = await phoneMs();
      console.log(JSON.stringify({ phase: 'disable', ...summary.cleanup.stopReceipt }));
    }
  }
} catch (caught) { error = caught; summary.error = caught.message; }

// Even a failed injection still gets a normal-location recovery check after successful disable.
if (summary.cleanup.stopReceipt?.accepted && baseline && points) {
  const valid = new Map();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && valid.size < 3) {
    try {
      const location = await observe('recovery');
      if (location && location.epochMs >= stoppedPhoneMs + 1000 && location.receivedAtMs >= stoppedPhoneMs + 1000 &&
        location.accuracyM !== null && location.accuracyM <= 50 && distanceMeters(location, baseline) <= 50 &&
        points.every((point) => distanceMeters(location, point) >= 100)) valid.set(key(location), location);
    } catch (caught) { summary.recovery.error = caught.message; break; }
    await delay(1000);
  }
  const values = [...valid.values()];
  summary.recovery = { ...summary.recovery, passed: values.length >= 3, samples: values.length,
    maxDistanceFromBaselineM: values.length ? Math.max(...values.map((value) => distanceMeters(value, baseline))) : null,
    latestTimestampDeltaMs: values.length ? values.at(-1).receivedAtMs - values.at(-1).epochMs : null };
  console.log(JSON.stringify({ phase: 'recovery', ...summary.recovery }));
}
try { if (uiCreated) await clickReader('停止读取'); } catch (caught) { summary.cleanup.readerStopError = caught.message; }
const uiErrors = [];
for (const [path, hash] of uiFiles) {
  try {
    const current = await sh('sha256sum', path);
    if (current !== hash + '  ' + path) throw new Error('UI file changed; retained');
    const removed = await sh('rm', path);
    if (removed) throw new Error(removed);
  } catch (caught) { uiErrors.push(caught.message); }
}
if (uiCreated && !uiErrors.length) {
  const removed = await sh('rmdir', uiDir);
  if (removed) uiErrors.push(removed);
}
summary.cleanup.uiFiles = uiFiles.size;
summary.cleanup.uiErrors = uiErrors;
summary.passed = !error && summary.fixedPoints.length === (recoveryOnly ? 1 : 2) && summary.fixedPoints.every((result) => result.passed) &&
  summary.cleanup.stopReceipt?.accepted === true && summary.recovery.passed && !uiErrors.length;
await save('summary.json', summary);
console.log(JSON.stringify({ passed: summary.passed, evidenceFolder: folder, error: summary.error ?? null }));
if (!summary.passed) process.exitCode = 1;
