import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Code2, Eye, FileText, Gamepad2, GitBranch, Image, LayoutDashboard, MessageSquare, Music2, RefreshCw, Save, Send, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const MAX_GALLERY_IMAGE_SIZE = 10 * 1024 * 1024;

const adminNavItems = [
  { label: "总览", icon: LayoutDashboard },
  { label: "文章发布", icon: FileText },
  { label: "笔记发布", icon: BookOpen },
  { label: "图库发布", icon: Image },
  { label: "项目同步", icon: Code2 },
  { label: "Steam 同步", icon: Gamepad2 },
  { label: "音乐管理", icon: Music2 },
  { label: "留言管理", icon: MessageSquare },
] as const;

type AdminSection = typeof adminNavItems[number]["label"];
type EditorMode = "write" | "preview";

type MarkdownDraft = {
  title: string;
  category: string;
  tags: string;
  summary: string;
  date: string;
  content: string;
};

type MarkdownEditorConfig = {
  section: "文章发布" | "笔记发布";
  draftKey: string;
  publishedKey?: string;
  showTags: boolean;
  showSummary: boolean;
  showDate: boolean;
};

type SimpleField = {
  key: string;
  label: string;
  kind?: "input" | "textarea";
  inputType?: "text" | "url";
  required?: boolean;
};

type SimplePublisherConfig = {
  section: "图库发布";
  draftKey: string;
  publishedKey: string;
  fields: SimpleField[];
};

type GuestbookMessage = {
  name: string;
  body: string;
  date: string;
  color?: string;
};

type GitHubRepository = {
  name: string;
  description: string;
  htmlUrl: string;
  language: string;
  updatedAt: string;
};

type GitHubOverview = {
  profile: {
    username: string;
  };
  repositories: GitHubRepository[];
  refreshedAt: string;
};

type SteamOverview = {
  gameCount: number;
  games: Array<{ appId: number }>;
  recentlyPlayed: Array<{ appId: number }>;
  refreshedAt: string;
};

type MusicPreference = {
  id: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: string;
  releaseDate: string;
  cover: string;
  href: string;
};

type GalleryCreation = {
  id: number;
  title: string;
  model: string;
  prompt: string;
  image: string;
  createdAt: string;
};

const articleEditorConfig: MarkdownEditorConfig = {
  section: "文章发布",
  draftKey: "nextalex-admin-article-draft",
  publishedKey: "nextalex-admin-published-articles",
  showTags: true,
  showSummary: true,
  showDate: false,
};

const noteEditorConfig: MarkdownEditorConfig = {
  section: "笔记发布",
  draftKey: "nextalex-admin-note-draft",
  showTags: false,
  showSummary: false,
  showDate: true,
};

const galleryPublisherConfig: SimplePublisherConfig = {
  section: "图库发布",
  draftKey: "nextalex-admin-gallery-draft",
  publishedKey: "nextalex-admin-published-gallery",
  fields: [
    { key: "title", label: "标题", required: true },
    { key: "image", label: "图片地址", inputType: "url" },
    { key: "model", label: "模型", required: true },
    { key: "prompt", label: "提示词", kind: "textarea", required: true },
  ],
};

const emptyMarkdownDraft: MarkdownDraft = {
  title: "",
  category: "Java 并发编程",
  tags: "",
  summary: "",
  date: new Date().toISOString().slice(0, 10),
  content: "",
};

function readObject<T extends object>(key: string, fallback: T): T {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Partial<T>;
    return { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

function savePublishedRecord(key: string, record: Record<string, unknown>) {
  try {
    const previous = JSON.parse(localStorage.getItem(key) || "[]") as typeof record[];
    const identity = record.title ?? record.name;
    localStorage.setItem(key, JSON.stringify([record, ...previous.filter((item) => (item.title ?? item.name) !== identity)]));
  } catch {
    localStorage.setItem(key, JSON.stringify([record]));
  }
}

function parseMarkdownImport(source: string, filename: string, current: MarkdownDraft): MarkdownDraft {
  let body = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const metadata: Record<string, string> = {};
  const frontMatter = body.match(/^---\n([\s\S]*?)\n---\n?/);

  if (frontMatter) {
    for (const line of frontMatter[1].split("\n")) {
      const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!match) continue;
      metadata[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
    body = body.slice(frontMatter[0].length).trim();
  }

  const heading = body.match(/^#\s+(.+?)\s*(?:\n|$)/);
  const title = metadata.title || heading?.[1]?.trim() || filename.replace(/\.(?:md|markdown)$/i, "").replace(/[-_]+/g, " ");
  if (!metadata.title && heading) body = body.slice(heading[0].length).trim();
  const tags = metadata.tags || metadata.tag || current.tags;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(metadata.date || "") ? metadata.date : current.date;

  return {
    ...current,
    title,
    category: metadata.category || metadata.series || current.category,
    tags: Array.isArray(tags) ? tags.join(", ") : tags,
    summary: metadata.summary || metadata.description || current.summary,
    date,
    content: body,
  };
}

function AdminApp() {
  const [activeSection, setActiveSection] = useState<AdminSection>("总览");

  function openSection(section: AdminSection) {
    setActiveSection(section);
  }

  return (
    <main className="admin-shell admin-shell-minimal">
      <aside className="admin-sidebar" aria-label="管理导航">
        <a className="admin-brand" href="/" aria-label="首页"><span>管</span><strong>管理后台</strong></a>
        <nav className="admin-nav">
          {adminNavItems.map(({ label, icon: Icon }) => (
            <button className={activeSection === label ? "active" : ""} type="button" key={label} aria-current={activeSection === label ? "page" : undefined} aria-label={label} title={label} onClick={() => openSection(label)}><Icon size={18} strokeWidth={1.9} aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
      </aside>

      <section className="admin-workspace">
        {activeSection === "总览" && <Overview openSection={openSection} />}
        {activeSection === "文章发布" && <MarkdownEditor key={activeSection} config={articleEditorConfig} back={() => openSection("总览")} />}
        {activeSection === "笔记发布" && <MarkdownEditor key={activeSection} config={noteEditorConfig} back={() => openSection("总览")} />}
        {activeSection === "图库发布" && <GalleryManager back={() => openSection("总览")} />}
        {activeSection === "项目同步" && <ProjectSync back={() => openSection("总览")} />}
        {activeSection === "Steam 同步" && <SteamSync back={() => openSection("总览")} />}
        {activeSection === "音乐管理" && <MusicManager back={() => openSection("总览")} />}
        {activeSection === "留言管理" && <GuestbookManager back={() => openSection("总览")} />}
      </section>
    </main>
  );
}

function Overview({ openSection }: { openSection: (section: AdminSection) => void }) {
  return <><header className="admin-topbar admin-topbar-minimal"><h1>管理后台</h1></header><section className="admin-module-grid" aria-label="功能板块">{adminNavItems.slice(1).map(({ label, icon: Icon }) => <button className="admin-module-card" type="button" key={label} onClick={() => openSection(label)}><Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></button>)}</section></>;
}

function WorkspaceHeader({ title, back }: { title: string; back: () => void }) {
  return <header className="admin-screen-header"><button className="admin-back-button" type="button" aria-label="返回总览" title="返回总览" onClick={back}><ArrowLeft size={18} strokeWidth={2} /></button><h1>{title}</h1></header>;
}

function MarkdownEditor({ config, back }: { config: MarkdownEditorConfig; back: () => void }) {
  const [draft, setDraft] = useState<MarkdownDraft>(() => readObject(config.draftKey, emptyMarkdownDraft));
  const [editorMode, setEditorMode] = useState<EditorMode>("write");
  const [saveState, setSaveState] = useState("");

  function updateDraft<K extends keyof MarkdownDraft>(key: K, value: MarkdownDraft[K]) {
    setDraft({ ...draft, [key]: value });
  }

  async function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setSaveState("请选择 Markdown 文件");
      return;
    }
    try {
      const imported = parseMarkdownImport(await file.text(), file.name, draft);
      if (!imported.content.trim()) throw new Error("empty markdown");
      setDraft(imported);
      setEditorMode("write");
      setSaveState(`已导入 ${file.name}`);
    } catch {
      setSaveState("Markdown 文件读取失败");
    }
  }

  async function persist(status: "draft" | "published") {
    if (!draft.title.trim() || !draft.content.trim()) {
      setSaveState("请填写标题和正文");
      return;
    }

    localStorage.setItem(config.draftKey, JSON.stringify(draft));
    if (status === "draft") {
      setSaveState("已保存");
      return;
    }

    if (config.section === "笔记发布") {
      setSaveState("发布中");
      try {
        const response = await fetch("/api/admin/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: draft.title.trim(), date: draft.date, content: draft.content.trim() }),
        });
        if (!response.ok) throw new Error("Note publication failed");
        setSaveState("已发布");
      } catch {
        setSaveState("发布失败");
      }
      return;
    }

    if (config.publishedKey) savePublishedRecord(config.publishedKey, { ...draft, status, updatedAt: new Date().toISOString() });
    setSaveState("已发布");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist("published");
  }

  return <section className="admin-editor-screen">
    <WorkspaceHeader title={config.section} back={back} />
    <form className="admin-article-editor" onSubmit={submit}>
      <div className="admin-article-meta">
        <label>标题<input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} required /></label>
        <label>分类<select value={draft.category} onChange={(event) => updateDraft("category", event.target.value)}><option>Java 并发编程</option><option>JUC 基础</option><option>异步工具箱</option><option>后端实践</option><option>系统设计</option></select></label>
        {config.showDate ? <label>日期<input type="date" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} required /></label> : <label>标签<input value={draft.tags} onChange={(event) => updateDraft("tags", event.target.value)} /></label>}
      </div>
      {config.showSummary && <label className="admin-summary-field">摘要<textarea value={draft.summary} onChange={(event) => updateDraft("summary", event.target.value)} rows={3} /></label>}
      <div className="admin-editor-toolbar" role="tablist" aria-label="正文模式"><button className={editorMode === "write" ? "active" : ""} type="button" role="tab" aria-selected={editorMode === "write"} onClick={() => setEditorMode("write")}>撰写</button><button className={editorMode === "preview" ? "active" : ""} type="button" role="tab" aria-selected={editorMode === "preview"} onClick={() => setEditorMode("preview")}><Eye size={16} aria-hidden="true" />预览</button><label className="admin-markdown-import"><Upload size={16} aria-hidden="true" />导入 Markdown<input type="file" accept=".md,.markdown,text/markdown" onChange={importMarkdown} /></label></div>
      {editorMode === "write" ? <textarea className="admin-markdown-source" aria-label="正文 Markdown" value={draft.content} onChange={(event) => updateDraft("content", event.target.value)} spellCheck={false} required /> : <article className="admin-markdown-preview markdown-content" aria-label="正文预览"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{draft.content || "# "}</ReactMarkdown></article>}
      <EditorFooter saveState={saveState} saveDraft={() => { void persist("draft"); }} />
    </form>
  </section>;
}

function GalleryManager({ back }: { back: () => void }) {
  const config = galleryPublisherConfig;
  const emptyValues = Object.fromEntries(config.fields.map((field) => [field.key, ""]));
  const [values, setValues] = useState<Record<string, string>>(emptyValues);
  const [records, setRecords] = useState<GalleryCreation[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [mode, setMode] = useState<"list" | "publish" | "edit">("list");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [saveState, setSaveState] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/gallery", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<GalleryCreation[]> : Promise.reject(new Error("gallery list failed")))
      .then((nextRecords) => { if (!cancelled) setRecords(Array.isArray(nextRecords) ? nextRecords : []); })
      .catch(() => { if (!cancelled) setSaveState("图库列表加载失败"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  function selectLocalImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveState("请选择图片文件");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_GALLERY_IMAGE_SIZE) {
      setSaveState("图片不能超过 10MB");
      event.target.value = "";
      return;
    }

    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setValues((current) => ({ ...current, image: "", imageName: file.name }));
    setSaveState("");
  }

  function resetForm() {
    setValues(emptyValues);
    setEditingId(null);
    setImageFile(null);
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview("");
  }

  function openPublishPage() {
    resetForm();
    setSaveState("");
    setMode("publish");
  }

  function editRecord(record: GalleryCreation) {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setEditingId(record.id);
    setValues({ title: record.title, model: record.model, prompt: record.prompt, image: record.image, imageName: "" });
    setImageFile(null);
    setImagePreview(record.image);
    setSaveState("");
    setMode("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitGallery() {
    if (config.fields.some((field) => field.required && !values[field.key]?.trim()) || (editingId === null && !imageFile && !values.image?.trim())) {
      setSaveState("请填写必填项");
      return;
    }
    const payload = new FormData();
    payload.set("title", values.title.trim());
    payload.set("model", values.model.trim());
    payload.set("prompt", values.prompt.trim());
    if (imageFile) payload.set("image", imageFile);
    else payload.set("image_url", values.image.trim());
    try {
      const endpoint = editingId === null ? "/api/admin/gallery" : `/api/admin/gallery/${editingId}`;
      const response = await fetch(endpoint, { method: editingId === null ? "POST" : "PUT", body: payload });
      if (!response.ok) throw new Error("Gallery upload failed");
      const saved = await response.json() as GalleryCreation;
      if (!saved.image) throw new Error("Invalid gallery response");
      if (editingId === null) {
        back();
        return;
      }
      setRecords((current) => current.map((record) => record.id === saved.id ? saved : record));
      setSaveState("已保存");
      resetForm();
      setMode("list");
    } catch {
      setSaveState(editingId === null ? "图片上传失败，请检查 OSS 配置" : "保存失败，请检查 OSS 配置");
    }
  }

  async function deleteRecord(id: number) {
    if (!window.confirm("删除这张图片？")) return;
    try {
      const response = await fetch(`/api/admin/gallery/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Gallery delete failed");
      setRecords((current) => current.filter((record) => record.id !== id));
      if (editingId === id) {
        resetForm();
        setMode("list");
      }
    } catch {
      setSaveState("删除失败");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitGallery();
  }

  const recordsPanel = <section className="admin-gallery-list" aria-label="已发布图片"><header><div><h2>已发布图片</h2><span>{records.length}</span></div><button className="admin-primary-button" type="button" onClick={openPublishPage}><Image size={16} aria-hidden="true" />发布图片</button></header>{records.length === 0 ? <p className="admin-empty-state">暂无图片</p> : <div className="admin-gallery-records">{records.map((record) => <article key={record.id}><img src={record.image} alt={record.title} /><div className="admin-gallery-record-body"><strong>{record.title}</strong><span>{record.model}</span><p>{record.prompt}</p></div><div className="admin-gallery-record-actions"><button type="button" className="admin-secondary-button" onClick={() => editRecord(record)}>编辑</button><button type="button" className="admin-delete-button" aria-label={`删除${record.title}`} title="删除" onClick={() => deleteRecord(record.id)}><Trash2 size={16} aria-hidden="true" /></button></div></article>)}</div>}</section>;
  const editorPage = <form className="admin-form-editor" onSubmit={submit}>
    <div className="admin-gallery-editor-heading"><strong>{mode === "edit" ? "编辑图片" : "发布图片"}</strong><button className="admin-secondary-button" type="button" onClick={() => { resetForm(); setMode("list"); }}>返回列表</button></div>
    <div className="admin-form-grid">{config.fields.map((field) => <label className={field.kind === "textarea" ? "wide" : ""} key={field.key}>{field.label}{field.kind === "textarea" ? <textarea value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} rows={8} required={field.required} /> : <input type={field.inputType || "text"} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} required={field.required} />}</label>)}<label className="admin-image-upload wide">本地图片<span className="admin-file-picker"><Upload size={16} aria-hidden="true" /><span>{values.imageName || "选择图片"}</span><input type="file" accept="image/*" aria-label="本地图片" onChange={selectLocalImage} /></span></label></div>
    {(imagePreview || values.image) && <figure className="admin-image-preview"><img src={imagePreview || values.image} alt={values.title || "图片预览"} /><button type="button" aria-label="移除已选图片" title="移除图片" onClick={() => { setImageFile(null); if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview); setImagePreview(""); setValues((current) => ({ ...current, image: "", imageName: "" })); }}><X size={16} aria-hidden="true" /></button></figure>}
    <footer className="admin-editor-footer"><span aria-live="polite">{saveState}</span><div><button className="admin-primary-button" type="submit"><Send size={16} aria-hidden="true" />{mode === "edit" ? "保存修改" : "发布图片"}</button></div></footer>
  </form>;

  return <section className="admin-editor-screen"><WorkspaceHeader title={mode === "list" ? "图库管理" : mode === "edit" ? "编辑图片" : "发布图片"} back={mode === "list" ? back : () => { resetForm(); setMode("list"); }} />{mode === "list" ? recordsPanel : editorPage}</section>;
}

function EditorFooter({ saveState, saveDraft }: { saveState: string; saveDraft: () => void }) {
  return <footer className="admin-editor-footer"><span aria-live="polite">{saveState}</span><div><button className="admin-secondary-button" type="button" onClick={saveDraft}><Save size={16} aria-hidden="true" />保存草稿</button><button className="admin-primary-button" type="submit"><Send size={16} aria-hidden="true" />发布</button></div></footer>;
}

function ProjectSync({ back }: { back: () => void }) {
  const [data, setData] = useState<GitHubOverview | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "failed">("idle");
  const [syncedAt, setSyncedAt] = useState("");

  async function syncProjects() {
    setSyncState("syncing");
    try {
      const response = await fetch("/api/admin/github/refresh", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("GitHub refresh request failed");
      const nextData = await response.json() as GitHubOverview;
      if (!nextData.profile?.username || !Array.isArray(nextData.repositories) || !nextData.refreshedAt) throw new Error("Invalid GitHub overview response");
      setData(nextData);
      setSyncedAt(new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date(nextData.refreshedAt)));
      setSyncState("idle");
    } catch {
      setSyncState("failed");
    }
  }

  return <section className="admin-manager-screen"><WorkspaceHeader title="项目同步" back={back} /><div className="admin-project-sync"><header><button className="admin-primary-button" type="button" onClick={syncProjects} disabled={syncState === "syncing"}><RefreshCw className={syncState === "syncing" ? "is-spinning" : ""} size={16} aria-hidden="true" />{syncState === "syncing" ? "同步中" : "同步项目"}</button>{syncedAt && <time>{syncedAt}</time>}</header>{syncState === "failed" && <p className="admin-sync-error" role="status">同步失败</p>}{data && <div className="admin-project-list">{data.repositories.slice(0, 6).map((repository) => <a href={repository.htmlUrl} target="_blank" rel="noreferrer" key={repository.htmlUrl}><GitBranch size={18} aria-hidden="true" /><div><strong>{repository.name}</strong><p>{repository.description || "暂无项目说明"}</p></div><span>{repository.language || "Repository"}</span></a>)}</div>}</div></section>;
}

function SteamSync({ back }: { back: () => void }) {
  const [data, setData] = useState<SteamOverview | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "failed">("idle");

  async function refreshSteam() {
    setSyncState("syncing");
    try {
      const response = await fetch("/api/admin/steam/refresh", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Steam refresh request failed");
      const nextData = await response.json() as SteamOverview;
      if (!Array.isArray(nextData.games) || !Array.isArray(nextData.recentlyPlayed) || !nextData.refreshedAt) throw new Error("Invalid Steam overview response");
      setData(nextData);
      setSyncState("idle");
    } catch {
      setSyncState("failed");
    }
  }

  const refreshedAt = data?.refreshedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date(data.refreshedAt)) : "";
  return <section className="admin-manager-screen"><WorkspaceHeader title="Steam 同步" back={back} /><div className="admin-project-sync"><header><button className="admin-primary-button" type="button" onClick={refreshSteam} disabled={syncState === "syncing"}><RefreshCw className={syncState === "syncing" ? "is-spinning" : ""} size={16} aria-hidden="true" />{syncState === "syncing" ? "刷新中" : "刷新 Steam"}</button>{refreshedAt && <time>{refreshedAt}</time>}</header>{syncState === "failed" && <p className="admin-sync-error" role="status">刷新失败</p>}{data && <div className="admin-steam-sync-stats"><div><strong>{data.gameCount}</strong><span>游戏库</span></div><div><strong>{data.recentlyPlayed.length}</strong><span>最近游玩</span></div></div>}</div></section>;
}

function MusicManager({ back }: { back: () => void }) {
  const [preferences, setPreferences] = useState<MusicPreference[]>([]);
  const [url, setURL] = useState("");
  const [importState, setImportState] = useState<"idle" | "importing" | "done" | "failed">("idle");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/music", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Music preference request failed");
        return response.json() as Promise<MusicPreference[]>;
      })
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Invalid music preference response");
        setPreferences(data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  async function importMusic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;
    setImportState("importing");
    try {
      const response = await fetch("/api/admin/music/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!response.ok) throw new Error("Music import failed");
      const preference = await response.json() as MusicPreference;
      if (!preference.id || !preference.title || !preference.href) throw new Error("Invalid imported music preference");
      setPreferences((current) => [preference, ...current.filter((item) => item.id !== preference.id)]);
      setURL("");
      setImportState("done");
    } catch {
      setImportState("failed");
    }
  }

  async function deleteMusic(id: number) {
    try {
      const response = await fetch(`/api/admin/music/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Music deletion failed");
      setPreferences((current) => current.filter((item) => item.id !== id));
    } catch {
      setImportState("failed");
    }
  }

  return <section className="admin-manager-screen"><WorkspaceHeader title="音乐管理" back={back} /><div className="admin-music-manager"><form className="admin-music-import" onSubmit={importMusic}><label>音乐链接<input aria-label="音乐链接" type="url" value={url} onChange={(event) => { setURL(event.target.value); setImportState("idle"); }} placeholder="Apple Music、QQ 音乐或网易云音乐链接" required /></label><button className="admin-primary-button" type="submit" disabled={importState === "importing"}>{importState === "importing" ? <RefreshCw className="is-spinning" size={16} aria-hidden="true" /> : <Music2 size={16} aria-hidden="true" />}{importState === "importing" ? "读取中" : "导入音乐"}</button></form>{importState === "done" && <p className="admin-music-status" role="status">已导入</p>}{importState === "failed" && <p className="admin-sync-error" role="status">导入失败</p>}<div className="admin-music-list">{preferences.map((preference) => <article key={preference.id}><img src={preference.cover} alt="" /><div><strong>{preference.title}</strong><p>{preference.artist}{preference.album ? ` · ${preference.album}` : ""}</p></div><button className="admin-delete-button" type="button" aria-label={`删除 ${preference.title}`} title="删除" onClick={() => deleteMusic(preference.id)}><Trash2 size={16} aria-hidden="true" /></button></article>)}</div></div></section>;
}

function GuestbookManager({ back }: { back: () => void }) {
  const [messages, setMessages] = useState<GuestbookMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("alex-guestbook") || "[]") as GuestbookMessage[];
    } catch {
      return [];
    }
  });

  function removeMessage(index: number) {
    const next = messages.filter((_, messageIndex) => messageIndex !== index);
    setMessages(next);
    localStorage.setItem("alex-guestbook", JSON.stringify(next));
  }

  return <section className="admin-manager-screen"><WorkspaceHeader title="留言管理" back={back} /><div className="admin-message-list">{messages.length > 0 ? messages.map((message, index) => <article className="admin-message-row" key={`${message.name}-${message.date}-${index}`}><div><strong>{message.name}</strong><time>{message.date}</time></div><p>{message.body}</p><button className="admin-delete-button" type="button" aria-label={`删除 ${message.name} 的留言`} title="删除" onClick={() => removeMessage(index)}><Trash2 size={16} aria-hidden="true" /></button></article>) : <p className="admin-empty-state">暂无留言</p>}</div></section>;
}

export default AdminApp;
