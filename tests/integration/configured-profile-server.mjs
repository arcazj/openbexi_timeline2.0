import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';

// Read an existing v2 profile and its archives; all mutable server state is isolated.
export async function startConfiguredProfileServer(profile) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openbexi-profile-test-'));
  const root = path.resolve('.'), python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const generated = path.join(directory, 'yaml', 'profile.yml');
  let child, exited, output = '';
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('openbexi-profile-test-')) throw new Error('Unexpected test cleanup target');
    await rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
  }
  try {
    await mkdir(path.dirname(generated));
    await promisify(execFile)(python, ['-c', `import sys,yaml
from pathlib import Path
source,target,port=Path(sys.argv[1]).resolve(),Path(sys.argv[2]),int(sys.argv[3])
value=yaml.safe_load(source.read_text(encoding='utf-8'))
assert value['version']==2
for key in ('model','filter'): value[key]=str((source.parent/value[key]).resolve())
for item in value['data_sources']: item['data_path']=str((source.parent/item['data_path']).resolve())
value['server'].update(host='127.0.0.1',port=port,state_root=str(target.parent.parent/'state'),local_browser=True)
value['server'].pop('preferences_root',None)
target.write_text(yaml.safe_dump(value),encoding='utf-8')`, path.resolve(profile), generated, String(port)], { cwd: root, windowsHide: true });
    child = spawn(python, ['scripts/serve-legacy.py', '--yaml', generated], { cwd: root, windowsHide: true, env: { ...process.env, OPENBEXI_CORS_ORIGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    exited = once(child, 'exit');
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { const response = await fetch(baseUrl + '/health/ready', { signal: AbortSignal.timeout(1000) }); if (response.ok) { await response.arrayBuffer(); return { baseUrl, stop }; } } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Configured profile failed to start: ${output}`);
  } catch (error) { await stop(); throw error; }
}
