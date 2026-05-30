/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: [
    "@modeltruth/audit-engine",
    "@modeltruth/config",
    "@modeltruth/crypto",
    "@modeltruth/db",
    "@modeltruth/i18n",
    "@modeltruth/seo",
    "@modeltruth/shared"
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
        ]
      }
    ];
  }
};

export default nextConfig;
