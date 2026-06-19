import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  getToken,
  setToken,
  clearToken,
  type Section,
  type SectionType,
  type Item,
} from "../lib/api";

type FieldType = "text" | "textarea" | "number" | "checkbox" | "image";
interface Field {
  name: string;
  label: string;
  type: FieldType;
  // For image fields: the upload tag used to namespace the file on disk.
  uploadTag?: string;
}

const TYPE_LABEL: Record<SectionType, string> = {
  articles: "Articles",
  lyrics: "Song lyrics",
  media: "YouTube videos",
  catalog: "Book catalog",
  faq: "Book FAQs",
};

const TYPE_FIELDS: Record<SectionType, Field[]> = {
  articles: [
    { name: "title", label: "Title", type: "text" },
    { name: "body", label: "Body", type: "textarea" },
  ],
  lyrics: [
    { name: "title", label: "Title", type: "text" },
    { name: "body", label: "Lyrics (separate verses with a blank line)", type: "textarea" },
  ],
  media: [
    { name: "category", label: "Category", type: "text" },
    { name: "title", label: "Title", type: "text" },
    { name: "youtube_url", label: "YouTube URL", type: "text" },
    { name: "is_playlist", label: "This link is a playlist", type: "checkbox" },
  ],
  catalog: [
    { name: "title", label: "Title", type: "text" },
    { name: "author", label: "Author", type: "text" },
    { name: "year", label: "Year written", type: "number" },
    { name: "category", label: "Category", type: "text" },
    { name: "description", label: "Summary", type: "textarea" },
  ],
  faq: [
    { name: "question", label: "Question", type: "text" },
    { name: "book_title", label: "Book title", type: "text" },
    { name: "quote", label: "Quote", type: "textarea" },
    { name: "location", label: "Location (e.g. page 42)", type: "text" },
    { name: "cover_url", label: "Book cover", type: "image", uploadTag: "faq-cover" },
  ],
};

type View = "home" | "settings" | "sections" | "content" | "background";

// Fields for the standalone background-audio tracks editor (not tied to a section).
const BG_FIELDS: Field[] = [
  { name: "title", label: "Title", type: "text" },
  { name: "youtube_url", label: "YouTube URL", type: "text" },
];

export function Admin() {
  const [token, setTok] = useState<string | null>(getToken());
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [view, setView] = useState<View>("home");
  const [sections, setSections] = useState<Section[]>([]);
  const [settings, setSettings] = useState({ title: "", subtitle: "", hero: "" });
  const [heroUploading, setHeroUploading] = useState(false);

  const [active, setActive] = useState<Section | null>(null); // content view
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null); // item editor
  const [sectionForm, setSectionForm] = useState<
    { id?: number; type: SectionType; name: string } | null
  >(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgUploading, setImgUploading] = useState(false);

  // Background-audio tracks (standalone, not tied to a section).
  const [bgTracks, setBgTracks] = useState<Item[]>([]);
  const [bgDraft, setBgDraft] = useState<Record<string, unknown> | null>(null);
  const BG_PATH = "/api/admin/background/tracks";

  const signOut = useCallback(() => {
    clearToken();
    setTok(null);
    setView("home");
    setActive(null);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) signOut();
      else setError("Something went wrong. Please try again.");
    },
    [signOut],
  );

  const loadSections = useCallback(
    () => api.adminSections().then(setSections).catch(handleError),
    [handleError],
  );

  const loadBg = useCallback(
    () => api.adminList<Item>(BG_PATH).then(setBgTracks).catch(handleError),
    [handleError],
  );

  useEffect(() => {
    if (!token) return;
    loadSections();
    api
      .getSettings()
      .then((s) =>
        setSettings({
          title: s.title ?? "",
          subtitle: s.subtitle ?? "",
          hero: s.hero_image ?? "",
        }),
      )
      .catch(handleError);
  }, [token, loadSections, handleError]);

  useEffect(() => {
    if (view === "background") loadBg();
  }, [view, loadBg]);

  function blankBg(): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const f of BG_FIELDS) d[f.name] = "";
    return d;
  }

  function openBgEdit(it: Item) {
    const d: Record<string, unknown> = { id: it.id };
    for (const f of BG_FIELDS) d[f.name] = it[f.name] ?? "";
    setBgDraft(d);
  }

  async function saveBg(e: FormEvent) {
    e.preventDefault();
    if (!bgDraft) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of BG_FIELDS) payload[f.name] = bgDraft[f.name] ?? "";
      const id = bgDraft.id as number | undefined;
      if (id) await api.adminUpdate(BG_PATH, id, payload);
      else await api.adminCreate(BG_PATH, payload);
      setBgDraft(null);
      await loadBg();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function removeBg(id: number) {
    if (!confirm("Delete this background track?")) return;
    try {
      await api.adminDelete(BG_PATH, id);
      setBgTracks((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      handleError(e);
    }
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    try {
      const { token: t } = await api.login(pin);
      setToken(t);
      setTok(t);
      setPin("");
    } catch {
      setAuthError("Incorrect PIN");
      setPin("");
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Only round-trip the form fields; hero is managed separately by upload/delete
      // so it doesn't accidentally get clobbered or written under the wrong key.
      await api.saveSettings({ title: settings.title, subtitle: settings.subtitle });
      setView("home");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  // ── Hero image ────────────────────────────────────────────────────────────────
  function onHeroFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeroUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => {
      setHeroUploading(false);
      setError("Could not read that file.");
    };
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        const comma = dataUrl.indexOf(",");
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const mime =
          /data:([^;]+);base64/.exec(dataUrl.slice(0, comma))?.[1] ?? file.type ?? "image/jpeg";
        const { url } = await api.uploadHero(b64, mime);
        setSettings((s) => ({ ...s, hero: url }));
      } catch (err) {
        handleError(err);
      } finally {
        setHeroUploading(false);
        // Reset the input so the same file can be picked again later.
        e.target.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeHero() {
    if (!confirm("Remove the hero image?")) return;
    try {
      await api.deleteHero();
      setSettings((s) => ({ ...s, hero: "" }));
    } catch (e) {
      handleError(e);
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────────
  async function saveSection(e: FormEvent) {
    e.preventDefault();
    if (!sectionForm || !sectionForm.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (sectionForm.id) await api.updateSection(sectionForm.id, { name: sectionForm.name.trim() });
      else await api.createSection({ type: sectionForm.type, name: sectionForm.name.trim() });
      setSectionForm(null);
      await loadSections();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(s: Section) {
    if (!confirm(`Delete the "${s.name}" section and all its content?`)) return;
    try {
      await api.deleteSection(s.id);
      setSections((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      handleError(e);
    }
  }

  async function moveSection(s: Section, dir: "up" | "down") {
    const sorted = [...sections].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((x) => x.id === s.id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= sorted.length) return;
    const other = sorted[swap];
    try {
      await api.updateSection(s.id, { position: other.position });
      await api.updateSection(other.id, { position: s.position });
      await loadSections();
    } catch (e) {
      handleError(e);
    }
  }

  // ── Content ─────────────────────────────────────────────────────────────────
  function openContent(s: Section) {
    setActive(s);
    setView("content");
    setError(null);
    api.itemsList(s.id).then(setItems).catch(handleError);
  }

  function blankDraft(type: SectionType): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const f of TYPE_FIELDS[type]) d[f.name] = f.type === "checkbox" ? false : "";
    return d;
  }

  function openEditItem(it: Item) {
    if (!active) return;
    const d: Record<string, unknown> = { id: it.id };
    for (const f of TYPE_FIELDS[active.type]) {
      d[f.name] = f.type === "checkbox" ? Boolean(it[f.name]) : (it[f.name] ?? "");
    }
    setDraft(d);
  }

  async function saveItem(e: FormEvent) {
    e.preventDefault();
    if (!active || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of TYPE_FIELDS[active.type]) {
        const v = draft[f.name];
        if (f.type === "checkbox") payload[f.name] = v ? 1 : 0;
        else if (f.type === "number") payload[f.name] = v === "" ? null : Number(v);
        else payload[f.name] = v ?? "";
      }
      const id = draft.id as number | undefined;
      if (id) await api.updateItem(active.id, id, payload);
      else await api.createItem(active.id, payload);
      setDraft(null);
      const fresh = await api.itemsList(active.id);
      setItems(fresh);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  function onItemImage(field: Field, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !draft) return;
    setImgUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => {
      setImgUploading(false);
      setError("Could not read that file.");
    };
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        const comma = dataUrl.indexOf(",");
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const mime =
          /data:([^;]+);base64/.exec(dataUrl.slice(0, comma))?.[1] ?? file.type ?? "image/jpeg";
        const { url } = await api.uploadImage(field.uploadTag ?? "image", b64, mime);
        // The user may have cancelled or navigated; only apply if the draft
        // we read from is still the one mounted.
        setDraft((d) => (d ? { ...d, [field.name]: url } : d));
      } catch (err) {
        handleError(err);
      } finally {
        setImgUploading(false);
        e.target.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  async function deleteItem(id: number) {
    if (!active || !confirm("Delete this item?")) return;
    try {
      await api.deleteItem(active.id, id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      handleError(e);
    }
  }

  async function moveItem(item: Item, dir: "up" | "down") {
    if (!active) return;
    const labelOf = (x: Item) =>
      String(active.type === "faq" ? (x.question ?? "") : (x.title ?? ""));
    const sorted = [...items].sort((a, b) => {
      const pa = Number(a.position ?? 0);
      const pb = Number(b.position ?? 0);
      if (pa !== pb) return pa - pb;
      return labelOf(a).localeCompare(labelOf(b));
    });
    const idx = sorted.findIndex((x) => x.id === item.id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= sorted.length) return;
    const other = sorted[swap];
    const ip = Number(item.position ?? 0);
    const op = Number(other.position ?? 0);
    try {
      await api.updateItem(active.id, Number(item.id), { position: op });
      await api.updateItem(active.id, Number(other.id), { position: ip });
      const fresh = await api.itemsList(active.id);
      setItems(fresh);
    } catch (e) {
      handleError(e);
    }
  }

  // ── Render: PIN gate ──────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="admin admin--login">
        <h1 className="admin__brand">Configure this screen</h1>
        <form className="admin__pin" onSubmit={login}>
          <label htmlFor="pin">Enter PIN</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          {authError && <p className="admin__error">{authError}</p>}
          <button type="submit" className="btn btn--primary">Unlock</button>
        </form>
        <a className="remote__edit" href="/remote">Back to remote</a>
      </div>
    );
  }

  // ── Render: item editor ─────────────────────────────────────────────────────
  if (active && draft) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setDraft(null)}>Cancel</button>
          <span className="admin__title">{draft.id ? "Edit" : "New"} item</span>
          <span />
        </header>
        <form className="admin__form" onSubmit={saveItem}>
          {TYPE_FIELDS[active.type].map((f) =>
            f.type === "image" ? (
              <div key={f.name} className="admin__field">
                <span className="admin__field-label">{f.label}</span>
                {draft[f.name] ? (
                  <div className="admin__image-preview">
                    <img src={String(draft[f.name])} alt="" />
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => setDraft({ ...draft, [f.name]: "" })}
                      disabled={imgUploading}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="muted">No image set.</p>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onItemImage(f, e)}
                  disabled={imgUploading}
                />
                {imgUploading && <p className="muted">Uploading…</p>}
              </div>
            ) : (
              <label key={f.name} className={f.type === "checkbox" ? "admin__check" : ""}>
                {f.type === "checkbox" ? (
                  <>
                    <input
                      type="checkbox"
                      checked={Boolean(draft[f.name])}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.checked })}
                    />
                    {f.label}
                  </>
                ) : f.type === "textarea" ? (
                  <>
                    {f.label}
                    <textarea
                      rows={10}
                      value={String(draft[f.name] ?? "")}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                    />
                  </>
                ) : (
                  <>
                    {f.label}
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      value={String(draft[f.name] ?? "")}
                      onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                    />
                  </>
                )}
              </label>
            ),
          )}
          {error && <p className="admin__error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy || imgUploading}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    );
  }

  // ── Render: add/edit section ──────────────────────────────────────────────────
  if (sectionForm) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setSectionForm(null)}>Cancel</button>
          <span className="admin__title">{sectionForm.id ? "Rename" : "New"} section</span>
          <span />
        </header>
        <form className="admin__form" onSubmit={saveSection}>
          {!sectionForm.id && (
            <label>
              Type
              <select
                value={sectionForm.type}
                onChange={(e) =>
                  setSectionForm({ ...sectionForm, type: e.target.value as SectionType })
                }
              >
                {(Object.keys(TYPE_LABEL) as SectionType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Name
            <input
              type="text"
              value={sectionForm.name}
              onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
              autoFocus
            />
          </label>
          {error && <p className="admin__error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    );
  }

  // ── Render: settings ──────────────────────────────────────────────────────────
  if (view === "settings") {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setView("home")}>Back</button>
          <span className="admin__title">Title & subtitle</span>
          <span />
        </header>
        <form className="admin__form" onSubmit={saveSettings}>
          <label>
            Title
            <input
              type="text"
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
            />
          </label>
          <label>
            Subtitle
            <input
              type="text"
              value={settings.subtitle}
              onChange={(e) => setSettings({ ...settings, subtitle: e.target.value })}
            />
          </label>

          <div className="admin__field">
            <span className="admin__field-label">Hero image (top of home screen)</span>
            {settings.hero ? (
              <div className="admin__hero-preview">
                <img src={settings.hero} alt="Current hero" />
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={removeHero}
                  disabled={heroUploading}
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="muted">No hero image set.</p>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={onHeroFile}
              disabled={heroUploading}
            />
            {heroUploading && <p className="muted">Uploading…</p>}
          </div>

          {error && <p className="admin__error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    );
  }

  // ── Render: sections manager ────────────────────────────────────────────────
  if (view === "sections") {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setView("home")}>Back</button>
          <span className="admin__title">Sections</span>
          <span />
        </header>
        <button
          className="btn btn--primary admin__new"
          onClick={() => setSectionForm({ type: "articles", name: "" })}
        >
          + Add section
        </button>
        {error && <p className="admin__error">{error}</p>}
        <ul className="admin__list">
          {sections.map((s) => (
            <li key={s.id} className="admin__item">
              <span className="admin__item-title">
                {s.name} <span className="muted">· {TYPE_LABEL[s.type]}</span>
              </span>
              <span className="admin__item-actions">
                <button className="btn btn--small" onClick={() => moveSection(s, "up")}>↑</button>
                <button className="btn btn--small" onClick={() => moveSection(s, "down")}>↓</button>
                <button
                  className="btn btn--small"
                  onClick={() => setSectionForm({ id: s.id, type: s.type, name: s.name })}
                >
                  Rename
                </button>
                <button className="btn btn--small btn--danger" onClick={() => deleteSection(s)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
          {sections.length === 0 && <li className="muted">No sections yet.</li>}
        </ul>
      </div>
    );
  }

  // ── Render: content for the active section ──────────────────────────────────
  if (view === "content" && active) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setView("home")}>Back</button>
          <span className="admin__title">{active.name}</span>
          <span />
        </header>
        <button
          className="btn btn--primary admin__new"
          onClick={() => setDraft(blankDraft(active.type))}
        >
          + New item
        </button>
        {error && <p className="admin__error">{error}</p>}
        <ul className="admin__list">
          {items.map((it) => (
            <li key={it.id} className="admin__item">
              <span className="admin__item-title">
                {String(active.type === "faq" ? (it.question ?? "") : (it.title ?? ""))}
              </span>
              <span className="admin__item-actions">
                {(active.type === "articles" ||
                  active.type === "lyrics" ||
                  active.type === "faq") && (
                  <>
                    <button className="btn btn--small" onClick={() => moveItem(it, "up")}>↑</button>
                    <button className="btn btn--small" onClick={() => moveItem(it, "down")}>↓</button>
                  </>
                )}
                <button className="btn btn--small" onClick={() => openEditItem(it)}>Edit</button>
                <button className="btn btn--small btn--danger" onClick={() => deleteItem(it.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
          {items.length === 0 && <li className="muted">Nothing here yet.</li>}
        </ul>
      </div>
    );
  }

  // ── Render: background audio track editor ────────────────────────────────────
  if (view === "background" && bgDraft) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setBgDraft(null)}>Cancel</button>
          <span className="admin__title">{bgDraft.id ? "Edit" : "New"} track</span>
          <span />
        </header>
        <form className="admin__form" onSubmit={saveBg}>
          {BG_FIELDS.map((f) => (
            <label key={f.name}>
              {f.label}
              <input
                type="text"
                value={String(bgDraft[f.name] ?? "")}
                onChange={(e) => setBgDraft({ ...bgDraft, [f.name]: e.target.value })}
                autoFocus={f.name === "title"}
              />
            </label>
          ))}
          {error && <p className="admin__error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    );
  }

  // ── Render: background audio track list ─────────────────────────────────────
  if (view === "background") {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setView("home")}>Back</button>
          <span className="admin__title">Background audio</span>
          <span />
        </header>
        <button
          className="btn btn--primary admin__new"
          onClick={() => setBgDraft(blankBg())}
        >
          + New track
        </button>
        {error && <p className="admin__error">{error}</p>}
        <ul className="admin__list">
          {bgTracks.map((t) => (
            <li key={t.id} className="admin__item">
              <span className="admin__item-title">{String(t.title)}</span>
              <span className="admin__item-actions">
                <button className="btn btn--small" onClick={() => openBgEdit(t)}>Edit</button>
                <button className="btn btn--small btn--danger" onClick={() => removeBg(t.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
          {bgTracks.length === 0 && <li className="muted">No tracks yet.</li>}
        </ul>
      </div>
    );
  }

  // ── Render: home menu ───────────────────────────────────────────────────────
  return (
    <div className="admin">
      <header className="admin__bar">
        <a className="btn btn--small" href="/remote">Remote</a>
        <span className="admin__title">Configure</span>
        <button className="btn btn--small" onClick={signOut}>Sign out</button>
      </header>

      <div className="admin__menu">
        <button className="btn admin__menu-item" onClick={() => setView("settings")}>
          Title &amp; subtitle
        </button>
        <button className="btn admin__menu-item" onClick={() => setView("sections")}>
          Sections
        </button>
        <button className="btn admin__menu-item" onClick={() => setView("background")}>
          Background audio
        </button>
      </div>

      <h2 className="admin__subhead">Content</h2>
      <ul className="admin__list">
        {sections.map((s) => (
          <li key={s.id} className="admin__item admin__item--tappable" onClick={() => openContent(s)}>
            <span className="admin__item-title">
              {s.name} <span className="muted">· {TYPE_LABEL[s.type]}</span>
            </span>
            <span className="muted">›</span>
          </li>
        ))}
        {sections.length === 0 && <li className="muted">Add a section to start adding content.</li>}
      </ul>
    </div>
  );
}
