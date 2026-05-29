import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  getToken,
  setToken,
  clearToken,
  type Article,
} from "../lib/api";

type Draft = { id?: number; title: string; body: string };

export function Admin() {
  const [token, setTok] = useState<string | null>(getToken());
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(() => {
    clearToken();
    setTok(null);
    setArticles([]);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) signOut();
    },
    [signOut],
  );

  const load = useCallback(() => {
    api.adminArticles().then(setArticles).catch(handleError);
  }, [handleError]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

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

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    try {
      const payload = { title: draft.title.trim(), body: draft.body };
      if (draft.id) await api.updateArticle(draft.id, payload);
      else await api.createArticle(payload);
      setDraft(null);
      load();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this article?")) return;
    try {
      await api.deleteArticle(id);
      load();
    } catch (e) {
      handleError(e);
    }
  }

  // ── PIN gate ───────────────────────────────────────────────────────────────
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
      </div>
    );
  }

  // ── Editor form ──────────────────────────────────────────────────────────────
  if (draft) {
    return (
      <div className="admin">
        <header className="admin__bar">
          <button className="btn" onClick={() => setDraft(null)}>
            ← Cancel
          </button>
          <span className="admin__title">{draft.id ? "Edit" : "New"} article</span>
        </header>
        <form className="admin__form" onSubmit={save}>
          <label>
            Title
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              autoFocus
            />
          </label>
          <label>
            Body
            <textarea
              rows={12}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────────
  return (
    <div className="admin">
      <header className="admin__bar">
        <span className="admin__title">Articles</span>
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </header>

      <button
        className="btn btn--primary admin__new"
        onClick={() => setDraft({ title: "", body: "" })}
      >
        + New article
      </button>

      <ul className="admin__list">
        {articles.map((a) => (
          <li key={a.id} className="admin__item">
            <span className="admin__item-title">{a.title}</span>
            <span className="admin__item-actions">
              <button
                className="btn btn--small"
                onClick={() => setDraft({ id: a.id, title: a.title, body: a.body })}
              >
                Edit
              </button>
              <button
                className="btn btn--small btn--danger"
                onClick={() => remove(a.id)}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
        {articles.length === 0 && <li className="muted">No articles yet.</li>}
      </ul>
    </div>
  );
}
