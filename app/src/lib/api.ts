export type SectionType = "articles" | "lyrics" | "media" | "catalog" | "faq";
export interface Section { id: number; type: SectionType; name: string; position: number }
export interface Config { title: string; subtitle: string; dark: boolean; hero: string; wifi: { ssid: string; password: string } | null; sections: Section[] }
export type Item = Record<string, unknown> & { id: number };
export interface BgTrack { id: number; title: string; youtube_url: string; position: number }
export interface BgState { trackId: number | null; playing: boolean }
export type RemoteAction = "up" | "down" | "left" | "right" | "select" | "back" | "home";
export interface DeviceStatus {
  connected: boolean;
  updatedAt: number | string | null;
  page: string;
  title: string;
  playing: boolean;
  position: number;
  duration: number;
  error: string | null;
}
export interface MediaAsset {
  key: string;
  sourceUrl: string;
  kind: "audio" | "video";
  status: "queued" | "downloading" | "ready" | "error";
  title: string;
  playbackUrl: string | null;
  progress: number;
  error: string | null;
}
export interface MediaPlaylist {
  id: string;
  title: string;
  sourceUrl: string;
  status: MediaAsset["status"];
  error: string | null;
  videoCount: number;
}
export type SystemAction = "update" | "restart-screen" | "reset-audio" | "reboot" | "poweroff";
export interface SystemStatus {
  screen: DeviceStatus;
  version: { commit: string | null; date: string | null; subject: string | null; branch: string | null; selfUpdate: boolean };
  update: { running: boolean; startedAt: number | null; finishedAt: number | null; succeeded: boolean | null } | null;
  device: {
    hostname: string; uptimeSeconds: number; load: number;
    memory: { totalBytes: number; freeBytes: number };
    temperature: number | null;
    power: { underVoltageNow: boolean; underVoltageSinceBoot: boolean; throttledNow: boolean; throttledSinceBoot: boolean } | null;
    wifi: string | null; addresses: string[];
    disk: { totalBytes: number; freeBytes: number } | null;
  };
}
export interface LatestVersion { commit: string | null; checkedAt: number; error: string | null }
export interface MediaLibrary { assets: MediaAsset[]; playlists: MediaPlaylist[]; cacheBytes: number; cacheLimitBytes: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Cannot reach the library. Check that your phone is on the same network and try again.";
}

const TOKEN_KEY = "pitv_admin_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(url: string, options: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (authenticated) headers.set("Authorization", `Bearer ${getToken() ?? ""}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = response.status === 401 ? "Your PIN session has expired. Please unlock again."
        : `The library could not complete this request (HTTP ${response.status}).`;
      throw new ApiError(response.status, String(body?.message ?? body?.error ?? fallback));
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
const json = (method: string, data?: unknown): RequestInit => ({ method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });

export const api = {
  config: () => request<Config>("/api/config"),
  deviceStatus: (signal?: AbortSignal) => request<DeviceStatus>("/api/device/status", { signal }),
  setDark: (dark: boolean) => request<{ dark: boolean }>("/api/dark-mode", json("POST", { dark })),
  backgroundTracks: () => request<BgTrack[]>("/api/background/tracks"),
  backgroundState: () => request<BgState>("/api/background/state"),
  setBackgroundState: (state: Partial<BgState>) => request<BgState>("/api/background/state", json("POST", state)),
  getVolume: () => request<{ level: number }>("/api/system/volume"),
  setVolume: (level: number) => request<{ level: number }>("/api/system/volume", json("POST", { level })),
  press: (action: RemoteAction) => request<{ ok: boolean }>("/api/remote/press", json("POST", { action })),
  login: (pin: string) => request<{ token: string }>("/api/admin/login", json("POST", { pin })),
  getSettings: () => request<Record<string, string>>("/api/admin/settings", {}, true),
  saveSettings: (data: Record<string, string>) => request<Record<string, string>>("/api/admin/settings", json("PUT", data), true),
  uploadHero: (data: string, mime: string) => request<{ url: string }>("/api/admin/hero", json("POST", { data, mime }), true),
  deleteHero: () => request<{ ok: true }>("/api/admin/hero", json("DELETE"), true),
  uploadImage: (tag: string, data: string, mime: string) => request<{ url: string }>(`/api/admin/uploads/${encodeURIComponent(tag)}`, json("POST", { data, mime }), true),
  adminSections: () => request<Section[]>("/api/admin/sections", {}, true),
  createSection: (data: { type: SectionType; name: string }) => request<Section>("/api/admin/sections", json("POST", data), true),
  updateSection: (id: number, data: { name?: string; position?: number }) => request<Section>(`/api/admin/sections/${id}`, json("PUT", data), true),
  deleteSection: (id: number) => request<null>(`/api/admin/sections/${id}`, json("DELETE"), true),
  adminList: (path: string) => request<Item[]>(path, {}, true),
  adminCreate: (path: string, data: Record<string, unknown>) => request<Item>(path, json("POST", data), true),
  adminUpdate: (path: string, id: number, data: Record<string, unknown>) => request<Item>(`${path}/${id}`, json("PUT", data), true),
  adminDelete: (path: string, id: number) => request<null>(`${path}/${id}`, json("DELETE"), true),
  media: () => request<MediaLibrary>("/api/admin/media", {}, true),
  retryMedia: (key: string) => request<MediaAsset>(`/api/admin/media/${encodeURIComponent(key)}/retry`, json("POST"), true),
  health: (signal?: AbortSignal) => request<{ status: string }>("/api/health", { signal }),
  system: () => request<SystemStatus>("/api/admin/system", {}, true),
  systemLatest: (force = false) => request<{ latest: LatestVersion | null }>(`/api/admin/system/latest${force ? "?force=1" : ""}`, {}, true),
  updateLog: () => request<{ lines: string[] }>("/api/admin/system/update-log", {}, true),
  systemAction: (action: SystemAction) => request<{ ok: boolean }>(`/api/admin/system/${action}`, json("POST"), true),
  retryPlaylist: (id: string) => request<unknown>(`/api/playlist?list=${encodeURIComponent(id)}&retry=1`),
};
