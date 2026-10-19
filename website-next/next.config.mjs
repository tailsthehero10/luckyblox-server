import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to THIS folder.
  //
  // The release root contains its own package-lock.json and a `proxy.js` (the
  // existing dev proxy that forwards to Render). Without this, Next.js walked
  // up, picked the parent as the root, found that proxy.js and failed the build
  // with "Proxy is missing expected function export name".
  turbopack: {
    root: __dirname,
  },

  // The existing Express bridge stays the single source of truth for data.
  // Anything under /api is forwarded to it, so the Next frontend never has a
  // second, divergent implementation of the backend.
  async rewrites() {
    const target = process.env.LUCKYBLOX_BACKEND_URL || 'http://127.0.0.1:3002';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/v1/:path*', destination: `${target}/v1/:path*` },
      { source: '/v2/:path*', destination: `${target}/v2/:path*` },
    ];
  },
  reactStrictMode: true,
};

export default nextConfig;