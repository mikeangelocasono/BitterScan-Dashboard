import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure proper handling of native modules for lightningcss
  serverExternalPackages: ["lightningcss"],
  
  // Optimize for Vercel deployment
  reactStrictMode: true,
  
  // Improve performance
  compress: true,
  
  // Optimize images if you add next/image later
  images: {
    domains: [],
    formats: ['image/avif', 'image/webp'],
  },
  
  // Ensure proper routing on Vercel
  trailingSlash: false,
  
  // Optimize output
  swcMinify: true,
};

export default nextConfig;
