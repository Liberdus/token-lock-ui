import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import process from 'process';
import waitOn from 'wait-on';

const uiRoot = path.resolve(process.cwd());
const DEFAULT_CONTRACT_REPO_URL = 'https://github.com/Liberdus/token-lock-contract';
const DEFAULT_CONTRACT_REPO_REF = 'main';
const managedContractRepo = path.join(uiRoot, '.e2e', 'token-lock-contract');
const playwrightCli = path.join(uiRoot, 'node_modules', '@playwright', 'test', 'cli.js');

let hardhatProc;
let serverProc;

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readCommandOutput(command, args, cwd = uiRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function runCommandSync(command, args, cwd, opts = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: opts.stdio || 'inherit',
    encoding: opts.encoding || 'utf8',
    env: { ...process.env, ...opts.env },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
  return result.stdout || '';
}

function runNodeScript(scriptPath, args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...opts.env },
    });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

function isFullCommitSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || '').trim());
}

function resolveRemoteRefSha(repoUrl, refName) {
  if (!refName) return '';
  const output = readCommandOutput('git', ['ls-remote', repoUrl, refName]);
  return output.split(/\s+/)[0] || '';
}

function repoMatchesRef(repoPath, repoUrl, repoRef) {
  if (!pathExists(path.join(repoPath, '.git'))) return false;

  const currentBranch = readCommandOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  if (currentBranch === repoRef) return true;

  const localHead = readCommandOutput('git', ['rev-parse', 'HEAD'], repoPath);
  if (isFullCommitSha(repoRef) && localHead === repoRef) return true;

  const remoteHead = resolveRemoteRefSha(repoUrl, repoRef);
  return !!localHead && !!remoteHead && localHead === remoteHead;
}

function getConfiguredContractRepo(contractRepoUrl, contractRepoRef) {
  if (process.env.CONTRACT_REPO) {
    return path.resolve(uiRoot, process.env.CONTRACT_REPO);
  }

  const siblingRepo = path.resolve(uiRoot, '..', 'token-lock-contract');
  if (pathExists(siblingRepo) && repoMatchesRef(siblingRepo, contractRepoUrl, contractRepoRef)) {
    return siblingRepo;
  }

  return managedContractRepo;
}

function getContractRepoUrl() {
  return process.env.CONTRACT_REPO_URL || DEFAULT_CONTRACT_REPO_URL;
}

function getCurrentBranchCandidate() {
  const branchCandidates = [
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF_NAME,
    readCommandOutput('git', ['branch', '--show-current']),
  ];

  return branchCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';
}

function remoteHasBranch(repoUrl, branchName) {
  if (!branchName) return false;
  const result = spawnSync('git', ['ls-remote', '--heads', repoUrl, branchName], {
    cwd: uiRoot,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return false;
  return String(result.stdout || '').includes(`refs/heads/${branchName}`);
}

function resolveContractRepoRef(repoUrl) {
  const explicitRef = String(process.env.CONTRACT_REPO_REF || '').trim();
  if (explicitRef) {
    return explicitRef;
  }

  const preferredBranch = getCurrentBranchCandidate();
  if (preferredBranch && remoteHasBranch(repoUrl, preferredBranch)) {
    return preferredBranch;
  }
  return DEFAULT_CONTRACT_REPO_REF;
}

function ensureManagedContractRepo(repoPath, repoUrl, repoRef) {
  const repoGitDir = path.join(repoPath, '.git');
  if (!pathExists(repoGitDir)) {
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    fs.mkdirSync(repoPath, { recursive: true });
    runCommandSync('git', ['init'], repoPath);
    runCommandSync('git', ['remote', 'add', 'origin', repoUrl], repoPath);
  } else {
    runCommandSync('git', ['remote', 'set-url', 'origin', repoUrl], repoPath);
  }

  runCommandSync('git', ['fetch', '--depth', '1', 'origin', repoRef], repoPath);
  runCommandSync('git', ['checkout', '--force', 'FETCH_HEAD'], repoPath);
}

function ensureContractRepoDependencies(repoPath) {
  const hardhatCli = path.join(repoPath, 'node_modules', 'hardhat', 'internal', 'cli', 'bootstrap.js');
  if (pathExists(hardhatCli)) {
    return hardhatCli;
  }

  const hasLockfile = pathExists(path.join(repoPath, 'package-lock.json'));
  runCommandSync('npm', [hasLockfile ? 'ci' : 'install'], repoPath);
  return hardhatCli;
}

async function main() {
  const contractRepoUrl = getContractRepoUrl();
  const contractRepoRef = resolveContractRepoRef(contractRepoUrl);
  const contractRepo = getConfiguredContractRepo(contractRepoUrl, contractRepoRef);

  if (contractRepo === managedContractRepo || !pathExists(contractRepo)) {
    ensureManagedContractRepo(contractRepo, contractRepoUrl, contractRepoRef);
  }

  const hardhatCli = ensureContractRepoDependencies(contractRepo);

  hardhatProc = spawn(process.execPath, [hardhatCli, 'node', '--hostname', '127.0.0.1', '--port', '8545'], {
    cwd: contractRepo,
    stdio: 'inherit',
  });

  await waitOn({ resources: ['tcp:127.0.0.1:8545'], timeout: 30_000 });

  await runNodeScript(hardhatCli, ['compile'], contractRepo);

  const deployResult = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['scripts/deploy-local.js'], {
      cwd: uiRoot,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        CONTRACT_REPO: contractRepo,
      },
    });
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

  serverProc = spawn(process.execPath, ['scripts/serve-test.js'], {
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

  await runNodeScript(playwrightCli, ['test', ...extraArgs], uiRoot, {
    env: {
      ...process.env,
      CONTRACT_ADDRESS: contractAddress,
      MOCK_TOKEN_ADDRESS: mockTokenAddress,
      ...(slowMo ? { PW_SLOW_MO: String(slowMo) } : {}),
    },
  });
}

function shutdown(code = 0) {
  killChild(serverProc);
  killChild(hardhatProc);
  process.exit(code);
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

process.on('SIGINT', () => shutdown(1));
process.on('SIGTERM', () => shutdown(1));

main()
  .then(() => shutdown(0))
  .catch((err) => {
    console.error(err);
    shutdown(1);
  });
