import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ContentEditor, TYPE_LABEL } from "../components/ContentEditor";
import lotusGold from "../assets/lotus-gold.png";
import lotus from "../assets/lotus-purple.png";
import { DeviceCard } from "../components/DeviceCard";
import { Icon, type IconName } from "../components/Icon";
import { MediaPreparation } from "../components/MediaPreparation";
import { ScreenSettings } from "../components/ScreenSettings";
import { api, ApiError, clearToken, errorMessage, getToken, setToken, type Item, type Section, type SectionType } from "../lib/api";

type View = "library" | "background" | "preparation" | "settings";
type SectionDraft = { id?: number; name: string; type: SectionType };
const BG_PATH = "/api/admin/background/tracks";
const TYPE_ICON: Record<SectionType, IconName> = { articles: "book-open", lyrics: "music", media: "circle-play", catalog: "book", faq: "circle-question" };

export function Admin() {
  const [token, setSession] = useState(getToken);
  const [pin, setPin] = useState("");
  const [view, setView] = useState<View>("library");
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState<Section | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<{ item: Item | null } | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((current) => current + 1);

  const signOut = useCallback(() => {
    clearToken(); setSession(null); setView("library"); setActive(null);
    setEditing(null); setSectionDraft(null); setItems([]); setSections([]); setMessage(null);
  }, []);
  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) signOut();
    setError(errorMessage(failure));
  }, [signOut]);

  useEffect(() => {
    if (!token) return;
    const stream = new EventSource("/api/device/events");
    stream.onmessage = (event) => {
      try { if (JSON.parse(event.data).type === "library") setRevision((current) => current + 1); }
      catch { /* Ignore unsupported event frames. */ }
    };
    return () => stream.close();
  }, [token]);

  const itemPath = view === "background" ? BG_PATH : active ? `/api/admin/sections/${active.id}/items` : null;
  useEffect(() => { setLoading(true); setItems([]); }, [token, itemPath]);
  useEffect(() => {
    if (!token) return;
    let current = true;
    const request = itemPath ? api.adminList(itemPath) : api.adminSections();
    request.then((next) => {
      if (!current) return;
      if (itemPath) setItems(next as Item[]); else setSections(next as Section[]);
    }).catch((failure) => { if (current) handleError(failure); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, itemPath, revision, handleError]);

  function navigate(next: View) {
    setView(next); setActive(null); setEditing(null); setSectionDraft(null); setError(null); setMessage(null);
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const result = await api.login(pin); setToken(result.token); setSession(result.token); setPin(""); }
    catch (failure) { setError(failure instanceof ApiError && failure.status === 401 ? "That PIN did not match. Please try again." : errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function saveSection(event: FormEvent) {
    event.preventDefault(); if (!sectionDraft || !sectionDraft.name.trim()) return;
    setBusy(true); setError(null);
    try {
      if (sectionDraft.id) await api.updateSection(sectionDraft.id, { name: sectionDraft.name.trim() });
      else await api.createSection({ type: sectionDraft.type, name: sectionDraft.name.trim() });
      setSectionDraft(null); refresh(); setMessage("Section saved. The screen will update automatically.");
    } catch (failure) { handleError(failure); } finally { setBusy(false); }
  }
  async function deleteSection(section: Section) {
    if (!window.confirm(`Delete “${section.name}” and all of its content? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try { await api.deleteSection(section.id); refresh(); setMessage("Section deleted."); }
    catch (failure) { handleError(failure); } finally { setBusy(false); }
  }
  async function saveItem(data: Record<string, unknown>) {
    if (!itemPath || !editing) return;
    try {
      if (editing.item) await api.adminUpdate(itemPath, editing.item.id, data); else await api.adminCreate(itemPath, data);
      setEditing(null); refresh(); setMessage("Saved to your library.");
    } catch (failure) { handleError(failure); throw failure; }
  }
  async function deleteItem(item: Item) {
    if (!itemPath || !window.confirm(`Delete “${String(item.question || item.title || "this item")}”? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try { await api.adminDelete(itemPath, item.id); refresh(); setMessage("Item deleted."); }
    catch (failure) { handleError(failure); } finally { setBusy(false); }
  }
  async function move(index: number, direction: -1 | 1, sectionList = false) {
    const list = sectionList ? [...sections] : [...items];
    if (index + direction < 0 || index + direction >= list.length) return;
    [list[index], list[index + direction]] = [list[index + direction], list[index]];
    setBusy(true); setError(null);
    try {
      // Normalize legacy positions too: older libraries can contain tied values.
      for (let position = 0; position < list.length; position++) {
        if (Number(list[position].position) === position) continue;
        if (sectionList) await api.updateSection(list[position].id, { position });
        else if (itemPath) await api.adminUpdate(itemPath, list[position].id, { position });
      }
      refresh();
    } catch (failure) { handleError(failure); refresh(); } finally { setBusy(false); }
  }

  const itemType = view === "background" ? "background" : active?.type;
  const ordered = itemType === "background" || itemType === "articles" || itemType === "lyrics" || itemType === "faq";
  const title = sectionDraft ? sectionDraft.id ? "Rename section" : "A new collection"
    : editing ? editing.item ? "Make it yours" : view === "background" ? "Add background audio" : "Add to your collection"
    : active ? active.name : view === "background" ? "A little atmosphere"
    : view === "preparation" ? "Ready when you are" : view === "settings" ? "Your screen, your space" : "A library worth exploring";

  return <main className={`shell admin-shell ${!token ? "login-shell" : ""}`}>
    <header className="topbar">
      <Link className="wordmark" to="/remote"><img className="brand-mark" src={lotusGold} alt="" /> PiTV <span>COMPANION</span></Link>
      <Link className="text-link" to="/remote">Remote <Icon name="arrow-up-right" /></Link>
    </header>
    {!token ? <>
      <div className="page-intro"><p className="eyebrow">THE LIBRARY IS YOURS TO SHAPE</p><h1>A thoughtful space.<br /><em>A personal touch.</em></h1><p className="muted">Add something to read, watch or listen to.</p></div>
      <form className="panel login-form" onSubmit={(event) => void login(event)}>
        <img className="login-symbol" src={lotus} alt="" /><h2>Welcome back</h2><p className="muted">Enter your administrator PIN to edit the library.</p>
        <label htmlFor="pin">Administrator PIN<input id="pin" type="password" inputMode="numeric" autoComplete="current-password" required maxLength={32} value={pin} onChange={(event) => setPin(event.target.value)} disabled={busy} /></label>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? "Unlocking…" : "Unlock library"}<Icon name="arrow-right" /></button>
      </form>
    </> : <>
      <nav className="admin-nav" aria-label="Library administration">
        {([['library', 'Library'], ['background', 'Background audio'], ['preparation', 'Media status'], ['settings', 'Screen settings']] as [View, string][]).map(([id, label]) => <button key={id} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}>{label}</button>)}
        <button className="sign-out" onClick={signOut}><Icon name="lock" />Lock</button>
      </nav>
      <div className="admin-heading"><div className="page-intro"><p className="eyebrow">{active ? TYPE_LABEL[active.type] : "CURATED BY YOU"}</p><h1>{title}</h1></div><DeviceCard compact /></div>
      {error && <p className="notice notice--error" role="alert">{error}<button className="text-link" onClick={() => { setError(null); refresh(); }}>Try again</button></p>}
      {message && !error && <p className="notice notice--success" role="status">{message}<button className="text-link" aria-label="Dismiss message" onClick={() => setMessage(null)}><Icon name="xmark" /></button></p>}
      {sectionDraft ? <form className="panel editor-form" onSubmit={(event) => void saveSection(event)}>
        <fieldset disabled={busy}>
          {!sectionDraft.id && <label>Collection type<select value={sectionDraft.type} onChange={(event) => setSectionDraft({ ...sectionDraft, type: event.target.value as SectionType })}>{(Object.keys(TYPE_LABEL) as SectionType[]).map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}</select></label>}
          <label>Section name<input required autoFocus value={sectionDraft.name} onChange={(event) => setSectionDraft({ ...sectionDraft, name: event.target.value })} placeholder="For example, Words to live by" /></label>
        </fieldset>
        <div className="form-actions"><button className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save section"}</button><button className="btn" type="button" disabled={busy} onClick={() => setSectionDraft(null)}>Cancel</button></div>
      </form> : editing && itemType ? <ContentEditor key={`${itemType}-${editing.item?.id ?? "new"}`} type={itemType} item={editing.item} onSave={saveItem} onCancel={() => setEditing(null)} onError={handleError} />
      : view === "settings" ? <ScreenSettings onError={handleError} onSaved={() => setMessage("Screen settings saved.")} />
      : view === "preparation" ? <MediaPreparation onError={handleError} />
      : itemPath ? <>
        <div className="section-heading list-toolbar">{active ? <button className="text-link" onClick={() => { setActive(null); setMessage(null); }}><Icon name="arrow-left" />All sections</button> : <p className="muted">Paste a YouTube link. We’ll take care of the rest.</p>}<button className="btn btn--primary" disabled={busy} onClick={() => { setEditing({ item: null }); setMessage(null); }}><Icon name="plus" />{view === "background" ? "Add audio" : "Add content"}</button></div>
        {loading ? <p role="status">Loading your collection…</p> : items.length === 0 ? <div className="empty-state"><img className="brand-mark" src={lotus} alt="" /><h2>A little room for inspiration</h2><p>Add the first {view === "background" ? "YouTube link" : "item"} to this collection.</p></div> : <ul className="content-list">{items.map((item, index) => <li className="content-row" key={item.id}>
          <div className="content-row__main"><span className="item-number">{String(index + 1).padStart(2, "0")}</span><div><h2>{String(item.question || item.title || "YouTube import")}</h2><p className="small muted source-url">{String(item.youtube_url || item.author || item.book_title || String(item.body ?? "").slice(0, 120))}</p>{Boolean(item.is_playlist) && <span className="tag">Playlist</span>}</div></div>
          <div className="row-actions">{ordered && <><button className="btn btn--small btn--icon" disabled={busy || index === 0} aria-label={`Move item ${index + 1} up`} onClick={() => void move(index, -1)}><Icon name="arrow-up" /></button><button className="btn btn--small btn--icon" disabled={busy || index === items.length - 1} aria-label={`Move item ${index + 1} down`} onClick={() => void move(index, 1)}><Icon name="arrow-down" /></button></>}<button className="btn btn--small" disabled={busy} onClick={() => { setEditing({ item }); setMessage(null); }}>Edit</button><button className="btn btn--small btn--danger" disabled={busy} onClick={() => void deleteItem(item)}>Delete</button></div>
        </li>)}</ul>}
      </> : <>
        <div className="section-heading list-toolbar"><p className="muted">Make room for ideas that stay with you.</p><button className="btn btn--primary" disabled={busy} onClick={() => { setSectionDraft({ type: "articles", name: "" }); setMessage(null); }}><Icon name="plus" />Add section</button></div>
        {loading ? <p role="status">Opening your library…</p> : sections.length === 0 ? <div className="empty-state"><img className="brand-mark" src={lotus} alt="" /><h2>Start with a collection</h2><p>Create a section for articles, lyrics, videos, books or questions.</p></div> : <ul className="section-grid">{sections.map((section, index) => <li className="collection-card" key={section.id}>
          <button className="collection-open" onClick={() => { setActive(section); setMessage(null); }}><span className={`collection-icon collection-icon--${section.type}`} aria-hidden="true"><Icon name={TYPE_ICON[section.type]} /></span><span className="eyebrow">{TYPE_LABEL[section.type]}</span><h2>{section.name}</h2><span className="collection-link">Open collection <Icon name="arrow-right" /></span></button>
          <div className="row-actions"><button className="btn btn--small btn--icon" disabled={busy || index === 0} aria-label={`Move ${section.name} up`} onClick={() => void move(index, -1, true)}><Icon name="arrow-up" /></button><button className="btn btn--small btn--icon" disabled={busy || index === sections.length - 1} aria-label={`Move ${section.name} down`} onClick={() => void move(index, 1, true)}><Icon name="arrow-down" /></button><button className="btn btn--small" disabled={busy} onClick={() => setSectionDraft({ id: section.id, name: section.name, type: section.type })}>Rename</button><button className="btn btn--small btn--danger" disabled={busy} onClick={() => void deleteSection(section)}>Delete</button></div>
        </li>)}</ul>}
      </>}
    </>}
    <footer className="page-footer">A space for reading, listening &amp; reflection.</footer>
  </main>;
}
