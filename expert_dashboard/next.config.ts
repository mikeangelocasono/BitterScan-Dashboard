import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure proper handling of native modules for lightningcss
  serverExternalPackages: ["lightningcss"],
  
  // Optimize for Vercel deployment
  reactStrictMode: true,
  
  // Improve performance
  compress: true,
  
  // Fix Cross-Origin warning for development
  // Allows accessing dev server from localhost, LAN IPs, VMs, and mobile devices
  // Add your specific local IP addresses here (run `ipconfig` on Windows or `ifconfig` on Mac/Linux to find your IP)
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    // Your specific VM IP (from the warning)
    'http://192.168.56.1:3000',
    // Common private network IPs - add your specific IPs here
    // Example: 'http://192.168.1.100:3000',
    // To find your IP: Windows: ipconfig | Mac/Linux: ifconfig
  ],
  
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
