import { spawn } from 'child_process';
import path from 'path';
import process from 'process';
import waitOn from 'wait-on';

const uiRoot = path.resolve(process.cwd());
const contractRepo = path.resolve(uiRoot, '..', 'token-lock-contract');
const hardhatCmd = 'npx';

let hardhatProc;
let serverProc;

function run(cmd, args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...opts.env } });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

async function main() {
  hardhatProc = spawn(hardhatCmd, ['hardhat', 'node', '--hostname', '127.0.0.1', '--port', '8545'], {
    cwd: contractRepo,
    stdio: 'inherit',
  });

  await waitOn({ resources: ['tcp:127.0.0.1:8545'], timeout: 30_000 });

  await run(hardhatCmd, ['hardhat', 'compile'], contractRepo);

  const deployResult = await new Promise((resolve, reject) => {
    const p = spawn('node', ['scripts/deploy-local.js'], { cwd: uiRoot, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('exit', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error('deploy-local failed'));
    });
  });

  let deployData;
  try {
    deployData = JSON.parse(deployResult.split('\n').pop().trim());
  } catch (err) {
    throw new Error(`Failed to parse deploy-local output: ${err?.message || err}`);
  }

  const contractAddress = deployData.tokenLock;
  const mockTokenAddress = deployData.mockToken;
  if (!contractAddress || !mockTokenAddress) {
    throw new Error('deploy-local did not return tokenLock/mockToken addresses');
  }

  serverProc = spawn('node', ['scripts/serve-test.js'], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: { ...process.env, CONTRACT_ADDRESS: contractAddress, PORT: '4173' },
  });

  await waitOn({ resources: ['http://127.0.0.1:4173'], timeout: 30_000 });

  const rawArgs = process.argv.slice(2);
  let slowMo = null;
  const extraArgs = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--slow-mo' || arg === '--slowMo') {
      slowMo = rawArgs[i + 1] || null;
      i += 1;
      continue;
    }
    const match = arg.match(/^--slow-mo=(\d+)$/) || arg.match(/^--slowMo=(\d+)$/);
    if (match) {
      slowMo = match[1];
      continue;
    }
    extraArgs.push(arg);
  }

  await run('npx', ['playwright', 'test', ...extraArgs], uiRoot, {
    env: {
      ...process.env,
      CONTRACT_ADDRESS: contractAddress,
      MOCK_TOKEN_ADDRESS: mockTokenAddress,
      ...(slowMo ? { PW_SLOW_MO: String(slowMo) } : {}),
    },
  });
}

function shutdown(code = 0) {
  if (serverProc) serverProc.kill('SIGTERM');
  if (hardhatProc) hardhatProc.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(1));
process.on('SIGTERM', () => shutdown(1));

main()
  .then(() => shutdown(0))
  .catch((err) => {
    console.error(err);
    shutdown(1);
  });
