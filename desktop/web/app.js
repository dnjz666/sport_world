const $ = (id) => document.getElementById(id);
const names = {
  disconnected: '等待配置', unknown: '能力未确认', unsupported: '能力不支持', ready: '准备就绪',
  running: '运行中', paused: '已暂停', stopping: '正在清理', stopped: '恢复已确认', recovery_required: '恢复待确认'
};
const notes = {
  unknown: '定位能力尚未确认。请核对本机能力报告及设备，再应用配置。',
  disconnected: '选择 USB 设备并应用路线配置。',
  ready: '配置已就绪。开始后先关闭残留模拟并采集稳定正常基线。',
  running: '按经过时间输出轨迹。请保持 USB 连接及独立读取应用前台。',
  paused: '保持最后位置，不累计行进时间。', stopping: '正在关闭模拟并清理本会话文件，请等待。',
  stopped: '已取得符合原基线判据的新独立样本。再次运行前请应用配置。',
  recovery_required: '定位恢复尚未确认。请保持独立读取；断线重连后点击停止重试。'
};
let state = { state: 'unknown', sessionId: null };
let configured = false;
let configuredSessionId = null;
let busy = false;
let connected = true;
let errorOrigin = null;

function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function clearError() { $('error').hidden = true; errorOrigin = null; }
function showError(error, origin = 'local') {
  $('error').textContent = `${error.message}${error.code ? `（${error.code}）` : ''}`;
  $('error').hidden = false; errorOrigin = origin;
}
async function api(path, command, sessionId = state.sessionId) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId && command?.type !== 'stop') headers['X-Session-Id'] = sessionId;
  const response = await fetch(path, command === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(command) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message), { code: data.code });
  return data;
}
function meters(a, b) {
  const rad = Math.PI / 180;
  const x = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 12742017.6 * Math.atan2(Math.sqrt(Math.max(0, Math.min(1, x))), Math.sqrt(Math.max(0, 1 - x)));
}
function validateRoute(value) {
  if (!value || value.schemaVersion !== 1 || value.coordinateSystem !== 'WGS-84' || !Array.isArray(value.points) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('需要带名称、schemaVersion=1 的 WGS-84 路线 JSON。');
  }
  const points = value.points.map((point, index) => {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
      throw new Error(`第 ${index + 1} 个路线点需要有效的纬度、经度。`);
    }
    return { latitude: point.latitude, longitude: point.longitude };
  });
  const key = (point) => `${point.latitude},${Math.abs(point.latitude) === 90 ? 0 : point.longitude === 180 ? -180 : point.longitude}`;
  if (new Set(points.map(key)).size < 3) throw new Error('请填写至少三个不同的路线点。');
  if (key(points[0]) === key(points.at(-1))) points.pop();
  const lengths = points.map((point, index) => meters(point, points[(index + 1) % points.length]));
  if (lengths.some((length) => length <= 0 || length > 500)) throw new Error('请移除相邻重复点，并将每一段（含闭合连接）控制在 500 米内。');
  return { route: { schemaVersion: 1, name: value.name.trim(), coordinateSystem: 'WGS-84', points }, length: lengths.reduce((sum, length) => sum + length, 0) };
}
function readRoute() {
  const name = $('route-name').value.trim();
  if (!name) throw new Error('请填写路线名称。');
  const points = $('points').value.trim().split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    const fields = line.trim().split(/[,，\s]+/);
    if (fields.length !== 2 || fields.some((field) => !field)) throw new Error(`第 ${index + 1} 行需要完整的纬度、经度。`);
    return { latitude: Number(fields[0]), longitude: Number(fields[1]) };
  });
  return validateRoute({ schemaVersion: 1, name, coordinateSystem: 'WGS-84', points }).route;
}
function settings() {
  const result = { paceSecPerKm: Number($('pace').value), laps: Number($('laps').value), direction: $('direction').value, sampleIntervalMs: 1000 };
  if (!Number.isFinite(result.paceSecPerKm) || result.paceSecPerKm <= 0 || !Number.isSafeInteger(result.laps) || result.laps <= 0) {
    throw new Error('配速必须大于零，圈数必须为正整数。');
  }
  return result;
}
function preview(value = readRoute()) {
  const { route, length } = validateRoute(value);
  const config = settings();
  if (!Number.isFinite(length * config.laps * config.paceSecPerKm)) throw new Error('路线或运行参数过大，请减小数值。');
  const points = route.points;
  const anchor = points[0]; const cos = Math.cos(anchor.latitude * Math.PI / 180);
  const projected = points.map((point) => [((point.longitude - anchor.longitude + 540) % 360 - 180) * cos, -(point.latitude - anchor.latitude)]);
  const xs = projected.map((point) => point[0]), ys = projected.map((point) => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), rangeX = Math.max(...xs) - minX, rangeY = Math.max(...ys) - minY;
  const scale = Math.min(600 / (rangeX || 1e-9), 200 / (rangeY || 1e-9));
  const coords = projected.map(([x, y]) => [360 + (x - minX - rangeX / 2) * scale, 150 + (y - minY - rangeY / 2) * scale]);
  const svg = $('route-preview'); svg.replaceChildren();
  const make = (tag, attributes) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    svg.append(element); return element;
  };
  make('polygon', { points: coords.map((point) => point.join(',')).join(' '), class: 'track-shape' });
  coords.forEach(([x, y], index) => {
    make('circle', { cx: x, cy: y, r: index === 0 ? 7 : 4, class: index === 0 ? 'start-point' : 'track-point' });
    const label = make('text', { x: x + 12, y: y - 10, class: 'point-label' });
    label.textContent = index === 0 ? '起点 / 终点' : String(index + 1);
  });
  $('route-empty').hidden = true;
  $('route-length').textContent = `${length.toFixed(1)} m`;
  $('total-length').textContent = `${(length * config.laps).toFixed(1)} m`;
  $('estimated-time').textContent = duration(length * config.laps * config.paceSecPerKm);
  $('point-count').textContent = `${points.length} 个`;
  return route;
}
function line(container, text, className = '') {
  const node = document.createElement('p'); node.textContent = text;
  if (className) node.className = className;
  container.append(node);
}
function position(id, sample, extra) {
  const container = $(id); container.replaceChildren();
  if (!sample) { line(container, id === 'observed' ? '等待独立应用回调' : '等待轨迹样本', 'muted'); return; }
  line(container, `${sample.latitude.toFixed(7)}, ${sample.longitude.toFixed(7)}`, 'coordinates');
  line(container, new Date(sample.epochMs).toLocaleTimeString('zh-CN', { hour12: false }) + (sample.sequence ? ` · #${sample.sequence}` : ''), 'muted');
  line(container, extra, 'position-detail');
}
function render() {
  if (configured && configuredSessionId !== state.sessionId) {
    configured = false; $('config-note').textContent = '会话已在其他页面更改，请重新应用配置。';
  }
  if (configured && state.state === 'stopped') {
    configured = false; $('config-note').textContent = '本次会话已结束，再次运行前请重新应用配置。';
  }
  const active = ['running', 'paused', 'stopping', 'recovery_required'].includes(state.state);
  $('state').textContent = connected ? names[state.state] ?? state.state : '服务未连接';
  $('state').dataset.state = connected ? state.state : 'unknown';
  $('configuration-fields').disabled = active || busy;
  $('start').disabled = !connected || !configured || busy || state.state !== 'ready';
  $('pause').disabled = !connected || busy || state.state !== 'running';
  $('resume').disabled = !connected || busy || state.state !== 'paused';
  $('stop').disabled = !state.sessionId || state.state === 'stopped' || state.state === 'stopping';
  $('elapsed').textContent = duration(state.elapsedMs ?? 0);
  $('distance').textContent = `${(state.distanceM ?? 0).toFixed(1)} m`;
  $('lap').textContent = state.lap ? `第 ${state.lap} 圈` : '—';
  $('session-id').textContent = state.sessionId ?? '尚未建立';
  $('state-note').textContent = !connected ? '无法取得当前会话状态。请检查本地服务；显示的位置和进度来自最后一次读取。' :
    busy && !active ? '正在检查设备或采集基线；可点击停止取消开始。' : notes[state.state] ?? '请检查能力状态。';
  position('expected', state.expected, state.expected ? `速度 ${state.expected.speedMps.toFixed(2)} m/s · 方向 ${state.expected.bearingDeg.toFixed(0)}°` : '');
  position('sent', state.sent?.sample, state.sent ? (state.sent.receipt.accepted ? '工具已接受提交' : `提交失败：${state.sent.receipt.errorCode}`) : '');
  position('observed', state.observed, state.observed ? `精度 ${state.observed.accuracyM === null ? '未知' : state.observed.accuracyM.toFixed(1) + ' m'} · 来源 ${state.observed.source ?? '未知'} · 模拟标记 ${state.observed.isMock === null ? '未知' : String(state.observed.isMock)}` : '');
  $('recovery-result').textContent = !connected ? '本地服务未连接，当前恢复状态无法确认。' : state.state === 'stopped' ? '已确认：清理完成，三个新独立样本满足原基线及时间判据。' :
    state.state === 'recovery_required' || state.state === 'stopping' ? `${notes[state.state]} ${state.lastError?.message ?? ''}` : '尚未进行停止恢复核对。';
  if (connected && state.lastError && state.lastError.code !== 'RECOVERY_PENDING') showError(state.lastError, 'session');
  else if (errorOrigin === 'session') clearError();
}
async function targets() {
  try {
    const data = await api('/api/targets'); const selected = $('target').value;
    $('target').replaceChildren(new Option('请选择设备', ''));
    for (const target of data.targets) $('target').append(new Option(target, target));
    if (selected && !data.targets.includes(selected)) $('target').append(new Option(`${selected} · 已断开`, selected));
    $('target').value = selected;
    $('device-note').textContent = data.targets.length ? '仅列出已连接 USB；请明确选择。' : '未检测到 USB 设备，请检查连接与 HDC。';
  } catch (error) { showError(error); $('device-note').textContent = '设备查询失败，检查 HDC 路径与连接后刷新。'; }
}
async function command(type) {
  if (busy && type !== 'stop') return;
  if (type === 'start' && (!configured || configuredSessionId !== state.sessionId)) {
    showError(new Error('请重新应用当前路线配置。')); return;
  }
  const sessionId = type === 'start' ? configuredSessionId : state.sessionId;
  busy = true; clearError(); render();
  try { state = await api('/api/session', { type }, sessionId); }
  catch (error) { showError(error); }
  finally { busy = false; render(); }
}
$('config-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  try {
    const route = preview();
    if (!$('target').value) throw new Error('请先选择 USB 设备。');
    busy = true; configured = false; clearError(); render();
    state = await api('/api/session', { type: 'configure', targetId: $('target').value, mode: 'usb', route, settings: settings() });
    configured = true; configuredSessionId = state.sessionId;
    $('config-note').textContent = state.state === 'ready' ? '配置已应用，可开始运行。' : '配置已应用，但能力未确认，暂不能开始。';
  } catch (error) { configured = false; showError(error); }
  finally { busy = false; render(); }
});
for (const type of ['start', 'pause', 'resume', 'stop']) $(type).addEventListener('click', () => command(type));
$('refresh-targets').addEventListener('click', () => targets());
$('preview-route').addEventListener('click', () => {
  try { preview(); clearError(); } catch (error) { showError(error); }
});
$('configuration-fields').addEventListener('input', () => {
  configured = false; $('config-note').textContent = '配置已修改，请重新应用。'; render();
});
$('route-file').addEventListener('change', async () => {
  const file = $('route-file').files[0]; if (!file) return;
  try {
    if (file.size > 262144) throw new Error('路线文件超过 256 KiB。');
    const { route } = validateRoute(JSON.parse(await file.text()));
    // Render and validate before replacing the user's editable inputs.
    preview(route);
    $('route-name').value = route.name;
    $('points').value = route.points.map((point) => `${point.latitude}, ${point.longitude}`).join('\n');
    configured = false; $('config-note').textContent = '路线已导入，请应用配置。'; clearError();
  } catch (error) { showError(new Error(`导入失败：${error.message}`)); }
  finally { $('route-file').value = ''; render(); }
});
async function poll() {
  try {
    state = await api('/api/state'); connected = true;
    if (errorOrigin === 'connection') clearError();
    render();
  } catch (error) {
    connected = false; configured = false; render();
    showError(new Error(`无法连接本地服务：${error.message}`), 'connection');
  } finally { setTimeout(poll, 750); }
}
void targets(); void poll(); setInterval(targets, 5000);
