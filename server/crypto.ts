import { createHmac, createHash, randomBytes } from 'node:crypto'
import { formatParticipantCode, normalizeParticipantCode } from '../src/domain/rules.js'

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

export function generateSessionToken(meta?: {
  participantId: string
  generation: number
  expiresAtMs: number
}): { token: string; lookupDigest: string } {
  const nonce = randomBytes(24).toString('hex')
  let token = nonce
  if (meta) {
    const payload = `${nonce}.${meta.participantId}.${meta.generation}.${meta.expiresAtMs}`
    const sig = createHmac('sha256', getAdminSecret()).update(`psess:${payload}`).digest('hex')
    token = `${payload}.${sig}`
  }
  const lookupDigest = computeSessionLookupDigest(token)
  return { token, lookupDigest }
}

export function verifySignedParticipantToken(
  token: string | undefined,
  nowMs: number = Date.now(),
): { participantId: string; generation: number; expiresAtMs: number } | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 5) return null
  const [nonce, participantId, genStr, expStr, sig] = parts
  if (!nonce || !participantId || !genStr || !expStr || !sig) return null
  const generation = Number(genStr)
  const expiresAtMs = Number(expStr)
  if (!Number.isInteger(generation) || !Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
    return null
  }
  const payload = `${nonce}.${participantId}.${genStr}.${expStr}`
  const expectedSig = createHmac('sha256', getAdminSecret())
    .update(`psess:${payload}`)
    .digest('hex')
  if (sig !== expectedSig) return null
  return { participantId, generation, expiresAtMs }
}

export function signJsonPayload(data: unknown): string {
  const b64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url')
  const sig = createHmac('sha256', getAdminSecret()).update(`sync:${b64}`).digest('base64url')
  return `${b64}.${sig}`
}

export function verifySignedJsonPayload<T>(raw: string | undefined): T | null {
  if (!raw) return null
  const dot = raw.indexOf('.')
  if (dot <= 0) return null
  const b64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expected = createHmac('sha256', getAdminSecret()).update(`sync:${b64}`).digest('base64url')
  if (sig !== expected) return null
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
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
