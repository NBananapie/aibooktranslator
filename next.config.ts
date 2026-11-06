import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// 让 next dev 也能访问 wrangler.jsonc 中声明的绑定（D1、限流等，本地为模拟实现）
initOpenNextCloudflareForDev();
