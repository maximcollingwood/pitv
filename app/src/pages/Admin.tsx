import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  getToken,
  setToken,
  clearToken,
} from "../lib/api";

// ── Resource definitions drive the whole generic CMS ────────────────────────
type FieldType = "text" | "textarea" | "number" | "checkbox";
interface Field {
  name: string;
  label: string;
  type: FieldType;
}
interface Resource {
  key: string;
  label: string;
  path: string;
  titleField: string;
  fields: Field[];
}

const RESOURCES: Resource[] = [
  {
    key: "articles",
    label: "Articles",
    path: "/api/admin/articles",
    titleField: "title",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "body", label: "Body", type: "textarea" },
    ],
  },
  {
    key: "kirtans",
    label: "Kirtans",
    path: "/api/admin/kirtans",
    titleField: "title",
    fields: [
      { name: "category", label: "Category", type: "text" },
      { name: "title", label: "Title", type: "text" },
      { name: "youtube_url", label: "YouTube URL", type: "text" },
    ],
  },
  {
    key: "videos",
    label: "Videos",
    path: "/api/admin/videos",
    titleField: "title",
    fields: [
      { name: "category", label: "Category", type: "text" },
      { name: "title", label: "Title", type: "text" },
      { name: "youtube_url", label: "YouTube URL", type: "text" },
      { name: "is_playlist", label: "This link is a playlist", type: "checkbox" },
    ],
  },
  {
    key: "books",
    label: "Catalog",
    path: "/api/admin/books",
    titleField: "title",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "author", label: "Author", type: "text" },
      { name: "year", label: "Year written", type: "number" },
      { name: "category", label: "Category", type: "text" },
      { name: "description", label: "Summary", type: "textarea" },
    ],
  },
];

type Record_ = Record<string, unknown> & { id: number };

function blankDraft(resource: Resource): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const f of resource.fields) d[f.name] = f.type === "checkbox" ? false : "";
  return d;
}

export function Admin() {
  const [token, setTok] = useState<string | null>(getToken());
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [resource, setResource] = useState<Resource | null>(null);
  const [items, setItems] = useState<Record_[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    clearToken();
    setTok(null);
    setResource(null);
    setItems([]);
    setDraft(null);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) signOut();
      else setError("Something went wrong. Please try again.");
    },
    [signOut],
  );

  const load = useCallback(
    (res: Resource) => {
      api.adminList<Record_>(res.path).then(setItems).catch(handleError);
    },
    [handleError],
  );

  useEffect(() => {
    if (resource) load(resource);
  }, [resource, load]);

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

  function openNew() {
    if (resource) setDraft(blankDraft(resource));
  }

  function openEdit(item: Record_) {
    if (!resource) return;
    const d: Record<string, unknown> = {};
    for (const f of resource.fields) {
      d[f.name] = f.type === "checkbox" ? Boolean(item[f.name]) : (item[f.name] ?? "");
    }
    d.id = item.id;
    setDraft(d);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!resource || !draft) return;
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of resource.fields) {
        const v = draft[f.name];
        if (f.type === "checkbox") payload[f.name] = v ? 1 : 0;
        else if (f.type === "number") payload[f.name] = v === "" ? null : Number(v);
        else payload[f.name] = v ?? "";
      }
      const id = draft.id as number | undefined;
      if (id) await api.adminUpdate(resource.path, id, payload);
      else await api.adminCreate(resource.path, payload);
      setDraft(null);
      load(resource);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!resource) return;
    if (!confirm("Delete this item?")) return;
    setError(null);
    try {
      await api.adminDelete(resource.path, id);
      setItems((prev) => prev.filter((x) => x.id !== id)); // optimistic
    } catch (e) {
      handleError(e);
    }
  }

  // ── PIN gate ────────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="admin admin--login">
        <h1 className="admin__brand">Temple Library</h1>
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
          <button type="submit" className="btn btn--primary">
            Unlock
          </button>
        </form>
        <a className="remote__edit" href="/remote">
          Back to remote
        </a>
      </div>
    );
  }

  // ── Editor form ───────────────────────────────────────────────────────────────
  if (resource && draft) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <span className="admin__title">
            {draft.id ? "Edit" : "New"} {resource.label.toLowerCase()}
          </span>
          <span />
        </header>
        <form className="admin__form" onSubmit={save}>
          {resource.fields.map((f) => (
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

  // ── Resource list ─────────────────────────────────────────────────────────────
  if (resource) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn btn--small" onClick={() => setResource(null)}>
            Menu
          </button>
          <span className="admin__title">{resource.label}</span>
          <span />
        </header>

        <button className="btn btn--primary admin__new" onClick={openNew}>
          + New {resource.label.toLowerCase().replace(/s$/, "")}
        </button>

        {error && <p className="admin__error">{error}</p>}

        <ul className="admin__list">
          {items.map((item) => (
            <li key={item.id} className="admin__item">
              <span className="admin__item-title">{String(item[resource.titleField])}</span>
              <span className="admin__item-actions">
                <button className="btn btn--small" onClick={() => openEdit(item)}>
                  Edit
                </button>
                <button
                  className="btn btn--small btn--danger"
                  onClick={() => remove(item.id)}
                >
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

  // ── Resource menu ───────────────────────────────────────────────────────────
  return (
    <div className="admin">
      <header className="admin__bar">
        <a className="btn btn--small" href="/remote">
          Remote
        </a>
        <span className="admin__title">Manage content</span>
        <button className="btn btn--small" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="admin__menu">
        {RESOURCES.map((r) => (
          <button key={r.key} className="btn admin__menu-item" onClick={() => setResource(r)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
