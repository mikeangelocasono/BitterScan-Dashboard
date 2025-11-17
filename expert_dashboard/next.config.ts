import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure proper handling of native modules for lightningcss
  serverExternalPackages: ["lightningcss"],
  
  // Optimize for Vercel deployment
  reactStrictMode: true,
  
  // Improve performance
  compress: true,
  
  // Optimize images with next/image
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  
  // Ensure proper routing on Vercel
  trailingSlash: false,
  
  // Webpack configuration to fix chunk loading issues in production builds
  webpack: (config, { isServer, dev }) => {
    // Only apply in production builds (not in dev mode with Turbopack)
    if (!isServer && !dev) {
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        chunkIds: 'deterministic',
      };
    }
    
    return config;
  },
  
  // Experimental features for Next.js 15
  experimental: {
    // Ensure proper module resolution
    optimizePackageImports: ['lucide-react', 'framer-motion', 'recharts'],
  },
  
};

export default nextConfig;
