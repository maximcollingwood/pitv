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

type FieldType = "text" | "textarea" | "number" | "checkbox";
interface Field {
  name: string;
  label: string;
  type: FieldType;
}

const TYPE_LABEL: Record<SectionType, string> = {
  articles: "Articles",
  media: "YouTube videos",
  catalog: "Book catalog",
};

const TYPE_FIELDS: Record<SectionType, Field[]> = {
  articles: [
    { name: "title", label: "Title", type: "text" },
    { name: "body", label: "Body", type: "textarea" },
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
};

type View = "home" | "settings" | "sections" | "content";

export function Admin() {
  const [token, setTok] = useState<string | null>(getToken());
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [view, setView] = useState<View>("home");
  const [sections, setSections] = useState<Section[]>([]);
  const [settings, setSettings] = useState({ title: "", subtitle: "" });

  const [active, setActive] = useState<Section | null>(null); // content view
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null); // item editor
  const [sectionForm, setSectionForm] = useState<
    { id?: number; type: SectionType; name: string } | null
  >(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!token) return;
    loadSections();
    api
      .getSettings()
      .then((s) => setSettings({ title: s.title ?? "", subtitle: s.subtitle ?? "" }))
      .catch(handleError);
  }, [token, loadSections, handleError]);

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
      await api.saveSettings(settings);
      setView("home");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
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

  async function deleteItem(id: number) {
    if (!active || !confirm("Delete this item?")) return;
    try {
      await api.deleteItem(active.id, id);
      setItems((prev) => prev.filter((x) => x.id !== id));
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
          {TYPE_FIELDS[active.type].map((f) => (
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
          ))}
          {error && <p className="admin__error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy}>
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
              <span className="admin__item-title">{String(it.title)}</span>
              <span className="admin__item-actions">
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
