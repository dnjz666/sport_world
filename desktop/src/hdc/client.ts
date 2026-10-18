import type { runProcess } from './process.js';

export class HdcClient {
  private readonly executable: string;
  private readonly run: typeof runProcess;

  constructor(options: { executable: string; run: typeof runProcess }) {
    this.executable = options.executable;
    this.run = options.run;
  }

  async listTargets(options: { signal?: AbortSignal } = {}): Promise<string[]> {
    const result = await this.run(this.executable, ['-s', '127.0.0.1:8710', 'list', 'targets', '-v'], options);
    if (result.exitCode !== 0 || result.stderr.trim()) {
      throw new Error(`HDC 设备查询失败 (${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    const text = result.stdout.trim();
    if (text === '[Empty]') return [];
    if (!text) throw new Error('HDC 未返回可识别的设备列表');
    const targets = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [id, transport, state] = line.trim().split(/\s+/);
      if (!id || !transport || !state || !['USB', 'UART', 'TCP'].includes(transport)) {
        throw new Error('HDC 设备列表格式无法识别，请检查工具版本及服务状态');
      }
      if (transport === 'USB' && state === 'Connected') targets.add(id);
    }
    return [...targets];
  }

  async requireTarget(targetId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (typeof targetId !== 'string' || !targetId.trim()) throw new Error('必须显式选择 USB 目标设备');
    if (!(await this.listTargets(options)).includes(targetId)) throw new Error('所选 USB 目标未连接；不会自动切换设备');
  }

  async runTarget(targetId: string, args: readonly string[], options: { signal?: AbortSignal; beforeRun?: () => void } = {}): ReturnType<typeof runProcess> {
    if (!Array.isArray(args) || args.length < 2 || !['shell', 'file'].includes(args[0]!) ||
      args.some((arg) => typeof arg !== 'string' || /[\0\r\n]/.test(arg))) {
      throw new Error('HDC 目标命令必须为非交互的 shell 或 file 参数数组');
    }
    const { beforeRun, ...processOptions } = options;
    await this.requireTarget(targetId, processOptions);
    beforeRun?.();
    return this.run(this.executable, ['-s', '127.0.0.1:8710', '-t', targetId, ...args], processOptions);
  }
}
