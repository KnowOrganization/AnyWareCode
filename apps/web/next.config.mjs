/** @type {import('next').NextConfig} */
const nextConfig = {
  // @anywherecode/db is a workspace package shipping compiled JS; no transpile needed.
  serverExternalPackages: ["@anywherecode/db", "pg"],
};

export default nextConfig;
