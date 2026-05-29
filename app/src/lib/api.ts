// ── Types ───────────────────────────────────────────────────────────────────
export interface Book {
  id: number;
  title: string;
  author: string;
  year: number | null;
  category: string | null;
  description: string | null;
}

export interface ArticleSummary {
  id: number;
  title: string;
  updated_at: string;
}

export interface Article extends ArticleSummary {
  body: string;
  created_at: string;
}

export interface Kirtan {
  id: number;
  category: string;
  title: string;
  youtube_url: string;
}

export interface Video {
  id: number;
  category: string;
  title: string;
  youtube_url: string;
  is_playlist: number;
}

export type MediaType = "kirtans" | "videos";

export interface MediaItem {
  id: number;
  category: string;
  title: string;
  youtube_url: string;
  is_playlist?: number;
}

export interface Info {
  hostname: string;
  remoteUrl: string;
  adminUrl: string;
}

export type RemoteAction = "up" | "down" | "left" | "right" | "select" | "back";

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

// ── Token storage (phone CMS) ───────────────────────────────────────────────
const TOKEN_KEY = "pitv_admin_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status);
  return (res.status === 204 ? null : await res.json()) as T;
}

function authFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken() ?? ""}`,
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  // Only declare a JSON body when we actually send one. An empty body with
  // content-type: application/json makes Fastify reject the request (400),
  // which is what broke DELETE.
  if (opts.body) headers["content-type"] = "application/json";
  return fetch(url, { ...opts, headers }).then((r) => parse<T>(r));
}

// ── API ─────────────────────────────────────────────────────────────────────
export const api = {
  info: () => fetch("/api/info").then((r) => parse<Info>(r)),

  // Fire-and-forget remote-control press (open, no auth).
  press: (action: RemoteAction) =>
    fetch("/api/remote/press", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {}),

  books: () => fetch("/api/books").then((r) => parse<Book[]>(r)),
  articles: () => fetch("/api/articles").then((r) => parse<ArticleSummary[]>(r)),
  article: (id: number | string) =>
    fetch(`/api/articles/${id}`).then((r) => parse<Article>(r)),
  kirtans: () => fetch("/api/kirtans").then((r) => parse<Kirtan[]>(r)),
  videos: () => fetch("/api/videos").then((r) => parse<Video[]>(r)),
  media: (type: MediaType) =>
    fetch(`/api/${type}`).then((r) => parse<MediaItem[]>(r)),

  login: (pin: string) =>
    fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    }).then((r) => parse<{ token: string }>(r)),

  // Generic admin CRUD (path is one of the /api/admin/* resource roots).
  adminList: <T>(path: string) => authFetch<T[]>(path),
  adminCreate: <T>(path: string, data: Record<string, unknown>) =>
    authFetch<T>(path, { method: "POST", body: JSON.stringify(data) }),
  adminUpdate: <T>(path: string, id: number, data: Record<string, unknown>) =>
    authFetch<T>(`${path}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDelete: (path: string, id: number) =>
    authFetch<null>(`${path}/${id}`, { method: "DELETE" }),
};
