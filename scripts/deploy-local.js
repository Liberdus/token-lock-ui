import { JsonRpcProvider, ContractFactory, parseUnits } from 'ethers';
import fs from 'fs';
import path from 'path';

const contractRepo = process.env.CONTRACT_REPO || path.resolve(process.cwd(), '..', 'token-lock-contract');
const lockArtifactPath = path.join(contractRepo, 'artifacts', 'contracts', 'TokenLock.sol', 'TokenLock.json');
const tokenArtifactPath = path.join(contractRepo, 'artifacts', 'contracts', 'MockERC20.sol', 'MockERC20.json');
const lockArtifact = JSON.parse(fs.readFileSync(lockArtifactPath, 'utf8'));
const tokenArtifact = JSON.parse(fs.readFileSync(tokenArtifactPath, 'utf8'));

const provider = new JsonRpcProvider('http://127.0.0.1:8545');
const signer = await provider.getSigner(0);

const lockFactory = new ContractFactory(lockArtifact.abi, lockArtifact.bytecode, signer);
const contract = await lockFactory.deploy();
await contract.waitForDeployment();
const lockAddress = await contract.getAddress();

const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, signer);
const token = await tokenFactory.deploy('Mock Token', 'MOCK');
await token.waitForDeployment();
const tokenAddress = await token.getAddress();

const mintAmount = parseUnits('1000000', 18);
await (await token.mint(await signer.getAddress(), mintAmount)).wait();

console.log(JSON.stringify({ tokenLock: lockAddress, mockToken: tokenAddress }));
