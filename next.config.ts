import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Browsers and hosts often request /favicon.ico; Next serves app/icon.png at /icon.png
      { source: "/favicon.ico", destination: "/storyvenue-sidebar-mark.png", permanent: false },
      { source: "/dashboard/customers", destination: "/dashboard/contacts", permanent: false },
      { source: "/dashboard/customers/:id", destination: "/dashboard/contacts/:id", permanent: false },
    ];
  },
};

export default nextConfig;
