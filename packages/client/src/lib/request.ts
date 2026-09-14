export class RequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

export async function requestError(response: Response): Promise<RequestError> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null
  return new RequestError(body?.error ?? `Request failed: ${response.status}`, body?.code, response.status)
}
