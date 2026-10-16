import { useState, type FormEvent } from "react";
import { api, errorMessage, type Item, type SectionType } from "../lib/api";

export const TYPE_LABEL: Record<SectionType, string> = { articles: "Articles", lyrics: "Song lyrics", media: "YouTube videos", catalog: "Book catalog", faq: "Book FAQs" };
interface Field { name: string; label: string; type?: "textarea" | "number" | "url" | "image"; required?: boolean }
const MEDIA_FIELDS: Field[] = [
  { name: "youtube_url", label: "YouTube link", type: "url", required: true },
  { name: "title", label: "Title (optional)" },
];
const FIELDS: Record<SectionType | "background", Field[]> = {
  articles: [{ name: "title", label: "Title", required: true }, { name: "body", label: "Article", type: "textarea", required: true }],
  lyrics: [{ name: "title", label: "Title", required: true }, { name: "body", label: "Lyrics · separate verses with a blank line", type: "textarea", required: true }],
  media: [...MEDIA_FIELDS, { name: "category", label: "Category (optional)" }],
  catalog: [{ name: "title", label: "Book title", required: true }, { name: "author", label: "Author" }, { name: "year", label: "Year written", type: "number" }, { name: "category", label: "Category" }, { name: "description", label: "Summary", type: "textarea" }],
  faq: [{ name: "question", label: "Question", required: true }, { name: "book_title", label: "Book title" }, { name: "quote", label: "Quote", type: "textarea" }, { name: "location", label: "Location · for example, page 42" }, { name: "cover_url", label: "Book cover", type: "image" }],
  background: MEDIA_FIELDS,
};

export async function readImage(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) throw new Error("Choose a JPG, PNG, WebP or GIF image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Could not read this image. Please try another file."));
    reader.readAsDataURL(file);
  });
}

export function ImageField({ label, value, busy, onUpload, onRemove }: { label: string; value: string; busy: boolean; onUpload: (file: File) => void; onRemove: () => void }) {
  return <div className="image-field">
    <span className="field-label">{label}</span>
    {value && <div className="image-preview"><img src={value} alt={label} /><button type="button" className="btn btn--small btn--danger" disabled={busy} onClick={onRemove}>Remove image</button></div>}
    <label className="upload-control">{busy ? "Uploading image…" : value ? "Replace image" : "Choose an image"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>
    <p className="small muted">JPG, PNG, WebP or GIF · up to 8 MB</p>
  </div>;
}

export function ContentEditor({ type, item, onSave, onCancel, onError }: { type: SectionType | "background"; item: Item | null; onSave: (data: Record<string, unknown>) => Promise<void>; onCancel: () => void; onError: (error: unknown) => void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => Object.fromEntries(FIELDS[type].map((field) => [field.name, item?.[field.name] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const media = type === "media" || type === "background";
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    const payload = Object.fromEntries(FIELDS[type].map((field) => [field.name, field.type === "number" ? draft[field.name] === "" ? null : Number(draft[field.name]) : draft[field.name]]));
    try { await onSave(payload); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function upload(field: Field, file: File) {
    setError(null); setUploading(true);
    try {
      let data: string;
      try { data = await readImage(file); } catch (failure) { setError((failure as Error).message); return; }
      const { url } = await api.uploadImage("faq-cover", data, file.type);
      setDraft((current) => ({ ...current, [field.name]: url }));
    } catch (failure) { setError(errorMessage(failure)); onError(failure); } finally { setUploading(false); }
  }
  return <form className="panel editor-form" onSubmit={(event) => void save(event)}>
    {media && <p className="notice">{type === "background" ? "Paste a YouTube video link and save. The title and audio are prepared automatically." : "Paste a YouTube link and save. The title is filled in for you, and the video streams from YouTube when played. Playlists are detected for you."}</p>}
    <fieldset disabled={busy || uploading}>
      {FIELDS[type].map((field) => field.type === "image" ? <ImageField key={field.name} label={field.label} value={String(draft[field.name] ?? "")} busy={uploading || busy} onUpload={(file) => void upload(field, file)} onRemove={() => setDraft({ ...draft, [field.name]: "" })} /> : <label key={field.name}>{field.label}
        {field.type === "textarea" ? <textarea rows={10} required={field.required} value={String(draft[field.name] ?? "")} onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })} /> : <input type={field.type ?? "text"} required={field.required} value={String(draft[field.name] ?? "")} placeholder={field.name === "youtube_url" ? "https://www.youtube.com/…" : field.name === "title" && media ? "Use the title from YouTube" : undefined} onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })} />}
      </label>)}
    </fieldset>
    {error && <p className="notice notice--error" role="alert">{error}</p>}
    <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={busy || uploading}>{busy ? "Saving…" : "Save to library"}</button><button className="btn" type="button" disabled={busy || uploading} onClick={onCancel}>Cancel</button></div>
  </form>;
}
