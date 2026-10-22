// Minimal dev server: rebuilds on change and live-reloads the browser via SSE.
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { build, paths } from './build.ts';

const PORT = Number(process.env.PORT ?? 4321);
const RELOAD = `<script>new EventSource('/__reload').onmessage = () => location.reload();</script>`;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
};

const clients = new Set<ServerResponse>();

async function rebuild(): Promise<void> {
  try {
    await build({ inject: RELOAD });
    for (const client of clients) client.write('data: reload\n\n');
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
  } catch (error) {
    console.error(error);
  }
}

await rebuild();

let timer: NodeJS.Timeout | undefined;
for (const target of [paths.source, paths.template, paths.styles]) {
  watch(target, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 50);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = normalize(join(paths.dist, url.pathname.endsWith('/') ? 'index.html' : url.pathname));
  if (!file.startsWith(paths.dist)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`Dev server on http://localhost:${PORT}`));
