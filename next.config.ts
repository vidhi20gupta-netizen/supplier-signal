import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The inbox reads the eval batch from disk at request time. Nothing imports the file, so the
  // build's dependency tracing would leave it out of the serverless bundle (ENOENT on Vercel).
  outputFileTracingIncludes: {
    "/inbox": ["./eval/messages.txt"],
  },
};

export default nextConfig;
