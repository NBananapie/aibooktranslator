/**
 * 云同步口令与端到端加密。
 * 使用 Web Crypto API（PBKDF2 + HKDF + AES-GCM 256-bit），浏览器与 Workers 均可运行。
 *
 * v2 方案：
 *   主密钥 = PBKDF2(口令, 固定盐, 600000 次, SHA-256)
 *   authToken = HKDF(主密钥, info="auth-v2")     → 发送给服务端用于寻址，服务端只保存它的 SHA-256
 *   encKey    = HKDF(主密钥, info="enc-v2")      → 只在本地使用，服务端无法得到
 * 每条密文以 AES-GCM 加密，并把"书籍指纹 + 数据类型 + 条目编号"作为附加认证数据，
 * 防止服务端把一条密文挪到别的书或别的页。
 *
 * v1 方案（旧数据，只用于迁移读取）：PBKDF2(口令, 固定盐, 100000 次) 直接得到 AES 密钥，
 * 且口令本身以明文发送并存储在服务端。
 */

const E2EE_V1_PREFIX = 'e2ee:v1:';
const E2EE_V2_PREFIX = 'e2ee:v2:';
const V1_SALT = 'aibooktranslator-e2ee-salt-v1';
const V1_ITERATIONS = 100_000;
const V2_SALT = 'aibooktranslator-sync-v2';
const V2_ITERATIONS = 600_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SyncKeys {
  /** 64 位十六进制，作为 Authorization: Bearer 凭证 */
  authToken: string;
  encKey: CryptoKey;
}

/** 同步口令长度要求：16–128 个字符 */
export function isStrongSyncKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.length >= 16 && trimmed.length <= 128;
}

/** 生成随机同步口令：sync- 前缀 + UUIDv4（122 bit 随机数） */
export function generateStrongSyncKey(): string {
  return `sync-${crypto.randomUUID()}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

const keyCache = new Map<string, Promise<SyncKeys>>();

async function deriveSyncKeysUncached(syncKey: string): Promise<SyncKeys> {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(syncKey), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(V2_SALT), iterations: V2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdfParams = (info: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  });

  const authBits = await crypto.subtle.deriveBits(hkdfParams('auth-v2'), hkdfKey, 256);
  const encKey = await crypto.subtle.deriveKey(
    hkdfParams('enc-v2'),
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { authToken: bytesToHex(new Uint8Array(authBits)), encKey };
}

/** 由口令派生同步凭证与加密密钥（PBKDF2 较慢，按口令缓存） */
export function deriveSyncKeys(syncKey: string): Promise<SyncKeys> {
  const normalized = syncKey.trim();
  if (!isStrongSyncKey(normalized)) {
    return Promise.reject(new Error('同步口令需为 16–128 个字符'));
  }
  let cached = keyCache.get(normalized);
  if (!cached) {
    cached = deriveSyncKeysUncached(normalized);
    cached.catch(() => keyCache.delete(normalized));
    keyCache.set(normalized, cached);
  }
  return cached;
}

/** 加密任意可 JSON 序列化的数据，输出 e2ee:v2:<iv>:<ciphertext> */
export async function encryptV2(data: unknown, encKey: CryptoKey, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    encKey,
    encoder.encode(JSON.stringify(data))
  );
  return `${E2EE_V2_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/** 解密 v2 密文；格式错误、口令不匹配或附加数据不符时抛出异常 */
export async function decryptV2<T>(raw: string, encKey: CryptoKey, aad: string): Promise<T> {
  if (!raw.startsWith(E2EE_V2_PREFIX)) throw new Error('不是 v2 密文');
  const body = raw.slice(E2EE_V2_PREFIX.length);
  const sep = body.indexOf(':');
  if (sep === -1) throw new Error('密文格式错误');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(body.slice(0, sep)), additionalData: encoder.encode(aad) },
    encKey,
    base64ToBytes(body.slice(sep + 1))
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/**
 * 读取旧版（v1）云端字段：可能是 e2ee:v1 密文、明文 JSON 字符串或已解析对象。
 * 解密失败返回 null。
 */
export async function decryptLegacyV1(raw: unknown, syncKey: string): Promise<unknown> {
  if (raw === null || raw === undefined || typeof raw !== 'string') return raw ?? null;
  if (!raw.startsWith(E2EE_V1_PREFIX)) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  try {
    const body = raw.slice(E2EE_V1_PREFIX.length);
    const sep = body.indexOf(':');
    if (sep === -1) return null;
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(syncKey.trim()), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode(V1_SALT), iterations: V1_ITERATIONS, hash: 'SHA-256' },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(body.slice(0, sep)) },
      key,
      base64ToBytes(body.slice(sep + 1))
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch (err) {
    console.error('旧版同步数据解密失败（口令可能不匹配或数据损坏）:', err);
    return null;
  }
}
