/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/node-api', '@duckdb/node-bindings'],
  },
};

export default nextConfig;
