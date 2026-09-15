import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  rawBody: string;
  body: any;
  userId: number;
}

export interface Res {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

type Handler = (req: Req) => Res | Promise<Res>;

interface Route {
  method: string;
  path: string;
  auth: boolean;
  handler: Handler;
}

const MAX_BODY = 1024 * 1024;

export class Router {
  private routes: Route[] = [];

  constructor(
    private resolveUser: (token: string) => number | null,
    private corsOrigins: string[],
  ) {}

  get(path: string, handler: Handler, auth = true): void {
    this.routes.push({ method: 'GET', path, auth, handler });
  }

  post(path: string, handler: Handler, auth = true): void {
    this.routes.push({ method: 'POST', path, auth, handler });
  }

  put(path: string, handler: Handler, auth = true): void {
    this.routes.push({ method: 'PUT', path, auth, handler });
  }

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (!origin) return;
    if (this.corsOrigins.includes('*') || this.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = this.routes.find((r) => r.method === req.method && r.path === url.pathname);
    try {
      if (!route) throw new HttpError(404, 'not_found');
      const rawBody = await readBody(req);
      let body: any = null;
      if (rawBody && (req.headers['content-type'] ?? '').includes('json')) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new HttpError(400, 'bad_json');
        }
      }
      let userId = 0;
      if (route.auth) {
        const auth = req.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const uid = token ? this.resolveUser(token) : null;
        if (!uid) throw new HttpError(401, 'unauthorized');
        userId = uid;
      }
      const out = await route.handler({ method: req.method!, path: url.pathname, query: url.searchParams, headers: req.headers, rawBody, body, userId });
      send(res, out);
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, { status: e.status, json: { error: e.code, message: e.message } });
      } else {
        console.error('[server] unhandled', e);
        send(res, { status: 500, json: { error: 'internal' } });
      }
    }
  }
}

function send(res: ServerResponse, out: Res): void {
  const status = out.status ?? 200;
  const headers = { ...(out.headers ?? {}) };
  if (out.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(status, headers).end(JSON.stringify(out.json));
  } else {
    headers['Content-Type'] = headers['Content-Type'] ?? 'text/plain; charset=utf-8';
    res.writeHead(status, headers).end(out.text ?? '');
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function requireString(v: unknown, name: string, max = 256): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new HttpError(400, 'bad_param', name);
  return v;
}
