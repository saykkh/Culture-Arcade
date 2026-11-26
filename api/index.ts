import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApiRequest } from '../server/router'

async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string' && req.body.length > 0) {
      try {
        return JSON.parse(req.body)
      } catch {
        return {}
      }
    }
    return req.body
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const body =
    req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
      ? await readJsonBody(req)
      : undefined

  const apiRes = await handleApiRequest({
    method: req.method || 'GET',
    url: req.url || '/',
    headers: req.headers,
    body,
  })

  res.statusCode = apiRes.status
  for (const [k, v] of Object.entries(apiRes.headers)) {
    res.setHeader(k, v)
  }
  res.end(apiRes.body)
}
