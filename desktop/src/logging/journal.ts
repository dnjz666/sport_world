import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface JournalEvent { kind: string; epochMs: number; sessionId: string; targetId: string; data: Record<string, unknown> }
export interface Journal { append(event: JournalEvent): Promise<void> }

const credentialKey = 'password|passwd|secret|token|private.?key|signing|profile|credential|keystore';
const sensitiveKey = new RegExp(credentialKey, 'i');
const credentialAssignment = new RegExp(String.raw`\b([\w.-]*(?:${credentialKey})[\w.-]*)(["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}]+)`, 'gi');

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(credentialAssignment, '$1$2[REDACTED]');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('日志不能包含非有限数值');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('日志数据不能循环引用');
  seen.add(value);
  const copy = Array.isArray(value) ? value.map((item) => redact(item, seen)) : Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key)
      ? '[REDACTED]' : redact(item, seen)]));
  seen.delete(value);
  return copy;
}

export function createJournal(path: string): Journal {
  const absolute = resolve(path);
  let queue: Promise<void> = Promise.resolve();
  return { append(event): Promise<void> {
    let line: string;
    try {
      if (!event || typeof event.kind !== 'string' || !event.kind || !Number.isFinite(event.epochMs) ||
        typeof event.sessionId !== 'string' || !event.sessionId || typeof event.targetId !== 'string' || !event.targetId) {
        throw new Error('日志事件缺少有效的类型、时间、会话或设备标识');
      }
      line = JSON.stringify(redact({ kind: event.kind, epochMs: event.epochMs, sessionId: event.sessionId,
        targetId: event.targetId, data: event.data })) + '\n';
    } catch (error) { return Promise.reject(error); }
    const pending = queue.then(async () => {
      await mkdir(dirname(absolute), { recursive: true });
      await appendFile(absolute, line, { encoding: 'utf8', mode: 0o600 });
    });
    queue = pending.catch(() => {});
    return pending;
  } };
}
