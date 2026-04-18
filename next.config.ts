import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Browsers and hosts often request /favicon.ico; Next serves app/icon.png at /icon.png
      { source: "/favicon.ico", destination: "/icon.png", permanent: false },
    ];
  },
};

export default nextConfig;
