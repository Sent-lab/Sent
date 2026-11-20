/** EIP-1193 browser wallet provider and EIP-6963 discovery metadata. */
export interface Eip1193Provider {
  readonly isMetaMask?: boolean;
  readonly isRainbow?: boolean;
  readonly isSentLocalAnvil?: boolean;
  readonly providers?: readonly Eip1193Provider[];
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: never[]) => void): void;
  removeListener(event: string, handler: (...args: never[]) => void): void;
}

export interface DiscoveredWallet {
  readonly id: string;
  readonly name: string;
  readonly provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/**
 * Discover all wallets using EIP-6963, with legacy injected-provider fallback.
 * EIP-6963 avoids the shared `window.ethereum` collision when multiple wallet
 * extensions are installed.
 */
export async function discoverInjectedWallets(fallback?: Eip1193Provider): Promise<DiscoveredWallet[]> {
  const announced = new Map<string, DiscoveredWallet>();
  const onAnnounce = (event: Event): void => {
    const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string; rdns?: string }; provider?: Eip1193Provider }>).detail;
    if (detail?.provider === undefined) return;
    const info = detail.info ?? {};
    const id = info.uuid ?? info.rdns ?? `wallet-${announced.size}`;
    announced.set(id, { id, name: info.name ?? info.rdns ?? "Browser wallet", provider: detail.provider });
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  const legacy = fallback ?? window.ethereum;
  const legacyProviders = legacy?.providers ?? (legacy === undefined ? [] : [legacy]);
  for (const [index, provider] of legacyProviders.entries()) {
    if ([...announced.values()].some((wallet) => wallet.provider === provider)) continue;
    const name = provider.isMetaMask ? "MetaMask" : provider.isRainbow ? "Rainbow" : "Browser wallet";
    // EIP-6963 is preferred when both discovery paths report the same brand;
    // the shared legacy slot is often a wrapper and can route to another wallet.
    if (name !== "Browser wallet" && [...announced.values()].some((wallet) => wallet.name.toLowerCase() === name.toLowerCase())) continue;
    const id = `legacy-${name.toLowerCase().replaceAll(" ", "-")}-${index}`;
    announced.set(id, { id, name, provider });
  }

  return [...announced.values()].sort((a, b) => walletPriority(a) - walletPriority(b));
}

function walletPriority(wallet: DiscoveredWallet): number {
  const provider = wallet.provider as Eip1193Provider & { info?: { rdns?: string } };
  if (provider.isMetaMask || wallet.name.toLowerCase().includes("metamask") || provider.info?.rdns === "io.metamask") return 0;
  if (provider.isSentLocalAnvil) return 1;
  return 2;
}
