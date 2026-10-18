import test from 'node:test';
import assert from 'node:assert/strict';
import { HdcClient } from '../dist/hdc/client.js';
import { runProcess } from '../dist/hdc/process.js';

const result = (stdout, exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const listing = 'phone-a\tUSB\tConnected\tlocalhost\thdc\r\nphone-b USB Connected localhost hdc\r\nCOM3 UART Ready unknown hdc\r\nphone-c USB Unauthorized localhost hdc\r\n127.0.0.1:1234 TCP Connected localhost hdc\r\n';
const clientWith = (output) => new HdcClient({ executable: 'hdc.exe', run: async () => output });

test('empty_targets_returns_empty', async () => {
  const client = clientWith(result('[Empty]\r\n'));
  assert.deepEqual(await client.listTargets(), []);
});

test('only_connected_usb_targets_are_selectable', async () => {
  assert.deepEqual(await clientWith(result(listing)).listTargets(), ['phone-a', 'phone-b']);
});

test('explicit_target_required', async () => {
  const client = clientWith(result(listing));
  for (const target of ['', undefined, 'missing', 'COM3', 'phone-c', '127.0.0.1:1234']) {
    await assert.rejects(() => client.requireTarget(target));
  }
  await client.requireTarget('phone-b');
});

test('disappearing_target_never_falls_back_to_another_phone', async () => {
  let output = listing;
  const client = new HdcClient({ executable: 'hdc.exe', run: async () => result(output) });
  await client.requireTarget('phone-b');
  output = 'phone-a USB Connected localhost hdc\n';
  await assert.rejects(() => client.requireTarget('phone-b'));
});

test('verbose_listing_uses_the_verified_hdc_server', async () => {
  let call;
  const client = new HdcClient({ executable: 'C:/tools with spaces/hdc.exe', run: async (...args) => {
    call = args; return result('[Empty]');
  } });
  await client.listTargets();
  assert.equal(call[0], 'C:/tools with spaces/hdc.exe');
  assert.deepEqual(call[1], ['-s', '127.0.0.1:8710', 'list', 'targets', '-v']);
});

test('failed_or_unrecognized_listing_is_not_an_empty_success', async () => {
  for (const output of [result('', 3, 'connection error'), result('[Fail] server not available'), result('unexpected response')]) {
    await assert.rejects(() => clientWith(output).listTargets());
  }
});

test('arguments_are_not_shell_text', { timeout: 5000 }, async () => {
  const args = ['-t', 'phone & echo INJECTED', 'a;b', '$(echo bad)', '%COMSPEC%', 'a"b', 'path with spaces'];
  const output = await runProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args], {});
  assert.equal(output.exitCode, 0); assert.deepEqual(JSON.parse(output.stdout), args); assert.equal(output.stderr, '');
});

test('process_preserves_both_streams_and_nonzero_exit', { timeout: 5000 }, async () => {
  const output = await runProcess(process.execPath, ['-e', 'process.stdout.write("out");process.stderr.write("err");process.exitCode=7'], {});
  assert.deepEqual(output, { exitCode: 7, stdout: 'out', stderr: 'err' });
});

test('missing_executable_rejects', async () => {
  await assert.rejects(() => runProcess('nonexistent-m0-hdc-918247.exe', [], {}), { code: 'ENOENT' });
});

test('abort_stops_the_child', { timeout: 5000 }, async () => {
  const abort = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal });
  abort.abort(); await assert.rejects(() => running, { name: 'AbortError' });
});

test('target_command_rechecks_usb_and_keeps_explicit_target_argument', async () => {
  const calls = [];
  let connected = true;
  const client = new HdcClient({ executable: 'hdc.exe', run: async (_exe, args) => {
    calls.push([...args]);
    return args[2] === 'list' ? result(connected ? listing : 'phone-a USB Connected localhost hdc') : result('native out', 9, 'native err');
  } });
  assert.deepEqual(await client.runTarget('phone-b', ['shell', 'testhelper', 'help']), result('native out', 9, 'native err'));
  assert.deepEqual(calls[1], ['-s', '127.0.0.1:8710', '-t', 'phone-b', 'shell', 'testhelper', 'help']);
  connected = false;
  await assert.rejects(() => client.runTarget('phone-b', ['shell', 'testhelper', 'help']));
  assert.equal(calls.length, 3);
});

test('target_command_rejects_interactive_or_option_override_calls', async () => {
  const client = clientWith(result(listing));
  for (const args of [[], ['shell'], ['-t', 'phone-a'], ['shell', 'bad\ncommand']]) {
    await assert.rejects(() => client.runTarget('phone-b', args));
  }
});

test('target_command_abort_also_cancels_the_preflight_usb_query', async () => {
  const abort = new AbortController();
  let release;
  const client = new HdcClient({ executable: 'hdc.exe', run: async (_exe, args, options) => {
    if (args[2] !== 'list') return result('native command must not run');
    return new Promise((resolve, reject) => {
      release = () => resolve(result(listing));
      options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    });
  } });
  const running = client.runTarget('phone-b', ['shell', 'testhelper', 'help'], { signal: abort.signal })
    .then(() => 'resolved', (error) => error.name);
  abort.abort();
  try {
    const outcome = await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve('still pending'), 30))]);
    assert.equal(outcome, 'AbortError');
  } finally { release(); await running; }
});
