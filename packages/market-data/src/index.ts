import { GeneratedProvider } from "./generated";
import type { MarketDataProvider } from "./types";

export * from "./types";
export { GeneratedProvider };

/** Pick a provider by name (from an environment variable). Real providers are added in Phase 3. */
export function createProvider(name: string = "generated"): MarketDataProvider {
  switch (name) {
    case "generated": return new GeneratedProvider();
    default: throw new Error(`Unknown MARKET_DATA_PROVIDER "${name}". Available: generated`);
  }
}
