import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ignore TypeScript build errors (Next.js 13.4+)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Ignore ESLint errors/warnings during build
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Ensure proper handling of native modules for lightningcss
  serverExternalPackages: ["lightningcss"],
  
  // Optimize for Vercel deployment
  reactStrictMode: true,
  
  // Improve performance
  compress: true,
  
  // Fix Cross-Origin warning for development
  // Allows accessing dev server from localhost, LAN IPs, VMs, and mobile devices
  // Note: In Next.js, you may need to add specific IPs. For dynamic IPs, use the dev server with -H 0.0.0.0
  // This configuration accepts requests from common private network IPs
  // This is safe for development as it only applies in dev mode
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    // Your specific VM IP (from the error message)
    'http://192.168.56.1:3000',
    // Common private network patterns - add your specific IPs here
    // To find your IP: Windows: ipconfig | Mac/Linux: ifconfig
    // Example patterns (add your actual IPs):
    // 'http://192.168.1.100:3000',
    // 'http://192.168.0.100:3000',
    // 'http://10.0.0.100:3000',
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
    // Add specific Supabase storage domain pattern
    // This allows Next.js to properly handle Supabase storage images
    domains: [],
    // Disable strict mode for image optimization to prevent 400 errors
    // Supabase storage URLs may not always be accessible for optimization
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  
  // Ensure proper routing on Vercel
  trailingSlash: false,
  
  // Webpack configuration to fix chunk loading issues
  webpack: (config, { isServer, dev }) => {
    // Fix chunk loading errors in both dev and production
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        moduleIds: dev ? 'named' : 'deterministic',
        chunkIds: dev ? 'named' : 'deterministic',
        // Improve chunk splitting
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk for node_modules
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Common chunk for shared code
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      };
      
      // Add error handling for chunk loading
      config.output = {
        ...config.output,
        // Use publicPath for better chunk loading
        publicPath: dev ? '/_next/' : '/_next/',
        // Add chunk loading error handling
        chunkLoadTimeout: 120000, // 2 minutes
      };
    }
    
    return config;
  },
  
  // Experimental features for Next.js 15
  experimental: {
    // Ensure proper module resolution
    optimizePackageImports: ['lucide-react', 'framer-motion', 'recharts'],
  },
  
  // Suppress HMR WebSocket errors in development (optional)
  // This doesn't affect Supabase real-time - that uses a separate WebSocket connection
  onDemandEntries: {
    // Period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 25 * 1000,
    // Number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 2,
  },
  
};

export default nextConfig;
