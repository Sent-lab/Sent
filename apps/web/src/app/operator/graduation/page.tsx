"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { encodeAbiParameters, getContractAddress, type Hex } from "viem";

import {
  GRADUATION_ROUTER_BYTECODE,
  PERMANENT_LOCK_BYTECODE,
} from "../../../lib/graduationDeployBytecode";
import { discoverInjectedWallets, type DiscoveredWallet } from "../../../lib/injectedWallets";

const DEPLOYER = "0x99922502a111538dfce6a53b51bc94205ff56250" as const;
const FACTORY = "0xcea3acf9b70ce9807a99bcbdf0f93a437518eaeb" as const;
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3" as const;
const POSITION_MANAGER = "0x6eda206207c09e5428f281761ddc0d300851fbc8" as const;
const SWAP_ROUTER = "0x4e2960a8cd19b467b82d26d83facb0fae26b094d" as const;
const GOVERNANCE_SAFE = "0x791fb66ac5ff91ee7d3f1697f85c4d8b646d1e22" as const;
const SET_ROUTER_CALL =
  "0xc0d786550000000000000000000000002b0d36facd61b71cc05ab8f3d2355ec3631c0dd5";

type Provider = NonNullable<Window["ethereum"]>;
type Step = "LOCK" | "ROUTER" | "DONE";

function asHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`Wallet returned an invalid ${label}.`);
  }
  return value as Hex;
}

function asQuantity(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return BigInt(value);
  throw new Error(`Wallet returned an invalid ${label} (${typeof value}).`);
}

async function readRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch("https://rpc.hyperliquid.xyz/evm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HyperEVM public RPC returned HTTP ${response.status}.`);
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error !== undefined) throw new Error(body.error.message ?? `HyperEVM RPC failed: ${method}.`);
  return body.result;
}

async function readPendingNonce(account: `0x${string}`): Promise<bigint> {
  return asQuantity(await readRpc("eth_getTransactionCount", [account, "pending"]), "pending nonce");
}

async function findResumableLock(account: `0x${string}`, nonce: bigint): Promise<`0x${string}` | null> {
  if (nonce === 0n) return null;
  const nextRouter = getContractAddress({ from: account, nonce });
  const minNonce = nonce > 5n ? nonce - 5n : 0n;
  for (let candidateNonce = nonce - 1n; candidateNonce >= minNonce; candidateNonce -= 1n) {
    const candidate = getContractAddress({ from: account, nonce: candidateNonce });
    const code = await readRpc("eth_getCode", [candidate, "latest"]);
    if (code === "0x") continue;
    const [managerResult, routerResult] = await Promise.all([
      readRpc("eth_call", [{ to: candidate, data: "0x1bea83fe" }, "latest"]),
      readRpc("eth_call", [{ to: candidate, data: "0x32fe7b26" }, "latest"]),
    ]);
    const manager = typeof managerResult === "string" ? managerResult.slice(-40).toLowerCase() : "";
    const designatedRouter = typeof routerResult === "string" ? routerResult.slice(-40).toLowerCase() : "";
    if (manager === POSITION_MANAGER.slice(2).toLowerCase() && designatedRouter === nextRouter.slice(2).toLowerCase()) {
      return candidate;
    }
  }
  return null;
}

export default function GraduationDeployPage(): JSX.Element {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("LOCK");
  const [initialNonce, setInitialNonce] = useState<bigint | null>(null);
  const [lockAddress, setLockAddress] = useState<`0x${string}` | null>(null);
  const [routerAddress, setRouterAddress] = useState<`0x${string}` | null>(null);
  const [message, setMessage] = useState("Checking local wallet and mainnet chain…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal) {
      setMessage("This operator tool is restricted to a local browser session.");
      return;
    }

    void discoverInjectedWallets(window.ethereum).then((found) => {
      setWallets(found);
      const preferred = found.find((wallet) => wallet.name.toLowerCase().includes("metamask")) ?? found[0];
      if (preferred !== undefined) setSelectedWalletId(preferred.id);
      else setMessage("MetaMask was not detected. Enable its extension for this local site, then reload.");
    });
  }, []);

  const selectedWallet = wallets.find((wallet) => wallet.id === selectedWalletId) ?? null;

  useEffect(() => {
    const wallet = selectedWallet?.provider ?? null;
    setProvider(wallet);
    setAccount(null);
    setInitialNonce(null);
    if (wallet === null) return;

    void Promise.all([
      wallet.request({ method: "eth_chainId" }),
      wallet.request({ method: "eth_accounts" }),
    ]).then(([chain, accounts]) => {
      if (chain !== "0x3e7") {
        setMessage(`Switch ${selectedWallet?.name ?? "wallet"} to HyperEVM mainnet (chain 999).`);
        return;
      }
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof first === "string") setAccount(first);
      setMessage(
        typeof first === "string" && first.toLowerCase() === DEPLOYER
          ? `SENT Deployer is selected in ${selectedWallet?.name}. Connect this page, then review each deployment there.`
          : `Connect the SENT Deployer account in ${selectedWallet?.name} to continue.`,
      );
    }).catch(() => setMessage(`Could not read the selected ${selectedWallet?.name ?? "wallet"} account and network.`));
  }, [selectedWallet]);

  const connected = account?.toLowerCase() === DEPLOYER;
  const canDeploy = useMemo(
    () => provider !== null && connected && !busy,
    [provider, connected, busy],
  );

  const connect = async (): Promise<void> => {
    if (provider === null) return;
    setBusy(true);
    setMessage("Requesting access to the selected wallet address…");
    try {
      const chain = await provider.request({ method: "eth_chainId" });
      if (chain !== "0x3e7") throw new Error("Switch MetaMask to HyperEVM mainnet (chain 999).");
      // Reuse an account already authorized to this page. Calling
      // eth_requestAccounts again can leave extension prompts pending in some
      // multi-wallet browsers even though eth_accounts already exposed it.
      let accounts = await provider.request({ method: "eth_accounts" });
      let first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof first !== "string" || first.toLowerCase() !== DEPLOYER) {
        accounts = await provider.request({ method: "eth_requestAccounts" });
        first = Array.isArray(accounts) ? accounts[0] : undefined;
      }
      if (typeof first !== "string" || first.toLowerCase() !== DEPLOYER) {
        throw new Error("Select SENT Deployer (0x9992…6250) in MetaMask, then retry.");
      }
      const deployer = first as `0x${string}`;
      const nonce = await readPendingNonce(deployer);
      setAccount(deployer);
      const resumableLock = await findResumableLock(deployer, nonce);
      if (resumableLock !== null) {
        const router = getContractAddress({ from: deployer, nonce });
        setLockAddress(resumableLock);
        setStep("ROUTER");
        setInitialNonce(nonce - 1n);
        setRouterAddress(router);
        setMessage(`Found the confirmed permanent lock at ${resumableLock}. Ready to deploy the router at ${router}.`);
      } else {
        const router = getContractAddress({ from: deployer, nonce: nonce + 1n });
        setStep("LOCK");
        setInitialNonce(nonce);
        setRouterAddress(router);
        setMessage(`Connected to SENT Deployer. Expected router address: ${router}.`);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const sendDeployment = async (): Promise<void> => {
    if (provider === null || account === null || initialNonce === null || routerAddress === null) return;
    setBusy(true);
    try {
      if (await readRpc("eth_chainId", []) !== "0x3e7") {
        throw new Error("Wrong network. Nothing was sent.");
      }
      const currentNonce = await readPendingNonce(account as `0x${string}`);
      if (step === "LOCK" && currentNonce !== initialNonce) {
        throw new Error("Deployer nonce changed. Refresh and review the router address again.");
      }
      if (step === "ROUTER" && (lockAddress === null || currentNonce !== initialNonce + 1n)) {
        throw new Error("Expected only the lock deployment before this step. Stop and recheck the wallet nonce.");
      }

      const constructorArgs = step === "LOCK"
        ? encodeAbiParameters([{ type: "address" }, { type: "address" }], [POSITION_MANAGER, routerAddress])
        : encodeAbiParameters(
            [
              { type: "address" }, { type: "address" }, { type: "address" },
              { type: "address" }, { type: "address" },
            ],
            [FACTORY, V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, lockAddress!],
          );
      const bytecode = step === "LOCK" ? PERMANENT_LOCK_BYTECODE : GRADUATION_ROUTER_BYTECODE;
      const data = `${bytecode}${constructorArgs.slice(2)}` as Hex;
      const txHash = asHex(
        await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, data, nonce: `0x${currentNonce.toString(16)}` }],
        }),
        "transaction hash",
      );
      setMessage(`Submitted ${step === "LOCK" ? "permanent lock" : "graduation router"}: ${txHash}. Waiting for confirmation…`);

      let receipt: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const result = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
        if (typeof result === "object" && result !== null) {
          receipt = result as Record<string, unknown>;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (receipt === null) {
        setMessage(`Transaction is pending: ${txHash}. Reopen this page after it confirms.`);
        return;
      }
      if (receipt.status !== "0x1") throw new Error(`Deployment reverted: ${txHash}`);
      const deployed = receipt.contractAddress;
      if (typeof deployed !== "string") throw new Error("Receipt did not include the deployed contract address.");

      if (step === "LOCK") {
        setLockAddress(deployed as `0x${string}`);
        setStep("ROUTER");
        setMessage(`Permanent lock deployed at ${deployed}. Review and send the router deployment as a separate MetaMask transaction.`);
      } else {
        if (deployed.toLowerCase() !== routerAddress.toLowerCase()) {
          throw new Error(`Router address mismatch. Expected ${routerAddress}, got ${deployed}.`);
        }
        const code = asHex(await provider.request({ method: "eth_getCode", params: [deployed, "latest"] }), "router bytecode");
        if (code === "0x") throw new Error("Router deployment has no runtime code.");
        setRouterAddress(deployed as `0x${string}`);
        setStep("DONE");
        setMessage(`Router deployed at ${deployed}. Governance Safe must now execute factory.setRouter(router).`);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: 24, color: "#f3f7f6", background: "#091b17", border: "1px solid #245347", borderRadius: 16, fontFamily: "system-ui" }}>
      <p style={{ color: "#5ce1b5", letterSpacing: 2 }}>SENT · LOCAL OPERATOR TOOL</p>
      <h1>Deploy graduation lock + router</h1>
      <p>This prepares two separate HyperEVM mainnet deployments from the SENT Deployer wallet. Each transaction opens MetaMask for your review. This page never has access to your private key.</p>
      {wallets.length > 1 && account === null && (
        <label style={{ display: "block", margin: "12px 0" }}>
          Wallet: {" "}
          <select value={selectedWalletId ?? ""} onChange={(event) => setSelectedWalletId(event.target.value)}>
            {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
          </select>
        </label>
      )}
      <p style={{ padding: 16, background: "#142a24", borderRadius: 8 }}><strong>Account:</strong> {account ?? "Not connected"}<br/><strong>Expected lock:</strong> PermanentLiquidityLock<br/><strong>Expected router:</strong> {routerAddress ?? "Calculated after wallet connection"}<br/><strong>Factory:</strong> {FACTORY}</p>
      <p role="status" aria-live="polite">{message}</p>
      {!connected ? (
        <button onClick={() => void connect()} disabled={provider === null || busy} style={buttonStyle}>{busy ? "Connecting…" : "Connect SENT Deployer"}</button>
      ) : step !== "DONE" ? (
        <button
          onClick={() => void (initialNonce === null ? connect() : sendDeployment())}
          disabled={!canDeploy}
          style={buttonStyle}
        >
          {busy ? "Waiting for MetaMask / chain…" : initialNonce === null ? "Prepare deployment" : `Review ${step === "LOCK" ? "lock" : "router"} deployment in MetaMask`}
        </button>
      ) : (
        <section style={{ padding: 16, background: "#142a24", borderRadius: 8 }}>
          <h2>Deployment complete</h2>
          <p>Lock: {lockAddress}</p>
          <p>Router: {routerAddress}</p>
          <p>Governance Safe: {GOVERNANCE_SAFE}</p>
          <p>Factory call: <code>{SET_ROUTER_CALL}</code></p>
          <p>The Safe call still needs two owner signatures. Do not describe graduation as active until the Safe transaction is executed and read back onchain.</p>
        </section>
      )}
      <p style={{ marginTop: 28, color: "#bac9c4", fontSize: 13 }}>Chain 999 · Gas paid by SENT Deployer · No factory, registry, price-feed, guardian or reward configuration is changed by these two deployments.</p>
    </main>
  );
}

const buttonStyle = {
  padding: "12px 18px",
  border: 0,
  borderRadius: 8,
  color: "#04251a",
  background: "#5ce1b5",
  fontWeight: 700,
  cursor: "pointer",
};
