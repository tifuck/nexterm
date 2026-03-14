/**
 * Client-side encryption utilities for E2EE credential storage.
 *
 * Uses the Web Crypto API (SubtleCrypto) to derive an AES-256-GCM key
 * from the user's login password + a per-user salt via PBKDF2.
 * All credential encryption/decryption happens in the browser —
 * the backend only ever sees opaque ciphertext.
 */

const PBKDF2_ITERATIONS = 600_000;
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12; // AES-GCM standard nonce length

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive an AES-256-GCM CryptoKey from a password and hex-encoded salt.
 */
export async function deriveKey(
  password: string,
  saltHex: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const salt = hexToBytes(saltHex);

  // Import the password as raw key material for PBKDF2
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true, // extractable — needed for sessionStorage / cookie persistence
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Key export / import  (for sessionStorage & cookie persistence)
// ---------------------------------------------------------------------------

/**
 * Export a CryptoKey to a base64 string for storage.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(raw));
}

/**
 * Import a CryptoKey from a base64 string previously exported with `exportKey`.
 */
export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64);
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64( iv‖ciphertext ) — the auth tag is appended by WebCrypto.
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );

  // Concatenate IV + ciphertext (which includes the 16-byte auth tag)
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);

  return bytesToBase64(combined);
}

/**
 * Decrypt a ciphertext string produced by `encrypt`.
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey,
): Promise<string> {
  const combined = base64ToBytes(ciphertext);
  const iv = combined.slice(0, IV_BYTES);
  const data = combined.slice(IV_BYTES);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );

  return new TextDecoder().decode(plainBuf);
}

// ---------------------------------------------------------------------------
// Convenience: encrypt/decrypt that pass through null/undefined/empty
// ---------------------------------------------------------------------------

/**
 * Encrypt a value if it is a non-empty string; otherwise return undefined.
 */
export async function encryptIfPresent(
  value: string | undefined | null,
  key: CryptoKey,
): Promise<string | undefined> {
  if (!value) return undefined;
  return encrypt(value, key);
}

/**
 * Decrypt a value if it is a non-empty string; otherwise return undefined.
 */
export async function decryptIfPresent(
  value: string | undefined | null,
  key: CryptoKey,
): Promise<string | undefined> {
  if (!value) return undefined;
  return decrypt(value, key);
}

// ---------------------------------------------------------------------------
// Key persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'encryption_key';
const COOKIE_NAME = 'encryption_key';
const SALT_KEY = 'encryption_salt';

/** Store the exported key in sessionStorage. */
export function storeKeyInSession(base64Key: string): void {
  sessionStorage.setItem(STORAGE_KEY, base64Key);
}

/** Read the exported key from sessionStorage. */
export function getKeyFromSession(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

/** Store the exported key as a cookie with the given max-age in days. */
export function storeKeyInCookie(base64Key: string, days: number): void {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(base64Key)}; path=/; max-age=${maxAge}; SameSite=Strict; Secure`;
}

/** Read the exported key from cookies. */
export function getKeyFromCookie(): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1]);
}

/** Store the encryption salt in localStorage (not secret). */
export function storeSalt(salt: string): void {
  localStorage.setItem(SALT_KEY, salt);
}

/** Read the encryption salt from localStorage. */
export function getSalt(): string | null {
  return localStorage.getItem(SALT_KEY);
}

/** Clear all persisted key material. */
export function clearKeyMaterial(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SALT_KEY);
  // Expire the cookie
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Strict; Secure`;
}

// ---------------------------------------------------------------------------
// Byte ↔ base64 / hex helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
