import { Activity, Bell, BookOpen, CheckCircle2, ChevronRight, FileText, Image, Inbox, LayoutDashboard, Lock, MessageSquare, PenLine, Plus, Search, Settings, Tags, Upload, Users } from "lucide-react";

const adminStats = [
  { label: "Published", value: "48", change: "+6 this month" },
  { label: "Drafts", value: "12", change: "3 ready to review" },
  { label: "Messages", value: "126", change: "18 pending" },
  { label: "Media", value: "384", change: "2.4 GB used" },
];

const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Articles", icon: FileText },
  { label: "Notes", icon: BookOpen },
  { label: "Guestbook", icon: MessageSquare },
  { label: "Media", icon: Image },
  { label: "Settings", icon: Settings },
];

const contentRows = [
  { title: "Java thread pool lifecycle", type: "Article", status: "Published", author: "Alex", updated: "Today 14:20", score: 98 },
  { title: "CompletableFuture exception flow", type: "Article", status: "Review", author: "Alex", updated: "Yesterday", score: 84 },
  { title: "Prompt Garden workspace notes", type: "Note", status: "Draft", author: "Alex", updated: "Aug 12", score: 76 },
  { title: "Gallery hero image refresh", type: "Media", status: "Scheduled", author: "Alex", updated: "Aug 10", score: 91 },
];

const reviewTasks = ["SEO title and slug", "Cover image", "Code block highlighting", "Mobile reader preview"];

function AdminApp() {
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <a className="admin-brand" href="/" aria-label="Back to public site">
          <span>A</span>
          <strong>Alex Admin</strong>
        </a>
        <nav className="admin-nav">
          {adminNavItems.map(({ label, icon: Icon, active }) => (
            <button className={active ? "active" : ""} type="button" key={label} aria-current={active ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <section className="admin-lock-card" aria-label="Security status">
          <Lock size={18} strokeWidth={2} aria-hidden="true" />
          <div>
            <strong>Protected workspace</strong>
            <span>Auth shell placeholder</span>
          </div>
        </section>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <p>Content Operations</p>
            <h1>Administrator Console</h1>
          </div>
          <label className="admin-search">
            <Search size={17} strokeWidth={2} aria-hidden="true" />
            <input placeholder="Search posts, messages, media" />
          </label>
          <div className="admin-actions">
            <button className="admin-icon-button" type="button" aria-label="Notifications"><Bell size={18} /></button>
            <button className="admin-secondary-button" type="button"><Upload size={17} />Import</button>
            <button className="admin-primary-button" type="button"><Plus size={17} />New post</button>
          </div>
        </header>

        <section className="admin-stat-grid" aria-label="Admin metrics">
          {adminStats.map((stat) => (
            <article className="admin-stat-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.change}</small>
            </article>
          ))}
        </section>

        <section className="admin-main-grid">
          <article className="admin-panel admin-content-panel">
            <header className="admin-panel-header">
              <div>
                <p>Editorial Queue</p>
                <h2>Content inventory</h2>
              </div>
              <button type="button">View all <ChevronRight size={16} /></button>
            </header>
            <div className="admin-table" role="table" aria-label="Content inventory">
              <div className="admin-table-row admin-table-head" role="row">
                <span role="columnheader">Title</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Owner</span>
                <span role="columnheader">Score</span>
              </div>
              {contentRows.map((row) => (
                <div className="admin-table-row" role="row" key={row.title}>
                  <span role="cell"><strong>{row.title}</strong><small>{row.updated}</small></span>
                  <span role="cell">{row.type}</span>
                  <span role="cell"><i className={`admin-status admin-status-${row.status.toLowerCase()}`} />{row.status}</span>
                  <span role="cell">{row.author}</span>
                  <span role="cell">{row.score}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="admin-panel admin-editor-panel">
            <header className="admin-panel-header compact">
              <div>
                <p>Composer</p>
                <h2>Draft brief</h2>
              </div>
              <PenLine size={19} strokeWidth={1.9} />
            </header>
            <label>Title<input defaultValue="Designing reliable async workflows" /></label>
            <label>Slug<input defaultValue="reliable-async-workflows" /></label>
            <label>Summary<textarea defaultValue="A concise framework for composing retries, fallbacks, and observability around async flows." rows={5} /></label>
            <div className="admin-editor-actions">
              <button className="admin-secondary-button" type="button">Save draft</button>
              <button className="admin-primary-button" type="button">Preview</button>
            </div>
          </article>

          <article className="admin-panel admin-review-panel">
            <header className="admin-panel-header compact">
              <div>
                <p>Quality Gate</p>
                <h2>Publish checklist</h2>
              </div>
              <CheckCircle2 size={20} strokeWidth={1.9} />
            </header>
            <div className="admin-checklist">
              {reviewTasks.map((task, index) => (
                <label key={task}>
                  <input type="checkbox" defaultChecked={index < 2} />
                  <span>{task}</span>
                </label>
              ))}
            </div>
          </article>

          <article className="admin-panel admin-health-panel">
            <header className="admin-panel-header compact">
              <div>
                <p>System</p>
                <h2>Service health</h2>
              </div>
              <Activity size={20} strokeWidth={1.9} />
            </header>
            <div className="admin-health-list">
              <span><Inbox size={17} /> API gateway <strong>Online</strong></span>
              <span><Tags size={17} /> Taxonomy sync <strong>Ready</strong></span>
              <span><Users size={17} /> Admin roles <strong>Pending</strong></span>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export default AdminApp;
