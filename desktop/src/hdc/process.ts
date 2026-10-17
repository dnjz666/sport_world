import { spawn } from 'node:child_process';

export function runProcess(executable: string, args: readonly string[], options: { signal?: AbortSignal } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {})
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => { stdout += text; });
    child.stderr.on('data', (text: string) => { stderr += text; });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      if (exitCode === null) {
        reject(new Error(`子进程被信号 ${signal ?? 'unknown'} 终止`));
      } else {
        resolve({ exitCode, stdout, stderr });
      }
    });
  });
}
