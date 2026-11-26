import { createHmac, createHash, randomBytes } from 'node:crypto'
import { formatParticipantCode, normalizeParticipantCode } from '../src/domain/rules'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function getCodePepper(): string {
  return process.env.ARCADE_CODE_PEPPER || 'ls-way-arcade-dev-pepper-v04-isolated'
}

function getAdminSecret(): string {
  return process.env.ARCADE_ADMIN_SECRET || `${getCodePepper()}::admin-cookie`
}

export function generateParticipantCode(): { raw: string; formatted: string } {
  const bytes = randomBytes(12)
  let raw = ''
  for (let i = 0; i < 12; i += 1) {
    raw += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return { raw, formatted: formatParticipantCode(raw) }
}

export function computeCodeLookupDigest(rawCode: string): string {
  const normalized = normalizeParticipantCode(rawCode)
  return createHmac('sha256', getCodePepper()).update(`code:${normalized}`).digest('hex')
}

export function generateSessionToken(): { token: string; lookupDigest: string } {
  const token = randomBytes(32).toString('hex')
  const lookupDigest = computeSessionLookupDigest(token)
  return { token, lookupDigest }
}

export function computeSessionLookupDigest(token: string): string {
  return createHash('sha256').update(`session:${token}`).digest('hex')
}

export function createAdminSessionToken(nowMs: number = Date.now()): string {
  const expMs = nowMs + 12 * 60 * 60 * 1000
  const payload = `admin.${expMs}`
  const sig = createHmac('sha256', getAdminSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyAdminSessionToken(
  token: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'admin') return false
  const expMs = Number(parts[1])
  if (!Number.isFinite(expMs) || nowMs > expMs) return false
  const expectedPayload = `admin.${parts[1]}`
  const expectedSig = createHmac('sha256', getAdminSecret())
    .update(expectedPayload)
    .digest('hex')
  return parts[2] === expectedSig
}
