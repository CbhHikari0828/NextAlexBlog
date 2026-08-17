import { ChangeEvent, FormEvent, useState } from "react";
import { ArrowLeft, BookOpen, Code2, Eye, FileText, Gamepad2, GitBranch, Image, LayoutDashboard, MessageSquare, RefreshCw, Save, Send, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const adminNavItems = [
  { label: "总览", icon: LayoutDashboard },
  { label: "文章发布", icon: FileText },
  { label: "笔记发布", icon: BookOpen },
  { label: "图库发布", icon: Image },
  { label: "项目同步", icon: Code2 },
  { label: "Steam 同步", icon: Gamepad2 },
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
  publishedKey: string;
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

type GitHubRepositories = {
  username: string;
  repositories: GitHubRepository[];
};

type SteamOverview = {
  gameCount: number;
  games: Array<{ appId: number }>;
  recentlyPlayed: Array<{ appId: number }>;
  refreshedAt: string;
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
  publishedKey: "nextalex-admin-published-notes",
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
        {activeSection === "图库发布" && <SimplePublisher key={activeSection} config={galleryPublisherConfig} back={() => openSection("总览")} />}
        {activeSection === "项目同步" && <ProjectSync back={() => openSection("总览")} />}
        {activeSection === "Steam 同步" && <SteamSync back={() => openSection("总览")} />}
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

  function persist(status: "draft" | "published") {
    if (!draft.title.trim() || !draft.content.trim()) {
      setSaveState("请填写标题和正文");
      return;
    }

    localStorage.setItem(config.draftKey, JSON.stringify(draft));
    if (status === "published") savePublishedRecord(config.publishedKey, { ...draft, status, updatedAt: new Date().toISOString() });
    setSaveState(status === "published" ? "已发布" : "已保存");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    persist("published");
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
      <div className="admin-editor-toolbar" role="tablist" aria-label="正文模式"><button className={editorMode === "write" ? "active" : ""} type="button" role="tab" aria-selected={editorMode === "write"} onClick={() => setEditorMode("write")}>撰写</button><button className={editorMode === "preview" ? "active" : ""} type="button" role="tab" aria-selected={editorMode === "preview"} onClick={() => setEditorMode("preview")}><Eye size={16} aria-hidden="true" />预览</button></div>
      {editorMode === "write" ? <textarea className="admin-markdown-source" aria-label="正文 Markdown" value={draft.content} onChange={(event) => updateDraft("content", event.target.value)} spellCheck={false} required /> : <article className="admin-markdown-preview markdown-content" aria-label="正文预览"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{draft.content || "# "}</ReactMarkdown></article>}
      <EditorFooter saveState={saveState} saveDraft={() => persist("draft")} />
    </form>
  </section>;
}

function SimplePublisher({ config, back }: { config: SimplePublisherConfig; back: () => void }) {
  const emptyValues = Object.fromEntries(config.fields.map((field) => [field.key, ""]));
  const [values, setValues] = useState<Record<string, string>>(() => readObject(config.draftKey, emptyValues));
  const [saveState, setSaveState] = useState("");
  const isGalleryPublisher = config.section === "图库发布";

  function selectLocalImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveState("请选择图片文件");
      event.target.value = "";
      return;
    }

    if (file.size > 1024 * 1024) {
      setSaveState("图片不能超过 1MB");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const imageSource = reader.result;
      if (typeof imageSource !== "string") return;
      setValues((current) => ({ ...current, image: imageSource, imageName: file.name }));
      setSaveState("");
    });
    reader.readAsDataURL(file);
  }

  function persist(status: "draft" | "published") {
    if (config.fields.some((field) => field.required && !values[field.key]?.trim()) || (isGalleryPublisher && !values.image?.trim())) {
      setSaveState("请填写必填项");
      return;
    }

    localStorage.setItem(config.draftKey, JSON.stringify(values));
    if (status === "published") savePublishedRecord(config.publishedKey, { ...values, status, updatedAt: new Date().toISOString() });
    setSaveState(status === "published" ? "已发布" : "已保存");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    persist("published");
  }

  return <section className="admin-editor-screen"><WorkspaceHeader title={config.section} back={back} /><form className="admin-form-editor" onSubmit={submit}><div className="admin-form-grid">{config.fields.map((field) => <label className={field.kind === "textarea" ? "wide" : ""} key={field.key}>{field.label}{field.kind === "textarea" ? <textarea value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} rows={8} required={field.required} /> : <input type={field.inputType || "text"} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} required={field.required} />}</label>)}{isGalleryPublisher && <label className="admin-image-upload wide">本地图片<span className="admin-file-picker"><Upload size={16} aria-hidden="true" /><span>{values.imageName || "选择图片"}</span><input type="file" accept="image/*" aria-label="本地图片" onChange={selectLocalImage} /></span></label>}</div>{isGalleryPublisher && values.image && <figure className="admin-image-preview"><img src={values.image} alt={values.title || "图片预览"} /><button type="button" aria-label="移除已选图片" title="移除图片" onClick={() => setValues((current) => ({ ...current, image: "", imageName: "" }))}><X size={16} aria-hidden="true" /></button></figure>}<EditorFooter saveState={saveState} saveDraft={() => persist("draft")} /></form></section>;
}

function EditorFooter({ saveState, saveDraft }: { saveState: string; saveDraft: () => void }) {
  return <footer className="admin-editor-footer"><span aria-live="polite">{saveState}</span><div><button className="admin-secondary-button" type="button" onClick={saveDraft}><Save size={16} aria-hidden="true" />保存草稿</button><button className="admin-primary-button" type="submit"><Send size={16} aria-hidden="true" />发布</button></div></footer>;
}

function ProjectSync({ back }: { back: () => void }) {
  const [data, setData] = useState<GitHubRepositories | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "failed">("idle");
  const [syncedAt, setSyncedAt] = useState("");

  async function syncProjects() {
    setSyncState("syncing");
    try {
      const response = await fetch("/api/github/repositories?limit=6&refresh=1", { cache: "no-store" });
      if (!response.ok) throw new Error("GitHub repository request failed");
      const nextData = await response.json() as GitHubRepositories;
      if (!nextData.username || !Array.isArray(nextData.repositories)) throw new Error("Invalid GitHub repository response");
      setData(nextData);
      setSyncedAt(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
      setSyncState("idle");
    } catch {
      setSyncState("failed");
    }
  }

  return <section className="admin-manager-screen"><WorkspaceHeader title="项目同步" back={back} /><div className="admin-project-sync"><header><button className="admin-primary-button" type="button" onClick={syncProjects} disabled={syncState === "syncing"}><RefreshCw className={syncState === "syncing" ? "is-spinning" : ""} size={16} aria-hidden="true" />{syncState === "syncing" ? "同步中" : "同步项目"}</button>{syncedAt && <time>{syncedAt}</time>}</header>{syncState === "failed" && <p className="admin-sync-error" role="status">同步失败</p>}{data && <div className="admin-project-list">{data.repositories.map((repository) => <a href={repository.htmlUrl} target="_blank" rel="noreferrer" key={repository.htmlUrl}><GitBranch size={18} aria-hidden="true" /><div><strong>{repository.name}</strong><p>{repository.description || "暂无项目说明"}</p></div><span>{repository.language || "Repository"}</span></a>)}</div>}</div></section>;
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
