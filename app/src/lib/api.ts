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

export interface Info {
  hostname: string;
  adminUrl: string;
}

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
  return fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
      ...(opts.headers ?? {}),
    },
  }).then((r) => parse<T>(r));
}

// ── API ─────────────────────────────────────────────────────────────────────
export const api = {
  info: () => fetch("/api/info").then((r) => parse<Info>(r)),
  books: () => fetch("/api/books").then((r) => parse<Book[]>(r)),
  articles: () => fetch("/api/articles").then((r) => parse<ArticleSummary[]>(r)),
  article: (id: number | string) =>
    fetch(`/api/articles/${id}`).then((r) => parse<Article>(r)),

  login: (pin: string) =>
    fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    }).then((r) => parse<{ token: string }>(r)),

  adminArticles: () => authFetch<Article[]>("/api/admin/articles"),
  createArticle: (data: { title: string; body: string }) =>
    authFetch<Article>("/api/admin/articles", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateArticle: (id: number, data: { title: string; body: string }) =>
    authFetch<Article>(`/api/admin/articles/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteArticle: (id: number) =>
    authFetch<null>(`/api/admin/articles/${id}`, { method: "DELETE" }),
};
