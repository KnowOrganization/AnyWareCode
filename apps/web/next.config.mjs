/** @type {import('next').NextConfig} */
const nextConfig = {
  // @anywarecode/db is a workspace package shipping compiled JS; no transpile needed.
  serverExternalPackages: ["@anywarecode/db", "pg"],
};

export default nextConfig;
