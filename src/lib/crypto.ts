/**
 * 端到端加密 (E2EE) 与高熵口令安全工具模块
 * 使用 W3C Web Cryptography API (PBKDF2 + AES-GCM 256-bit)
 * 零第三方外部依赖，纯原生跨平台支持 (浏览器 / Edge Runtime / Node.js)
 */

const E2EE_PREFIX = 'e2ee:v1:';
const E2EE_SALT = new TextEncoder().encode('aibooktranslator-e2ee-salt-v1');
const PBKDF2_ITERATIONS = 100000;

/**
 * 校验同步口令强度
 * 必须达到至少 16 位字符的高熵要求，防字典暴力破解
 */
export function isStrongSyncKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.length >= 16 && trimmed.length <= 128;
}

/**
 * 生成强随机高熵同步口令 (UUIDv4 格式)
 * 长度达 37 字符，熵值 122 bits，数学上不可被穷举
 */
export function generateStrongSyncKey(): string {
  let uuid = '';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    uuid = crypto.randomUUID();
  } else {
    // 兼容回退
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    uuid = `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
  }
  return `sync-${uuid}`;
}

/**
 * Uint8Array 转 Base64 字符串 (分块处理，兼容超大缓冲区)
 */
function bufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Base64 字符串转 Uint8Array
 */
function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 通过口令基于 PBKDF2 派生 AES-GCM 256-bit 密钥
 */
async function deriveKey(syncKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(syncKey.trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: E2EE_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 端到端加密任意数据对象或字符串
 * 输出格式: e2ee:v1:<base64-iv>:<base64-ciphertext>
 */
export async function encryptE2EE(data: any, syncKey: string): Promise<string> {
  if (!isStrongSyncKey(syncKey)) {
    throw new Error('口令强度不足，无法执行端到端加密');
  }

  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const key = await deriveKey(syncKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded as unknown as BufferSource
  );

  const ivB64 = bufferToBase64(iv);
  const cipherB64 = bufferToBase64(new Uint8Array(ciphertext));

  return `${E2EE_PREFIX}${ivB64}:${cipherB64}`;
}

/**
 * 端到端解密数据
 * 具有向下兼容性：若传入未加密的 JSON 字符串或对象，自动安全回退返回
 */
export async function decryptE2EE(raw: any, syncKey: string): Promise<any> {
  if (raw === null || raw === undefined) return raw;

  // 如果已经不是字符串，直接返回
  if (typeof raw !== 'string') return raw;

  // 如果不是 E2EE 加密格式，尝试按原有明文 JSON 解析
  if (!raw.startsWith(E2EE_PREFIX)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (!isStrongSyncKey(syncKey)) {
    console.warn('缺少有效同步口令，无法解密 E2EE 密文');
    return null;
  }

  try {
    const content = raw.substring(E2EE_PREFIX.length);
    const colonIndex = content.indexOf(':');
    if (colonIndex === -1) {
      throw new Error('E2EE 密文格式畸形');
    }

    const ivB64 = content.substring(0, colonIndex);
    const cipherB64 = content.substring(colonIndex + 1);

    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(cipherB64);
    const key = await deriveKey(syncKey);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );

    const decoded = new TextDecoder().decode(decrypted);
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  } catch (err) {
    console.error('E2EE 解密失败（口令可能不匹配或数据损坏）:', err);
    return null;
  }
}
