import { BookOpen, Code2, FileText, Image, LayoutDashboard, MessageSquare, Settings, Tags, Upload } from "lucide-react";

const adminNavItems = [
  { label: "总览", icon: LayoutDashboard },
  { label: "文章发布", icon: FileText },
  { label: "笔记发布", icon: BookOpen },
  { label: "图库发布", icon: Image },
  { label: "项目发布", icon: Code2 },
  { label: "留言管理", icon: MessageSquare },
  { label: "媒体管理", icon: Upload },
  { label: "分类标签", icon: Tags },
  { label: "系统设置", icon: Settings },
];

const adminModules = ["文章发布", "笔记发布", "图库发布", "项目发布", "留言管理", "媒体管理", "分类标签", "系统设置"];

function AdminApp() {
  return (
    <main className="admin-shell admin-shell-minimal">
      <aside className="admin-sidebar" aria-label="管理导航">
        <a className="admin-brand" href="/" aria-label="首页">
          <span>管</span>
          <strong>管理后台</strong>
        </a>
        <nav className="admin-nav">
          {adminNavItems.map(({ label, icon: Icon }, index) => (
            <button className={index === 0 ? "active" : ""} type="button" key={label} aria-current={index === 0 ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar admin-topbar-minimal">
          <h1>管理后台</h1>
        </header>

        <section className="admin-module-grid" aria-label="功能板块">
          {adminModules.map((module) => (
            <button className="admin-module-card" type="button" key={module}>{module}</button>
          ))}
        </section>

        <section className="admin-publish-grid">
          <PublishPanel title="文章发布" fields={["标题", "分类", "封面", "标签", "摘要", "正文"]} />
          <PublishPanel title="笔记发布" fields={["标题", "日期", "分类", "正文"]} />
          <PublishPanel title="图库发布" fields={["标题", "图片", "模型", "提示词"]} />
          <PublishPanel title="项目发布" fields={["名称", "仓库", "语言", "说明"]} />
        </section>
      </section>
    </main>
  );
}

function PublishPanel({ title, fields }: { title: string; fields: string[] }) {
  return (
    <article className="admin-panel admin-publish-panel">
      <header className="admin-panel-header compact"><h2>{title}</h2></header>
      <div className="admin-publish-form">
        {fields.map((field) => (
          <label className={field === "正文" || field === "提示词" || field === "说明" ? "wide" : ""} key={`${title}-${field}`}>
            {field}
            {field === "正文" || field === "提示词" || field === "说明" ? <textarea rows={4} /> : <input />}
          </label>
        ))}
        <label>
          状态
          <select defaultValue="草稿">
            <option>草稿</option>
            <option>发布</option>
            <option>定时</option>
          </select>
        </label>
      </div>
      <div className="admin-editor-actions">
        <button className="admin-secondary-button" type="button">保存</button>
        <button className="admin-primary-button" type="button">发布</button>
      </div>
    </article>
  );
}

export default AdminApp;
