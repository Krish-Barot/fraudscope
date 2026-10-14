import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack root for monorepo module resolution
  turbopack: {
    root: path.resolve(__dirname, '../../'),
  },

  // Standalone output bundles server + deps into .next/standalone
  // When deploying to Vercel, native output is preferred
  output: process.env.VERCEL ? undefined : 'standalone',

  // Allow images from the API server
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.railway.app',
      },
      {
        protocol: 'https',
        hostname: '**.vercel.app',
      },
    ],
  },

  // Suppress TypeScript errors during build
  // (TypeScript checks run separately in CI)
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;