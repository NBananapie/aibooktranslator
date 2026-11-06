/**
 * Cloudflare 绑定访问与限流（OpenNext 运行时）。
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

type RateLimiterName = 'LLM_RATE_LIMITER' | 'API_RATE_LIMITER';

export async function getCloudflareEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export async function getD1(): Promise<D1Database | null> {
  try {
    const env = await getCloudflareEnv();
    return env.DB ?? null;
  } catch {
    return null;
  }
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * 按客户端 IP 限流。未配置绑定（如本地无模拟）时放行。
 * 返回 429 响应表示超限，返回 null 表示放行。
 */
export async function enforceRateLimit(req: Request, limiter: RateLimiterName, scope: string): Promise<Response | null> {
  let binding: RateLimit | undefined;
  try {
    const env = await getCloudflareEnv();
    binding = env[limiter];
  } catch {
    return null;
  }
  if (!binding) return null;

  const { success } = await binding.limit({ key: `${scope}:${getClientIp(req)}` });
  if (success) return null;
  return Response.json(
    { error: '请求过于频繁，请稍后再试' },
    { status: 429, headers: { 'Retry-After': '60' } }
  );
}
