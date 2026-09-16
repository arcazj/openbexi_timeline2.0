#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, relative, sep, extname, isAbsolute } from 'node:path';

export async function startServer({ port = 8089, host = '127.0.0.1' } = {}) {
  const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.md': 'text/plain' };
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
      const rel = relative(root, target);
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !(await stat(target)).isFile()) throw new Error('Not found');
      response.writeHead(200, { 'Content-Type': `${mime[extname(target)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(target));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer({ port: Number(process.env.PORT ?? 8089) }).then(server => console.log(`Open http://127.0.0.1:${server.address().port}/`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
