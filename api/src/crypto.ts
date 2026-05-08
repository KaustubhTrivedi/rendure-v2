/**
 * AES-256-GCM encryption helpers.
 *
 * Matches the format produced by utils/crypto.py so the Python agents can
 * decrypt values written by this API and vice-versa.
 *
 * Storage format: base64(12-byte nonce + ciphertext + 16-byte auth tag)
 *
 * Requires PROFILE_ENCRYPTION_KEY env var — a 64-character hex string (32 bytes).
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function loadKey(): Buffer {
  const raw = process.env.PROFILE_ENCRYPTION_KEY ?? ''
  if (!raw) throw new Error('PROFILE_ENCRYPTION_KEY environment variable is not set.')
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('PROFILE_ENCRYPTION_KEY must be a 64-character hex string.')
  }
  return Buffer.from(raw, 'hex')
}

export function encrypt(plaintext: string): string {
  const key = loadKey()
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64')
}

export function decrypt(blob: string): string {
  const key = loadKey()
  const raw = Buffer.from(blob, 'base64')
  const nonce = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const ciphertext = raw.subarray(12, raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
