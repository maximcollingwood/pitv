// ── Types ───────────────────────────────────────────────────────────────────
export type SectionType = "articles" | "media" | "catalog";

export interface Section {
  id: number;
  type: SectionType;
  name: string;
  position: number;
}

export interface Config {
  title: string;
  subtitle: string;
  sections: Section[];
}

// Content rows vary by section type; callers know the shape from the type.
export type Item = Record<string, unknown> & { id: number };

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
  if (opts.body) headers["content-type"] = "application/json";
  return fetch(url, { ...opts, headers }).then((r) => parse<T>(r));
}

// ── API ─────────────────────────────────────────────────────────────────────
export const api = {
  info: () => fetch("/api/info").then((r) => parse<Info>(r)),
  config: () => fetch("/api/config").then((r) => parse<Config>(r)),
  sectionItems: (id: number | string) =>
    fetch(`/api/sections/${id}/items`).then((r) => parse<Item[]>(r)),
  playlist: (list: string) =>
    fetch(`/api/playlist?list=${encodeURIComponent(list)}`).then((r) =>
      parse<{ videos: { id: string; title: string }[] }>(r),
    ),

  // Fire-and-forget remote-control press (open, no auth).
  press: (action: RemoteAction) =>
    fetch("/api/remote/press", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {}),

  login: (pin: string) =>
    fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    }).then((r) => parse<{ token: string }>(r)),

  // ── Admin: settings ─────────────────────────────────────────────────────
  getSettings: () => authFetch<Record<string, string>>("/api/admin/settings"),
  saveSettings: (data: Record<string, string>) =>
    authFetch<Record<string, string>>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ── Admin: sections ─────────────────────────────────────────────────────
  adminSections: () => authFetch<Section[]>("/api/admin/sections"),
  createSection: (data: { type: SectionType; name: string }) =>
    authFetch<Section>("/api/admin/sections", { method: "POST", body: JSON.stringify(data) }),
  updateSection: (id: number, data: { name?: string; position?: number }) =>
    authFetch<Section>(`/api/admin/sections/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSection: (id: number) =>
    authFetch<null>(`/api/admin/sections/${id}`, { method: "DELETE" }),

  // ── Admin: section content ──────────────────────────────────────────────
  itemsList: (sectionId: number) =>
    authFetch<Item[]>(`/api/admin/sections/${sectionId}/items`),
  createItem: (sectionId: number, data: Record<string, unknown>) =>
    authFetch<Item>(`/api/admin/sections/${sectionId}/items`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateItem: (sectionId: number, itemId: number, data: Record<string, unknown>) =>
    authFetch<Item>(`/api/admin/sections/${sectionId}/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteItem: (sectionId: number, itemId: number) =>
    authFetch<null>(`/api/admin/sections/${sectionId}/items/${itemId}`, { method: "DELETE" }),
};
