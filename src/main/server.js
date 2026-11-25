import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveMount(pathname, mounts) {
  for (const [prefix, root] of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    const relative = pathname.slice(prefix.length) || '/';
    return { base: root, pathname: relative.startsWith('/') ? relative : `/${relative}` };
  }
  return null;
}

/**
 * Serves the renderer and explicitly mounted read-only asset roots.
 * Mount keys are URL prefixes (for example `/characters/`) and values are
 * absolute or base-relative directories. Every resolved path is checked
 * against its own root, so a mount cannot escape through `..` or an encoded
 * traversal sequence.
 */
export async function startStaticServer(root, options = {}) {
  const base = path.resolve(root);
  const mounts = Object.entries(options.mounts ?? {}).map(([prefix, dir]) => {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [normalized, path.resolve(base, dir)];
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const mount = resolveMount(pathname, mounts);
      const fileRoot = mount?.base ?? base;
      const filePath = mount?.pathname ?? pathname;
      const file = path.resolve(fileRoot, `.${filePath}`);
      if (!inside(fileRoot, file)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = req.method === 'HEAD' ? null : await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Length': info.size,
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

