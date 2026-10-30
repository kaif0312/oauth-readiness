import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Seeded guides are read from disk at request time; ship them with the functions.
  outputFileTracingIncludes: { "/**": ["./src/data/**/*.json"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
