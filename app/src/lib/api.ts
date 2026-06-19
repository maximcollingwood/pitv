// ── Types ───────────────────────────────────────────────────────────────────
export type SectionType = "articles" | "lyrics" | "media" | "catalog" | "faq";

export interface Section {
  id: number;
  type: SectionType;
  name: string;
  position: number;
}

export interface Config {
  title: string;
  subtitle: string;
  dark: boolean;
  hero: string;
  sections: Section[];
}

// Content rows vary by section type; callers know the shape from the type.
export type Item = Record<string, unknown> & { id: number };

export interface Info {
  hostname: string;
  remoteUrl: string;
  adminUrl: string;
}

export interface BgTrack {
  id: number;
  title: string;
  youtube_url: string;
  position: number;
}

export interface BgState {
  trackId: number | null;
  playing: boolean;
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
      parse<{ videos: { id: string; title: string }[]; source: "api" | "rss" }>(r),
    ),

  // Dark mode (open — same trust level as the remote).
  setDark: (dark: boolean) =>
    fetch("/api/dark-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dark }),
    }).then((r) => parse<{ dark: boolean }>(r)),

  // Background audio (open, no auth — same trust level as the remote).
  backgroundTracks: () =>
    fetch("/api/background/tracks").then((r) => parse<BgTrack[]>(r)),
  backgroundState: () =>
    fetch("/api/background/state").then((r) => parse<BgState>(r)),
  setBackgroundState: (s: Partial<BgState>) =>
    fetch("/api/background/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    }).then((r) => parse<BgState>(r)),

  // System volume (open, no auth).
  getVolume: () => fetch("/api/system/volume").then((r) => parse<{ level: number }>(r)),
  setVolume: (level: number) =>
    fetch("/api/system/volume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level }),
    }).then((r) => parse<{ level: number }>(r)),

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

  // ── Admin: hero image ───────────────────────────────────────────────────
  uploadHero: (data: string, mime: string) =>
    authFetch<{ url: string }>("/api/admin/hero", {
      method: "POST",
      body: JSON.stringify({ data, mime }),
    }),
  deleteHero: () => authFetch<{ ok: true }>("/api/admin/hero", { method: "DELETE" }),

  // Per-item image upload (FAQ covers, etc.). The caller stores the returned
  // URL on a row; the row's delete path on the server unlinks the file.
  uploadImage: (tag: string, data: string, mime: string) =>
    authFetch<{ url: string }>(`/api/admin/uploads/${encodeURIComponent(tag)}`, {
      method: "POST",
      body: JSON.stringify({ data, mime }),
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
  // Generic admin CRUD against any /api/admin/* resource root.
  adminList: <T>(path: string) => authFetch<T[]>(path),
  adminCreate: <T>(path: string, data: Record<string, unknown>) =>
    authFetch<T>(path, { method: "POST", body: JSON.stringify(data) }),
  adminUpdate: <T>(path: string, id: number, data: Record<string, unknown>) =>
    authFetch<T>(`${path}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDelete: (path: string, id: number) =>
    authFetch<null>(`${path}/${id}`, { method: "DELETE" }),

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
