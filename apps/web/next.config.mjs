/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: ["@tlp/trading-core", "@tlp/market-data"],
};
export default nextConfig;
