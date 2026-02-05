import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const contractAddress = process.env.CONTRACT_ADDRESS || '';

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const configJs = `export const CONFIG = {
  APP: { NAME: 'Liberdus Token Lock', VERSION: '0.0.0', PREFETCH_ON_IDLE: false },
  NETWORK: {
    CHAIN_ID: 31337,
    NAME: 'Hardhat',
    RPC_URL: 'http://127.0.0.1:8545',
    BLOCK_EXPLORER: '',
    NATIVE_CURRENCY: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  },
  CONTRACT: {
    ADDRESS: '${contractAddress}',
    DEPLOYMENT_BLOCK: 0,
  },
};
`;

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = mime[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (req.url.startsWith('/rpc')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const rpcRes = await fetch('http://127.0.0.1:8545', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const text = await rpcRes.text();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(text);
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e?.message || 'RPC proxy error' }));
      }
    });
    return;
  }

  const parsed = url.parse(req.url).pathname || '/';
  if (parsed === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(configJs);
    return;
  }

  const filePath = path.join(root, parsed === '/' ? 'index.html' : parsed);
  serveFile(res, filePath);
});

server.listen(port, () => {
  console.log(`Test server on http://127.0.0.1:${port}`);
});
