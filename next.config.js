const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Three.js ships ESM-only modules that need transpilation in Next.js.
  transpilePackages: ["three"],
  reactStrictMode: true,
  // We access the dev server via 127.0.0.1 (HSTS forces localhost to HTTPS),
  // which Next 14 flags as a cross-origin request to /_next/* and will reject
  // outright in a future major. Whitelist the loopback hosts explicitly.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

module.exports = withNextIntl(nextConfig);
