import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt$N=16384,r=8,p=1$';
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;

function scryptBuffer(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey as Buffer);
      }
    );
  });
}

/**
 * Hashes a plaintext password using node:crypto scrypt.
 * Output format: scrypt$N=16384,r=8,p=1$<saltHex>$<derivedKeyHex>
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const salt = randomBytes(16);
  const derivedKey = await scryptBuffer(password, salt, KEY_LENGTH);

  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash.
 * Uses constant-time comparison to prevent timing side-channel attacks.
 * Only accepts valid scrypt hashes. Legacy sha256 is strictly rejected.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  if (!storedHash.startsWith(SCRYPT_PREFIX)) {
    return false;
  }

  const parts = storedHash.slice(SCRYPT_PREFIX.length).split('$');
  if (parts.length !== 2) {
    return false;
  }

  const [saltHex, originalKeyHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const originalKey = Buffer.from(originalKeyHex, 'hex');

  const derivedKey = await scryptBuffer(password, salt, originalKey.length);

  if (derivedKey.length !== originalKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, originalKey);
}
