import { SessionController } from '../../dist/core/session.js';
import { createReplay } from '../../dist/core/replay.js';
import { HdcClient } from '../../dist/hdc/client.js';
import { readFileSync } from 'node:fs';

export function controlFixture({ verified = true } = {}) {
  const device = { connected: true, stopAccepted: true, phoneTime: Date.now(), samples: [],
    observed: { latitude: 0.01, longitude: 0.01 }, events: [] };
  const clock = { monotonicMs: () => performance.now(), epochMs: () => Date.now() };
  const hdc = new HdcClient({ executable: 'synthetic-hdc', run: async (_exe, args) => {
    let stdout;
    if (args.slice(2).join(' ') === 'list targets -v') stdout = device.connected ? 'synthetic-phone USB Connected local hdc' : '[Empty]';
    else if (args.slice(-3).join(' ') === 'shell date +%s') stdout = String(Math.floor(device.phoneTime / 1000));
    else if (args.at(-1) === 'const.product.software.version') stdout = 'synthetic-build';
    else throw new Error('Unexpected synthetic native command');
    return { exitCode: 0, stdout, stderr: '' };
  } });
  let sessionId;
  const controller = new SessionController({ replayFactory: createReplay, hdc, clock,
    capabilities: { canInject: verified, executionHost: verified ? 'desktop' : 'none', verifiedStandalone: false,
      targetId: 'synthetic-phone', systemBuild: 'synthetic-build', expiresAtMs: null, proofPath: 'synthetic-proof' },
    journal: { append: async (event) => { device.events.push(structuredClone(event)); } },
    observer: { latest: async () => {
      device.phoneTime += 1000;
      return { ...device.observed, epochMs: device.phoneTime, receivedAtMs: device.phoneTime, accuracyM: 5, source: null, isMock: null };
    } },
    executor: {
      prepare: async (context) => { sessionId = context.sessionId; },
      send: async (sample) => { device.samples.push(structuredClone(sample)); return { sessionId, sequence: sample.sequence, accepted: true, errorCode: null }; },
      stop: async () => ({ accepted: device.connected && device.stopAccepted,
        errorCode: !device.connected ? 'synthetic USB disconnected' : device.stopAccepted ? null : 'synthetic native error 201' })
    }
  });
  const command = { type: 'configure', targetId: 'synthetic-phone', mode: 'usb',
    route: JSON.parse(readFileSync(new URL('../fixtures/track.json', import.meta.url), 'utf8')),
    settings: { paceSecPerKm: 300, laps: 2, direction: 'forward', sampleIntervalMs: 1000 } };
  return { controller, hdc, command, device };
}

export async function waitFor(predicate, timeoutMs = 4000) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error('Expected state was not reached before timeout');
}
