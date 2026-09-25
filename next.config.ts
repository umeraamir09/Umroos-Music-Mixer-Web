import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/mixes/generate": ["./assets/fonts/DejaVuSans-Bold.ttf"],
  },
};

export default nextConfig;
