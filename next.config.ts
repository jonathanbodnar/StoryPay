import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://storyvenue.com https://www.storyvenue.com http://localhost:* http://127.0.0.1:*",
          },
        ],
      },
    ];
  },
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
