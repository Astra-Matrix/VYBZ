import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Download, GitBranch, HardDriveDownload, ArrowLeft } from "lucide-react";
import { apiRequest, fmtBytes, fmtDate, slugFromName, type Org } from "./consoleApi";

type Repo = { id: string; name: string; slug: string; description: string | null; daw: string | null; default_branch: string; created_at: string; updated_at: string };
type Branch = { name: string; head_sha: string | null; updated_at: string };
type Commit = { id: string; sha: string; parent_sha: string | null; tree_sha: string; message: string; file_count: number; total_bytes: number; meta: Record<string, unknown>; created_at: string };
type Entry = { path: string; hash: string; size: number };
type Diff = { from: string | null; to: string; added: Entry[]; removed: Entry[]; modified: Array<{ path: string; before: string; after: string; size: number }>; summary: { added: number; removed: number; modified: number } };

const DAWS: Array<[string, string]> = [
  ["", "Not specified"], ["ableton", "Ableton Live"], ["fl-studio", "FL Studio"], ["logic", "Logic Pro"], ["pro-tools", "Pro Tools"],
  ["cubase", "Cubase"], ["reaper", "Reaper"], ["bitwig", "Bitwig"], ["studio-one", "Studio One"], ["samples", "Sample library"],
];
const dawLabel = (id: string | null) => DAWS.find(([k]) => k === id)?.[1] ?? id ?? "";
const short = (sha: string | null) => (sha ? sha.slice(0, 10) : "");

export function VaultPage({ org }: { org: Org }) {
  const { repo } = useParams();
  return repo ? <RepoView org={org} ref_={repo} /> : <RepoList org={org} />;
}

// ── Repositories ────────────────────────────────────────────────────────────

function RepoList({ org }: { org: Org }) {
  const [list, setList] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = useCallback(async () => {
    try {
      const r = await apiRequest<{ data: Repo[] }>(org.id, "GET", "/vault/repos");
      setList(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [org.id]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Vault</h1>
          <p>Content-addressed history for DAW projects and sample libraries. Every commit is a complete tree; unchanged bytes are stored once.</p>
        </div>
        <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New repository</button>
      </div>
      {error ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{error}</div> : null}
      {creating ? <CreateRepo org={org} onDone={(r) => { setCreating(false); if (r) navigate(`/console/vault/${r.slug}`); }} /> : null}

      {list === null ? <p className="vz-muted">Loading…</p> : list.length === 0 && !creating ? (
        <div className="vz-card">
          <p className="vz-p">No repositories yet. Create one here, then commit a project folder from an agent with <span className="vz-mono">vault_commit_folder</span> or from the API with <span className="vz-mono">POST /vault/repos/{"{repo}"}/commits</span>.</p>
        </div>
      ) : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead><tr><th>Repository</th><th>DAW</th><th>Default branch</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/console/vault/${r.slug}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                    <div className="vz-muted vz-mono" style={{ fontSize: 11.5, marginTop: 2 }}>{r.slug}{r.description ? ` · ${r.description}` : ""}</div>
                  </td>
                  <td>{r.daw ? <span className="vz-pill">{dawLabel(r.daw)}</span> : <span className="vz-muted">—</span>}</td>
                  <td className="vz-mono">{r.default_branch}</td>
                  <td className="vz-muted">{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CreateRepo({ org, onDone }: { org: Org; onDone: (r: Repo | null) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [daw, setDaw] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const effectiveSlug = slugTouched ? slug : slugFromName(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ name: name.trim(), slug: effectiveSlug || undefined, daw: daw || undefined, description: description.trim() || undefined });
      const r = await apiRequest<Repo>(org.id, "POST", "/vault/repos", body, { "Content-Type": "application/json" });
      onDone(r);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="vz-card" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div className="vz-grid vz-grid-2">
        <div>
          <label className="vz-label" htmlFor="vr-name">Name</label>
          <input id="vr-name" className="vz-input" required maxLength={120} placeholder="Album sessions" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="vz-label" htmlFor="vr-slug">Slug</label>
          <input id="vr-slug" className="vz-input vz-mono" maxLength={80} value={effectiveSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugFromName(e.target.value)); }} />
        </div>
      </div>
      <div className="vz-grid vz-grid-2">
        <div>
          <label className="vz-label" htmlFor="vr-daw">DAW</label>
          <select id="vr-daw" className="vz-input" value={daw} onChange={(e) => setDaw(e.target.value)}>
            {DAWS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="vz-label" htmlFor="vr-desc">Description</label>
          <input id="vr-desc" className="vz-input" maxLength={2000} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      {err ? <div className="vz-alert err">{err}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create repository"}</button>
      </div>
    </form>
  );
}

// ── One repository ───────────────────────────────────────────────────────────

function RepoView({ org, ref_ }: { org: Org; ref_: string }) {
  const [repo, setRepo] = useState<(Repo & { branches: Branch[]; commit_count: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [history, setHistory] = useState<Commit[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"history" | "files" | "changes">("history");
  const [branching, setBranching] = useState(false);

  const loadRepo = useCallback(async () => {
    try {
      const r = await apiRequest<Repo & { branches: Branch[]; commit_count: number }>(org.id, "GET", `/vault/repos/${encodeURIComponent(ref_)}`);
      setRepo(r);
      setBranch((b) => b ?? r.default_branch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [org.id, ref_]);
  useEffect(() => { void loadRepo(); }, [loadRepo]);

  useEffect(() => {
    if (!repo || !branch) return;
    setHistory(null);
    apiRequest<{ data: Commit[] }>(org.id, "GET", `/vault/repos/${repo.id}/commits?ref=${encodeURIComponent(branch)}&limit=200`)
      .then((r) => { setHistory(r.data); setSel(r.data[0]?.sha ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [org.id, repo, branch]);

  const selected = useMemo(() => history?.find((c) => c.sha === sel) ?? null, [history, sel]);

  if (error && !repo) return <div className="vz-alert err">{error}</div>;
  if (!repo) return <p className="vz-muted">Loading…</p>;

  return (
    <>
      <Link to="/console/vault" className="vz-muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 10 }}><ArrowLeft size={13} /> All repositories</Link>
      <div className="vz-page-head">
        <div>
          <h1>{repo.name}</h1>
          <p>
            <span className="vz-mono">{repo.slug}</span>
            {repo.daw ? <> · {dawLabel(repo.daw)}</> : null}
            {" · "}{repo.commit_count} {repo.commit_count === 1 ? "commit" : "commits"}
            {repo.description ? <> · {repo.description}</> : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="vz-label" htmlFor="vr-branch" style={{ margin: 0 }}>Branch</label>
          <select id="vr-branch" className="vz-input" style={{ width: "auto" }} value={branch ?? ""} onChange={(e) => setBranch(e.target.value)}>
            {repo.branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => setBranching(true)}><GitBranch size={13} /> New branch</button>
        </div>
      </div>
      {error ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{error}</div> : null}
      {branching ? <CreateBranch org={org} repo={repo} from={sel ?? branch ?? repo.default_branch} onDone={(name) => { setBranching(false); if (name) { void loadRepo().then(() => setBranch(name)); } }} /> : null}

      <div className="vz-tabs" role="tablist">
        <button type="button" role="tab" className={`vz-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
        <button type="button" role="tab" className={`vz-tab ${tab === "files" ? "active" : ""}`} onClick={() => setTab("files")} disabled={!selected}>Files{selected ? ` at ${short(selected.sha)}` : ""}</button>
        <button type="button" role="tab" className={`vz-tab ${tab === "changes" ? "active" : ""}`} onClick={() => setTab("changes")} disabled={!selected}>Changes</button>
      </div>

      {tab === "history" ? <History rows={history} sel={sel} onSelect={(sha) => { setSel(sha); setTab("files"); }} /> : null}
      {tab === "files" && selected ? <Files org={org} repo={repo} commit={selected} /> : null}
      {tab === "changes" && selected ? <Changes org={org} repo={repo} commit={selected} /> : null}
    </>
  );
}

function History({ rows, sel, onSelect }: { rows: Commit[] | null; sel: string | null; onSelect: (sha: string) => void }) {
  if (rows === null) return <p className="vz-muted">Loading…</p>;
  if (rows.length === 0) return <div className="vz-card"><p className="vz-p">This branch has no commits yet.</p></div>;
  return (
    <div className="vz-table-wrap">
      <table className="vz-table">
        <thead><tr><th>Commit</th><th>Message</th><th>Files</th><th>Size</th><th>Metadata</th><th>Created</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.sha} style={{ cursor: "pointer", background: c.sha === sel ? "var(--vz-panel)" : undefined }} onClick={() => onSelect(c.sha)}>
              <td className="vz-mono">{short(c.sha)}</td>
              <td>{c.message || <span className="vz-muted">No message</span>}</td>
              <td className="vz-mono">{c.file_count.toLocaleString()}</td>
              <td className="vz-mono">{fmtBytes(Number(c.total_bytes))}</td>
              <td className="vz-muted" style={{ fontSize: 12 }}>{metaLine(c.meta)}</td>
              <td className="vz-muted">{fmtDate(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function metaLine(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ["daw", "daw_version", "bpm", "key", "sample_rate", "author"]) {
    const v = meta?.[k];
    if (v !== undefined && v !== null && v !== "") parts.push(`${k} ${String(v)}`);
  }
  return parts.join(" · ");
}

// ── Files ────────────────────────────────────────────────────────────────────

type DirHandle = { getDirectoryHandle: (name: string, o?: { create: boolean }) => Promise<DirHandle>; getFileHandle: (name: string, o?: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
const canRestore = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

function Files({ org, repo, commit }: { org: Org; repo: Repo; commit: Commit }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  useEffect(() => {
    setEntries(null);
    apiRequest<Commit & { entries: Entry[] }>(org.id, "GET", `/vault/repos/${repo.id}/commits/${commit.sha}`)
      .then((c) => setEntries(c.entries))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id, repo.id, commit.sha]);

  const shown = useMemo(() => {
    if (!entries) return null;
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.path.toLowerCase().includes(q)) : entries;
  }, [entries, filter]);

  async function link(hash: string): Promise<string> {
    const r = await apiRequest<{ download: { url: string } }>(org.id, "GET", `/vault/repos/${repo.id}/blobs/${hash}`);
    return r.download.url;
  }
  async function download(e: Entry) {
    try {
      const url = await link(e.hash);
      const a = document.createElement("a");
      a.href = url;
      a.download = e.path.split("/").pop() ?? e.hash;
      a.rel = "noopener";
      a.click();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  }
  async function restoreAll() {
    if (!entries?.length) return;
    let root: DirHandle;
    try {
      root = await (window as unknown as { showDirectoryPicker: (o: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return;
    }
    const state = { done: 0, total: entries.length, failed: [] as string[] };
    setRestore({ ...state });
    for (const e of entries) {
      try {
        const segs = e.path.split("/");
        let dir = root;
        for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
        const res = await fetch(await link(e.hash));
        if (!res.ok) throw new Error(`${res.status}`);
        const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(await res.blob());
        await w.close();
      } catch {
        state.failed.push(e.path);
      }
      state.done++;
      setRestore({ ...state });
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input className="vz-input" style={{ maxWidth: 360 }} placeholder="Filter paths" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="vz-muted" style={{ fontSize: 12.5 }}>{entries ? `${shown?.length ?? 0} of ${entries.length} files · ${fmtBytes(Number(commit.total_bytes))}` : ""}</span>
        <span style={{ flex: 1 }} />
        {canRestore() ? (
          <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" disabled={!entries?.length || (restore !== null && restore.done < restore.total)} onClick={() => void restoreAll()} title="Write this commit's files into a folder on this machine">
            <HardDriveDownload size={13} /> Restore to folder
          </button>
        ) : null}
      </div>
      {restore ? (
        <div className={`vz-alert ${restore.done < restore.total ? "info" : restore.failed.length ? "err" : "ok"}`} style={{ marginBottom: 10 }}>
          {restore.done < restore.total ? `Restoring ${restore.done} of ${restore.total}…` : restore.failed.length ? `Restored ${restore.total - restore.failed.length} of ${restore.total}. Failed: ${restore.failed.slice(0, 5).join(", ")}${restore.failed.length > 5 ? "…" : ""}` : `Restored ${restore.total} files.`}
        </div>
      ) : null}
      {err ? <div className="vz-alert err" style={{ marginBottom: 10 }}>{err}</div> : null}
      {shown === null ? <p className="vz-muted">Loading…</p> : shown.length === 0 ? <p className="vz-muted">No files match.</p> : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead><tr><th>Path</th><th>Size</th><th>Hash</th><th /></tr></thead>
            <tbody>
              {shown.slice(0, 2000).map((e) => (
                <tr key={e.path}>
                  <td className="vz-mono" style={{ wordBreak: "break-all" }}>{e.path}</td>
                  <td className="vz-mono">{fmtBytes(e.size)}</td>
                  <td className="vz-mono vz-muted" title={e.hash}>{short(e.hash)}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => void download(e)}><Download size={12} /> Download</button></td>
                </tr>
              ))}
              {shown.length > 2000 ? <tr><td colSpan={4} className="vz-muted">Showing the first 2000. Narrow the filter to see the rest.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Changes ──────────────────────────────────────────────────────────────────

function Changes({ org, repo, commit }: { org: Org; repo: Repo; commit: Commit }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    const from = commit.parent_sha ? `from=${commit.parent_sha}&` : "";
    apiRequest<Diff>(org.id, "GET", `/vault/repos/${repo.id}/diff?${from}to=${commit.sha}`)
      .then(setDiff)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id, repo.id, commit.sha, commit.parent_sha]);

  if (err) return <div className="vz-alert err">{err}</div>;
  if (!diff) return <p className="vz-muted">Loading…</p>;
  const total = diff.summary.added + diff.summary.removed + diff.summary.modified;
  return (
    <>
      <p className="vz-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        {commit.parent_sha ? <>Against parent <span className="vz-mono">{short(commit.parent_sha)}</span>. </> : "Initial commit. "}
        {diff.summary.added} added, {diff.summary.modified} modified, {diff.summary.removed} removed.
      </p>
      {total === 0 ? <div className="vz-card"><p className="vz-p">No changes.</p></div> : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead><tr><th>Change</th><th>Path</th><th>Size</th><th>Hash</th></tr></thead>
            <tbody>
              {diff.added.map((e) => <Row key={`a${e.path}`} kind="Added" tone="mint" path={e.path} size={e.size} hash={e.hash} />)}
              {diff.modified.map((e) => <Row key={`m${e.path}`} kind="Modified" tone="" path={e.path} size={e.size} hash={`${short(e.before)} → ${short(e.after)}`} />)}
              {diff.removed.map((e) => <Row key={`r${e.path}`} kind="Removed" tone="rose" path={e.path} size={e.size} hash={e.hash} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Row({ kind, tone, path, size, hash }: { kind: string; tone: string; path: string; size: number; hash: string }) {
  return (
    <tr>
      <td><span className={`vz-pill ${tone}`}>{kind}</span></td>
      <td className="vz-mono" style={{ wordBreak: "break-all" }}>{path}</td>
      <td className="vz-mono">{fmtBytes(size)}</td>
      <td className="vz-mono vz-muted">{hash.length === 64 ? short(hash) : hash}</td>
    </tr>
  );
}

// ── Branches ─────────────────────────────────────────────────────────────────

function CreateBranch({ org, repo, from, onDone }: { org: Org; repo: Repo; from: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiRequest(org.id, "POST", `/vault/repos/${repo.id}/branches`, JSON.stringify({ name: name.trim(), from }), { "Content-Type": "application/json" });
      onDone(name.trim());
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="vz-card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
      <div>
        <label className="vz-label" htmlFor="vb-name">Branch name</label>
        <input id="vb-name" className="vz-input vz-mono" required pattern="[A-Za-z0-9._/-]{1,80}" placeholder="mix-v2" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="vz-muted" style={{ fontSize: 12, marginTop: 6 }}>Starts from <span className="vz-mono">{from.length === 64 ? short(from) : from}</span>.</p>
      </div>
      {err ? <div className="vz-alert err">{err}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create branch"}</button>
      </div>
    </form>
  );
}
