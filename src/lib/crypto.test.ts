import { describe, expect, it } from 'vitest';
import {
  decryptLegacyV1,
  decryptV2,
  deriveSyncKeys,
  encryptV2,
  generateStrongSyncKey,
  isStrongSyncKey,
  sha256Hex,
} from '@/lib/crypto';

const KEY = 'sync-unit-test-key-0001';

describe('isStrongSyncKey / generateStrongSyncKey', () => {
  it('requires 16-128 characters', () => {
    expect(isStrongSyncKey('short')).toBe(false);
    expect(isStrongSyncKey('x'.repeat(16))).toBe(true);
    expect(isStrongSyncKey('x'.repeat(129))).toBe(false);
  });

  it('generates valid unique keys', () => {
    const a = generateStrongSyncKey();
    const b = generateStrongSyncKey();
    expect(isStrongSyncKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('deriveSyncKeys', () => {
  it('is deterministic and does not expose the passphrase', async () => {
    const k1 = await deriveSyncKeys(KEY);
    const k2 = await deriveSyncKeys(` ${KEY} `);
    expect(k1.authToken).toMatch(/^[a-f0-9]{64}$/);
    expect(k1.authToken).toBe(k2.authToken);
    expect(k1.authToken).not.toContain(KEY);
  });

  it('gives different tokens for different passphrases', async () => {
    const a = await deriveSyncKeys(KEY);
    const b = await deriveSyncKeys(`${KEY}-other`);
    expect(a.authToken).not.toBe(b.authToken);
  });

  it('rejects weak passphrases', async () => {
    await expect(deriveSyncKeys('weak')).rejects.toThrow();
  });
});

describe('encryptV2 / decryptV2', () => {
  it('round-trips data including Chinese text', async () => {
    const { encKey } = await deriveSyncKeys(KEY);
    const data = { text: '第一页译文', n: 3 };
    const cipher = await encryptV2(data, encKey, 'fp|page|1');
    expect(cipher.startsWith('e2ee:v2:')).toBe(true);
    expect(cipher).not.toContain('第一页');
    await expect(decryptV2(cipher, encKey, 'fp|page|1')).resolves.toEqual(data);
  });

  it('fails when associated data does not match', async () => {
    const { encKey } = await deriveSyncKeys(KEY);
    const cipher = await encryptV2('x', encKey, 'fp|page|1');
    await expect(decryptV2(cipher, encKey, 'fp|page|2')).rejects.toThrow();
  });

  it('fails with a different key', async () => {
    const { encKey } = await deriveSyncKeys(KEY);
    const other = await deriveSyncKeys(`${KEY}-other`);
    const cipher = await encryptV2('x', encKey, 'aad');
    await expect(decryptV2(cipher, other.encKey, 'aad')).rejects.toThrow();
  });
});

describe('decryptLegacyV1', () => {
  it('parses legacy plaintext JSON', async () => {
    await expect(decryptLegacyV1('{"1":"旧版"}', KEY)).resolves.toEqual({ '1': '旧版' });
  });

  it('returns null for undecryptable v1 cipher', async () => {
    await expect(decryptLegacyV1('e2ee:v1:AAAA:BBBB', KEY)).resolves.toBeNull();
  });
});

describe('sha256Hex', () => {
  it('matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
