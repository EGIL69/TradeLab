import { createProvider } from "@tlp/market-data";

/** One shared market-data source for the whole page. Switch with NEXT_PUBLIC_MARKET_DATA_PROVIDER. */
export const provider = createProvider(process.env.NEXT_PUBLIC_MARKET_DATA_PROVIDER || "generated");
