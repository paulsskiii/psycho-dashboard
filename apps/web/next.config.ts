import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@psycho/tokens"],
  poweredByHeader: false,
  // The dev badge sits over the bottom nav's first tab and pollutes screenshots.
  devIndicators: false,
};

export default config;
