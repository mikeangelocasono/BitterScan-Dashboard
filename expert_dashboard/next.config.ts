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
  
};

export default nextConfig;
