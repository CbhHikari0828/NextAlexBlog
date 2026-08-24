import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Code2, Eye, GitBranch, GitFork, Mail, Rss, Send, Star, Users } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import AdminApp from "./AdminApp";
import HomeDropScene from "./components/HomeDropScene";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type View = "home" | "articles" | "notes" | "gallery" | "studio" | "entertainment" | "guestbook";
type ApiState = "checking" | "online" | "offline";
type ContributionState = "loading" | "ready" | "unavailable";

const publicNavItems: { view: View; label: string }[] = [
  { view: "home", label: "主页" },
  { view: "articles", label: "文章" },
  { view: "notes", label: "笔记" },
  { view: "gallery", label: "创作图库" },
  { view: "studio", label: "创作中心" },
  { view: "entertainment", label: "娱乐" },
  { view: "guestbook", label: "留言板" },
];

type GitHubContributionDay = {
  date: string;
  count: number;
  level: number;
};

type GitHubContributions = {
  username: string;
  year: number;
  total: number;
  days: GitHubContributionDay[];
};

type RepositoryState = "loading" | "ready" | "unavailable";
type SteamState = "idle" | "loading" | "ready" | "unavailable";

type GitHubRepository = {
  name: string;
  description: string;
  htmlUrl: string;
  language: string;
  stars: number;
  forks: number;
  updatedAt: string;
};

type GitHubRepositories = {
  username: string;
  repositories: GitHubRepository[];
};

type GitHubProfile = {
  username: string;
  repositoryCount: number;
  stars: number;
  forks: number;
  followers: number;
};

type SteamProfile = {
  steamId: string;
  name: string;
  profileUrl: string;
  avatarUrl: string;
  personaState: number;
};

type SteamGame = {
  appId: number;
  name: string;
  playtimeForever: number;
  playtime2Weeks: number;
};

type SteamOverview = {
  profile: SteamProfile;
  gameCount: number;
  totalPlaytime: number;
  games: SteamGame[];
  recentlyPlayed: SteamGame[];
};

type MusicPreference = {
  id?: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: string;
  releaseDate: string;
  cover: string;
  href: string;
};

const fallbackMusicPreferences: MusicPreference[] = [
  { title: "Serenade (KARINA & WINTER)", artist: "aespa", album: "SYNK : aeXIS LINE - 2026 Special Digital Single - Single", genre: "K-Pop", duration: "3:05", releaseDate: "2026-08-09", cover: "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cc/41/23/cc4123a6-c1c0-7e86-e44a-2f0cb1f0e081/aespa_aeXIS_2026_-F.jpg/486x486bb.png", href: "https://music.apple.com/cn/album/serenade-karina-winter/6797481676?i=6797481677" },
];

type ContributionCell = Omit<GitHubContributionDay, "date"> & {
  date: string | null;
};

type Article = {
  title: string;
  category: string;
  series: string;
  date: string;
  readTime: string;
  views: number;
  excerpt: string;
  content: string;
};

type ArticleHeading = {
  id: string;
  title: string;
  level: 1 | 2 | 3;
};

type Creation = {
  title: string;
  type: string;
  state: string;
  description: string;
  model: string;
  prompt: string;
  image: string;
  accent: string;
};

type Note = {
  date: string;
  year?: string;
  title: string;
  body: string;
  content: string[];
  markdown?: string;
};

type NoteRecord = {
  id: number;
  title: string;
  date: string;
  content: string;
  createdAt: string;
};

type GuestbookComment = {
  name: string;
  body: string;
  date: string;
  color: string;
};

const noteColors = ["ice", "mint", "lavender", "rose"] as const;
const steamGameColors = ["#e11d48", "#f472b6", "#fb923c", "#facc15", "#84cc16", "#10b981", "#0ea5e9", "#3b82f6", "#8b5cf6", "#a78bfa"] as const;
type NoteColor = typeof noteColors[number];
const articlesPerPage = 5;

function noteRecordToNote(record: NoteRecord): Note | null {
  const title = record.title.trim();
  const markdown = record.content.trim();
  const dateParts = record.date.split("-");
  if (!title || !markdown || dateParts.length !== 3 || !dateParts.every((part) => /^\d+$/.test(part))) return null;

  const plainParagraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/^\s*[-+>]\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  const body = plainParagraphs.join(" ").slice(0, 96) || title;

  return {
    date: `${dateParts[1].padStart(2, "0")}.${dateParts[2].padStart(2, "0")}`,
    year: dateParts[0],
    title,
    body,
    content: plainParagraphs,
    markdown,
  };
}

function buildContributionWeeks(year: number, days: GitHubContributionDay[]): ContributionCell[][] {
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const cursor = new Date(Date.UTC(year, 0, 1));
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  const end = new Date(Date.UTC(year, 11, 31));
  end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());
  const weeks: ContributionCell[][] = [];

  while (cursor <= end) {
    const week: ContributionCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = cursor.toISOString().slice(0, 10);
      const contribution = daysByDate.get(date);
      week.push(contribution ? { ...contribution } : { date: cursor.getUTCFullYear() === year ? date : null, count: 0, level: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
}

function formatRepositoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatSteamPlaytime(minutes: number) {
  return `${Math.floor(minutes / 60)} 小时`;
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

function trapModalFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return element.tabIndex >= 0 && element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" && !element.closest("[aria-hidden='true']");
  });
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function hideModalSiblings(modal: HTMLElement) {
  const siblings = Array.from(modal.parentElement?.children || []).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modal);
  const previousState = siblings.map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
  previousState.forEach(({ element }) => {
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  });

  return () => previousState.forEach(({ element, inert, ariaHidden }) => {
    element.inert = inert;
    if (ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", ariaHidden);
  });
}

function runPageTransition(update: () => void) {
  update();
}

// Dismissal is delayed only long enough for the exit animation; the ref guard
// makes repeated Escape/click events idempotent while the overlay is closing.
function useAnimatedDismiss(onDismiss: () => void, duration: number) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const dismissRef = useRef(onDismiss);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const requestDismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    if (prefersReducedMotion()) {
      dismissRef.current();
      return;
    }

    setClosing(true);
    timerRef.current = window.setTimeout(() => dismissRef.current(), duration);
  }, [duration]);

  return [closing, requestDismiss] as const;
}

const mockGuestbookComments: GuestbookComment[] = [
  { name: "林川", body: "JUC 基础系列讲得很清楚，期待线程池这一篇的完整整理。", date: "今天 10:24", color: "ice" },
  { name: "Mia", body: "图库的视觉统一得很好，首页背景和头像的组合很有辨识度。", date: "昨天 21:08", color: "rose" },
  { name: "陈默", body: "刚看完 CompletableFuture 的文章，异常处理部分正好解决了我的疑问。", date: "昨天 15:42", color: "mint" },
  { name: "Yuki", body: "创作中心的项目展示很干净，想看看 Prompt Garden 的后续版本。", date: "08.10", color: "lavender" },
  { name: "阿北", body: "文章分类很明确，查找 JUC 相关内容非常方便。", date: "08.09", color: "ice" },
  { name: "Kris", body: "留言墙这个形式不错，内容多起来以后会很有社区感。", date: "08.09", color: "mint" },
  { name: "苏杭", body: "期待更多工程实践主题，尤其是服务稳定性和并发排查。", date: "08.08", color: "rose" },
  { name: "Nora", body: "作品的配色和排版很舒服，已收藏。", date: "08.08", color: "lavender" },
  { name: "程远", body: "希望后面能增加文章目录和代码片段复制功能。", date: "08.07", color: "ice" },
  { name: "Dawn", body: "从技术文章到 AI 创作，内容方向很完整。", date: "08.06", color: "mint" },
];

const noteLayouts = [
  { x: "3%", y: "7%", tilt: -3.1, z: 5 },
  { x: "25%", y: "3%", tilt: 2.4, z: 8 },
  { x: "50%", y: "9%", tilt: -1.8, z: 4 },
  { x: "74%", y: "4%", tilt: 3.2, z: 7 },
  { x: "10%", y: "39%", tilt: 1.2, z: 9 },
  { x: "34%", y: "32%", tilt: -2.7, z: 6 },
  { x: "59%", y: "43%", tilt: 2.1, z: 10 },
  { x: "76%", y: "33%", tilt: -1.4, z: 3 },
  { x: "20%", y: "67%", tilt: 3.4, z: 2 },
  { x: "48%", y: "64%", tilt: -2.2, z: 11 },
  { x: "69%", y: "67%", tilt: 1.7, z: 1 },
  { x: "4%", y: "68%", tilt: -1.1, z: 12 },
];

function getNoteLayout(index: number) {
  const layer = Math.floor(index / noteLayouts.length);
  const layout = noteLayouts[index % noteLayouts.length];

  return {
    ...layout,
    y: `calc(${layout.y} + ${layer * 180}px)`,
    z: layout.z + layer * noteLayouts.length,
  };
}

/*
const articles: Article[] = [
  {
    title: "从可见性到有序性：并发编程的第一性原理",
    category: "Java 并发编程",
    series: "JUC 基础",
    date: "2026.08.08",
    readTime: "12 min",
    excerpt: "梳理 happens-before、锁和原子性的关系，说明 Java 线程安全的核心约束。",
    content: `## 从共享状态开始

并发问题不是由线程数量本身造成的，而是由**共享状态**和**状态转换**共同决定的。

当多个线程同时读写同一份数据时，需要明确三件事：

1. 写入是否对其他线程可见
2. 操作之间是否允许重排
3. 复合操作是否具备原子性

## happens-before

`happens-before` 不是执行时间上的先后，而是一条可见性与有序性的约束关系。

> 如果操作 A happens-before 操作 B，那么 A 的结果对 B 可见，且 A 的执行顺序排在 B 之前。

```java
private volatile boolean started;

void start() {
  started = true;
}

boolean isStarted() {
  return started;
}
```

`volatile` 适合状态标记这类简单场景。涉及多个变量的一致性时，仍需要锁或更高层的并发工具。

## 选择工具

| 场景 | 优先选择 |
| --- | --- |
| 单个状态标记 | `volatile` |
| 单变量原子更新 | `AtomicInteger` |
| 多状态一致性 | `synchronized` 或 `Lock` |

并发设计的第一步不是选工具，而是先写清楚需要被保护的状态边界。`,
  },
  {
    title: "一张图读懂 Java 线程池的生命周期",
    category: "Java 并发编程",
    series: "JUC 基础",
    date: "2026.08.01",
    readTime: "9 min",
    excerpt: "从任务提交到 Worker 退出，记录 ThreadPoolExecutor 最容易被忽略的状态变化。",
    content: `## 线程池不是任务队列

提交任务后，线程池会根据核心线程数、队列容量和最大线程数做出不同决策。

```text
提交任务 -> 核心线程 -> 工作队列 -> 非核心线程 -> 拒绝策略
```

## 观察重点

- 活跃线程数
- 队列长度
- 已完成任务数
- 拒绝次数

这些指标组合起来，才能判断问题发生在生产、排队还是消费阶段。`,
  },
  {
    title: "用 CompletableFuture 编排一次可靠的异步流程",
    category: "Java 并发编程",
    series: "异步工具箱",
    date: "2026.07.22",
    readTime: "15 min",
    excerpt: "并行、超时、降级和异常恢复，组合成可以在生产环境里落地的异步代码。",
    content: `## 组合异步流程

`CompletableFuture` 的价值在于把依赖关系直接表达为代码结构。

```java
CompletableFuture<String> profile = loadProfile(userId);
CompletableFuture<List<Order>> orders = loadOrders(userId);

return profile.thenCombine(orders, Result::new);
```

## 失败路径

异步链路需要和成功路径一样被设计：超时、降级和异常恢复应该靠近调用点，而不是散落在业务末端。`,
  },
  {
    title: "从 Redis 分布式锁想到的几个边界问题",
    category: "后端实践",
    series: "系统设计",
    date: "2026.07.14",
    readTime: "11 min",
    excerpt: "锁住的到底是什么？从租约、时钟漂移到 fencing token，重新审视分布式锁。",
    content: `## 锁住的不是代码

分布式锁真正保护的是对某个资源的写入资格。

## 租约与失效

租约到期并不意味着原持有者一定停止执行。网络延迟和进程暂停都会让“已经失效”的客户端继续发送请求。

> 因此，锁本身不足以证明写入仍然有效。

## Fencing Token

为每次持锁分配单调递增的 token，并让资源服务拒绝旧 token 的写入，才能在资源侧建立最终防线。`,
  },
];

*/

const articleBodies = {
  concurrency: [
    "## 从共享状态开始",
    "",
    "并发问题不是由线程数量本身造成的，而是由**共享状态**和**状态转换**共同决定的。",
    "",
    "当多个线程同时读写同一份数据时，需要明确三件事：",
    "",
    "1. 写入是否对其他线程可见",
    "2. 操作之间是否允许重排",
    "3. 复合操作是否具备原子性",
    "",
    "## happens-before",
    "",
    "`happens-before` 不是执行时间上的先后，而是一条可见性与有序性的约束关系。",
    "",
    "> 如果操作 A happens-before 操作 B，那么 A 的结果对 B 可见，且 A 的执行顺序排在 B 之前。",
    "",
    "```java",
    "private volatile boolean started;",
    "",
    "void start() {",
    "  started = true;",
    "}",
    "",
    "boolean isStarted() {",
    "  return started;",
    "}",
    "```",
    "",
    "`volatile` 适合状态标记这类简单场景。涉及多个变量的一致性时，仍需要锁或更高层的并发工具。",
    "",
    "## 选择工具",
    "",
    "| 场景 | 优先选择 |",
    "| --- | --- |",
    "| 单个状态标记 | `volatile` |",
    "| 单变量原子更新 | `AtomicInteger` |",
    "| 多状态一致性 | `synchronized` 或 `Lock` |",
  ].join("\n"),
  threadPool: [
    "## 线程池不是任务队列",
    "",
    "提交任务后，线程池会根据核心线程数、队列容量和最大线程数做出不同决策。",
    "",
    "```text",
    "提交任务 -> 核心线程 -> 工作队列 -> 非核心线程 -> 拒绝策略",
    "```",
    "",
    "## 观察重点",
    "",
    "- 活跃线程数",
    "- 队列长度",
    "- 已完成任务数",
    "- 拒绝次数",
  ].join("\n"),
  completableFuture: [
    "## 组合异步流程",
    "",
    "`CompletableFuture` 的价值在于把依赖关系直接表达为代码结构。",
    "",
    "```java",
    "CompletableFuture<String> profile = loadProfile(userId);",
    "CompletableFuture<List<Order>> orders = loadOrders(userId);",
    "",
    "return profile.thenCombine(orders, Result::new);",
    "```",
    "",
    "## 失败路径",
    "",
    "异步链路需要和成功路径一样被设计：超时、降级和异常恢复应该靠近调用点。",
  ].join("\n"),
  distributedLock: [
    "## 锁住的不是代码",
    "",
    "分布式锁真正保护的是对某个资源的写入资格。",
    "",
    "## 租约与失效",
    "",
    "租约到期并不意味着原持有者一定停止执行。网络延迟和进程暂停都会让已经失效的客户端继续发送请求。",
    "",
    "> 因此，锁本身不足以证明写入仍然有效。",
    "",
    "## Fencing Token",
    "",
    "为每次持锁分配单调递增的 token，并让资源服务拒绝旧 token 的写入，才能在资源侧建立最终防线。",
  ].join("\n"),
};

const articles: Article[] = [
  { title: "从可见性到有序性：并发编程的第一性原理", category: "Java 并发编程", series: "JUC 基础", date: "2026.08.08", readTime: "12 min", views: 1284, excerpt: "梳理 happens-before、锁和原子性的关系，说明 Java 线程安全的核心约束。", content: articleBodies.concurrency },
  { title: "一张图读懂 Java 线程池的生命周期", category: "Java 并发编程", series: "JUC 基础", date: "2026.08.01", readTime: "9 min", views: 967, excerpt: "从任务提交到 Worker 退出，记录 ThreadPoolExecutor 最容易被忽略的状态变化。", content: articleBodies.threadPool },
  { title: "用 CompletableFuture 编排一次可靠的异步流程", category: "Java 并发编程", series: "异步工具箱", date: "2026.07.22", readTime: "15 min", views: 742, excerpt: "并行、超时、降级和异常恢复，组合成可以在生产环境里落地的异步代码。", content: articleBodies.completableFuture },
  { title: "从 Redis 分布式锁想到的几个边界问题", category: "后端实践", series: "系统设计", date: "2026.07.14", readTime: "11 min", views: 536, excerpt: "锁住的到底是什么？从租约、时钟漂移到 fencing token，重新审视分布式锁。", content: articleBodies.distributedLock },
  { title: "并发集合的取舍：从读写比例开始判断", category: "Java 并发编程", series: "JUC 基础", date: "2026.07.05", readTime: "10 min", views: 683, excerpt: "比较 ConcurrentHashMap、CopyOnWriteArrayList 和阻塞队列的适用边界。", content: articleBodies.concurrency },
  { title: "异步任务的超时、取消与资源回收", category: "Java 并发编程", series: "异步工具箱", date: "2026.06.26", readTime: "8 min", views: 451, excerpt: "让超时不只是抛出异常，而是能够收敛任务、连接和下游资源。", content: articleBodies.completableFuture },
  { title: "一次线上死锁排查的完整路径", category: "Java 并发编程", series: "JUC 基础", date: "2026.06.18", readTime: "13 min", views: 792, excerpt: "从线程转储、锁等待图到复现策略，记录定位死锁时的关键观察点。", content: articleBodies.concurrency },
  { title: "限流器设计：保护系统，而不是拒绝用户", category: "后端实践", series: "系统设计", date: "2026.06.09", readTime: "11 min", views: 625, excerpt: "围绕入口、队列和反馈设计限流策略，让系统在高压下仍然可预测。", content: articleBodies.distributedLock },
  { title: "幂等控制如何落在接口边界", category: "后端实践", series: "系统设计", date: "2026.05.30", readTime: "9 min", views: 418, excerpt: "从请求标识、状态存储到重复提交，拆解接口幂等的实现要点。", content: articleBodies.distributedLock },
  { title: "异步链路中的异常传播与降级", category: "Java 并发编程", series: "异步工具箱", date: "2026.05.21", readTime: "14 min", views: 574, excerpt: "统一处理异常、超时和兜底结果，避免异步流程在边界处失控。", content: articleBodies.completableFuture },
];

const notes: Note[] = [
  { date: "08.11", title: "并发学习方法", body: "先识别共享状态和状态转换，再选择并发控制方案。", content: ["并发问题通常不是从锁开始，而是从共享状态开始。先明确哪些数据会被多个线程读取或修改，再标出状态变化发生的位置。", "随后根据一致性要求选择控制方式：只需要可见性时使用 volatile；需要复合操作原子性时使用同步机制或原子类；读多写少的场景则优先评估不可变对象和并发集合。", "每次引入同步都应说明它保护的状态以及释放锁后的不变量，这比单纯记忆 API 更可靠。"] },
  { date: "08.06", title: "Prompt Garden 交互调整", body: "完成项目工作区的配色和信息层级优化。", content: ["本次调整重点在于压缩无效的视觉噪声，让工作区在首次进入时先呈现任务，而不是装饰。", "配色减少为中性色和单一强调色，标题、说明和状态的层级通过字号与间距建立。交互状态只在悬停和选中时出现，避免持续争夺注意力。", "后续会继续整理移动端的列表密度和面板折叠行为。"] },
  { date: "07.29", title: "《置身事内》阅读摘要", body: "整理地方经济运行机制及其与具体决策之间的关系。", content: ["地方经济运行并不只是抽象政策的执行结果，也受到土地、融资和招商等具体工具的共同影响。", "阅读时重点关注了政府、企业和金融机构之间的协作关系：不同阶段的目标不同，资源配置的方式也会随之变化。", "这类分析框架可以帮助理解现实项目中的约束条件，而不是只从单一指标判断决策。"] },
];

const categories = ["全部文章", "Java 并发编程", "JUC 基础", "异步工具箱", "后端实践", "系统设计"];

function App() {
  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    const startedAt = performance.now();
    let completed = false;
    let releaseTimer: number | undefined;

    const completeLoading = () => {
      if (completed) return;
      completed = true;
      releaseTimer = window.setTimeout(() => setShowLoader(false), Math.max(0, 650 - (performance.now() - startedAt)));
    };

    const fallbackTimer = window.setTimeout(completeLoading, 4000);
    if (document.readyState === "complete") completeLoading();
    else window.addEventListener("load", completeLoading, { once: true });

    return () => {
      window.removeEventListener("load", completeLoading);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(releaseTimer);
    };
  }, []);

  return <>{window.location.pathname.startsWith("/admin") ? <AdminApp /> : <PublicApp />}{showLoader && <SiteLoader />}</>;
}

function SiteLoader() {
  return <div className="site-loading-screen" aria-label="加载中" role="status">
    <div className="site-loader"><span><span /><span /><span /><span /></span><div className="site-loader-base"><span /><div className="site-loader-face" /></div></div>
    <div className="site-longfazers" aria-hidden="true"><span /><span /><span /><span /></div>
  </div>;
}

function PublicApp() {
  const [view, setView] = useState<View>("home");
  const [apiState, setApiState] = useState<ApiState>("checking");
  const contributionYear = new Date().getFullYear();
  const [githubContributions, setGithubContributions] = useState<GitHubContributions | null>(null);
  const [contributionState, setContributionState] = useState<ContributionState>("loading");
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepositories | null>(null);
  const [repositoryState, setRepositoryState] = useState<RepositoryState>("loading");
  const [githubProfile, setGithubProfile] = useState<GitHubProfile | null>(null);
  const [profileState, setProfileState] = useState<RepositoryState>("loading");
  const [steamOverview, setSteamOverview] = useState<SteamOverview | null>(null);
  const [steamState, setSteamState] = useState<SteamState>("idle");
  const [musicPreferences, setMusicPreferences] = useState<MusicPreference[]>(fallbackMusicPreferences);
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false);
  const [copyNoticeVisible, setCopyNoticeVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState("全部文章");
  const [articlePage, setArticlePage] = useState(1);
  const [publishedCreations, setPublishedCreations] = useState<Creation[]>([]);
  const [publishedNotes, setPublishedNotes] = useState<Note[]>(notes);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedCreation, setSelectedCreation] = useState<Creation | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [viewSequence, setViewSequence] = useState(0);
  const [message, setMessage] = useState("");
  const [visitor, setVisitor] = useState("");
  const [comments, setComments] = useState<GuestbookComment[]>(() => {
    try {
      const storedComments = JSON.parse(localStorage.getItem("alex-guestbook") || "[]") as Partial<GuestbookComment>[];
      return storedComments.map((comment, index) => ({
        name: comment.name || "匿名访客",
        body: comment.body || "",
        date: comment.date || "刚刚",
        color: noteColors[index % noteColors.length],
      }));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("API request failed");
        setApiState("online");
      })
      .catch(() => setApiState("offline"));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/gallery", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Gallery request failed");
        return response.json() as Promise<Array<{ title: string; model: string; prompt: string; image: string }>>;
      })
      .then((records) => {
        if (!Array.isArray(records)) throw new Error("Invalid gallery response");
        setPublishedCreations(records.filter((record) => record.title && record.model && record.prompt && record.image).map((record) => ({ title: record.title, type: "AI 图像", state: "已发布", description: record.prompt, model: record.model, prompt: record.prompt, image: record.image, accent: "#ffffff" })));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPublishedCreations([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notes", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Notes request failed");
        return response.json() as Promise<NoteRecord[]>;
      })
      .then((records) => {
        if (!Array.isArray(records)) throw new Error("Invalid notes response");
        const fetchedNotes = records.map(noteRecordToNote).filter((note): note is Note => note !== null);
        setPublishedNotes(fetchedNotes.length > 0 ? fetchedNotes : notes);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/github/contributions?year=${contributionYear}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub contribution request failed");
        return response.json() as Promise<GitHubContributions>;
      })
      .then((data) => {
        if (!data.username || data.year !== contributionYear || !Array.isArray(data.days)) throw new Error("Invalid GitHub contribution response");
        setGithubContributions(data);
        setContributionState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setContributionState("unavailable");
      });

    return () => controller.abort();
  }, [contributionYear]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/github/repositories?limit=3", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub repository request failed");
        return response.json() as Promise<GitHubRepositories>;
      })
      .then((data) => {
        if (!data.username || !Array.isArray(data.repositories)) throw new Error("Invalid GitHub repository response");
        setGithubRepositories(data);
        setRepositoryState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRepositoryState("unavailable");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/github/profile", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub profile request failed");
        return response.json() as Promise<GitHubProfile>;
      })
      .then((data) => {
        if (!data.username || !Number.isFinite(data.repositoryCount) || !Number.isFinite(data.stars) || !Number.isFinite(data.forks) || !Number.isFinite(data.followers)) throw new Error("Invalid GitHub profile response");
        setGithubProfile(data);
        setProfileState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProfileState("unavailable");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (view !== "entertainment") return;

    const controller = new AbortController();
    setSteamState("loading");
    fetch("/api/steam/overview", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Steam overview request failed");
        return response.json() as Promise<SteamOverview>;
      })
      .then((data) => {
        if (!data.profile?.name || !Array.isArray(data.games) || !Array.isArray(data.recentlyPlayed)) throw new Error("Invalid Steam overview response");
        setSteamOverview(data);
        setSteamState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSteamState("unavailable");
      });

    return () => controller.abort();
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/music", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Music preference request failed");
        return response.json() as Promise<MusicPreference[]>;
      })
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Invalid music preference response");
        if (data.length > 0) setMusicPreferences(data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let hideCopyNotice: number | undefined;

    const showCopyNotice = () => {
      setCopyNoticeVisible(true);
      window.clearTimeout(hideCopyNotice);
      hideCopyNotice = window.setTimeout(() => setCopyNoticeVisible(false), 3000);
    };

    document.addEventListener("copy", showCopyNotice);
    return () => {
      document.removeEventListener("copy", showCopyNotice);
      window.clearTimeout(hideCopyNotice);
    };
  }, []);

  useEffect(() => {
    const detectDeveloperTools = () => {
      const widthDifference = window.outerWidth - window.innerWidth;
      const heightDifference = window.outerHeight - window.innerHeight;
      setDeveloperToolsOpen(widthDifference > 180 || heightDifference > 180);
    };

    detectDeveloperTools();
    window.addEventListener("resize", detectDeveloperTools);
    return () => window.removeEventListener("resize", detectDeveloperTools);
  }, []);

  const filteredArticles = useMemo(
    () => activeCategory === "全部文章" ? articles : articles.filter((article) => article.category === activeCategory || article.series === activeCategory),
    [activeCategory],
  );
  const articlePageCount = Math.max(1, Math.ceil(filteredArticles.length / articlesPerPage));
  const visibleArticlePage = Math.min(articlePage, articlePageCount);
  const paginatedArticles = useMemo(
    () => filteredArticles.slice((visibleArticlePage - 1) * articlesPerPage, visibleArticlePage * articlesPerPage),
    [filteredArticles, visibleArticlePage],
  );

  function selectArticleCategory(category: string) {
    setActiveCategory(category);
    setArticlePage(1);
  }

  function openArticle(article: Article) {
    setSelectedCreation(null);
    setSelectedNote(null);
    setSelectedArticle(article);
  }

  function openCreation(creation: Creation) {
    setSelectedArticle(null);
    setSelectedNote(null);
    setSelectedCreation(creation);
  }

  function openNote(note: Note) {
    setSelectedArticle(null);
    setSelectedCreation(null);
    setSelectedNote(note);
  }

  function navigate(nextView: View) {
    if (nextView === view && !selectedArticle && !selectedCreation && !selectedNote) return;

    runPageTransition(() => {
      setView(nextView);
      setSelectedArticle(null);
      setSelectedCreation(null);
      setSelectedNote(null);
      setViewSequence((sequence) => sequence + 1);
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function submitMessage(event: FormEvent<HTMLFormElement>, color: NoteColor) {
    event.preventDefault();
    if (!message.trim() || !visitor.trim()) return;
    const next = [{ name: visitor.trim(), body: message.trim(), date: "刚刚", color }, ...comments];
    setComments(next);
    localStorage.setItem("alex-guestbook", JSON.stringify(next));
    setMessage("");
    setVisitor("");
  }

  const viewTitle: Record<View, string> = {
    home: "个人技术与创作档案",
    articles: "技术文章",
    notes: "日常笔记",
    gallery: "AI 创作图库",
    studio: "AI 编程项目",
    entertainment: "娱乐",
    guestbook: "访客留言",
  };

  return (
    <main className={`app-shell${view === "home" ? " home-shell" : ""}${view === "articles" ? " articles-shell" : ""}${view === "notes" ? " notes-shell" : ""}${view === "gallery" ? " gallery-shell" : ""}${view === "studio" ? " studio-shell" : ""}${view === "entertainment" ? " entertainment-shell" : ""}${view === "guestbook" ? " guestbook-shell" : ""}`}>
      {(copyNoticeVisible || developerToolsOpen) && <div className="developer-tools-notice" role="status">{copyNoticeVisible ? "复制已完成，转载请标明出处" : "开发者模式已打开，请遵循 GPL 协议"}</div>}
      <header className="site-header">
        <button className="brand" onClick={() => navigate("home")} aria-label="返回首页">
          <span className="brand-mark">A</span>
          <span>ALEX / WORKS</span>
        </button>
        <nav className="main-nav" role="tablist" aria-label="主导航">
          {publicNavItems.map((item) => {
            const selected = view === item.view;
            const id = `main-nav-${item.view}`;

            return (
              <span className="cir-tabs__item" key={item.view}>
                <input
                  checked={selected}
                  className="cir-tabs__r"
                  id={id}
                  name="main-navigation"
                  onChange={() => navigate(item.view)}
                  type="radio"
                  value={item.view}
                />
                <label aria-current={selected ? "page" : undefined} aria-selected={selected} className="cir-tabs__t" htmlFor={id} role="tab">
                  {item.label}
                </label>
              </span>
            );
          })}
        </nav>
        <span className={`api-pill api-pill-${apiState}`}><span />{apiState === "online" ? "在线" : apiState === "offline" ? "离线 Demo" : "连接中"}</span>
      </header>

      <PageStage view={view} key={`${view}-${viewSequence}`}>
        {view !== "home" && view !== "guestbook" && view !== "articles" && view !== "notes" && view !== "gallery" && view !== "studio" && view !== "entertainment" && <section className="page-intro">
          <h1>{viewTitle[view]}</h1>
          <p className="intro-copy">汇集 Java 技术文章、阅读笔记、AI 图像作品和 AI 编程项目。</p>
        </section>}

        {view === "home" && <Home navigate={navigate} setSelectedArticle={openArticle} repositories={githubRepositories} repositoryState={repositoryState} />}
        {view === "articles" && (
          <Articles activeCategory={activeCategory} setActiveCategory={selectArticleCategory} paginatedArticles={paginatedArticles} articlePage={visibleArticlePage} articlePageCount={articlePageCount} setArticlePage={setArticlePage} setSelectedArticle={openArticle} />
        )}
        {view === "notes" && <Notes notes={publishedNotes} setSelectedNote={openNote} />}
        {view === "gallery" && <Gallery creations={publishedCreations} setSelectedCreation={openCreation} />}
        {view === "studio" && <Studio contributions={githubContributions} contributionState={contributionState} repositories={githubRepositories} repositoryState={repositoryState} profile={githubProfile} profileState={profileState} />}
        {view === "entertainment" && <SteamEntertainment overview={steamOverview} state={steamState} musicPreferences={musicPreferences} />}
        {view === "guestbook" && <Guestbook visitor={visitor} message={message} setVisitor={setVisitor} setMessage={setMessage} comments={comments} submitMessage={submitMessage} />}
      </PageStage>

      {selectedArticle && <ArticleReader article={selectedArticle} close={() => setSelectedArticle((current) => current === selectedArticle ? null : current)} key={selectedArticle.title} />}
      {selectedCreation && <CreationDrawer creation={selectedCreation} close={() => setSelectedCreation((current) => current === selectedCreation ? null : current)} key={selectedCreation.title} />}
      {selectedNote && <NoteDialog note={selectedNote} close={() => setSelectedNote((current) => current === selectedNote ? null : current)} key={selectedNote.title} />}

      <footer className={`site-footer${view === "notes" ? " notes-footer" : ""}${view === "studio" ? " studio-footer" : ""}`}>
        {view === "notes" ? <><span>© {new Date().getFullYear()} Alex / Works. All rights reserved.</span><span>React · Gin · PostgreSQL</span></> : view === "studio" ? <><span>© {new Date().getFullYear()} Alex / Works</span><div className="studio-footer-links"><a href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer" aria-label="GitHub"><GitBranch size={18} strokeWidth={2.1} /></a><i aria-hidden="true" /><a href="#rss">RSS</a></div></> : <><div className="footer-primary"><strong>NextAlex</strong><span>© {new Date().getFullYear()} NextAlex. All rights reserved.</span></div><div className="footer-meta"><span>Version 0.1.0</span><span>React · Gin · PostgreSQL</span></div><div className="footer-compliance"><span>ICP备案信息待配置</span><span>公安网备信息待配置</span></div></>}
      </footer>
    </main>
  );
}

function PageStage({ view, children }: { view: View; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const stage = stageRef.current;
    if (!stage || prefersReducedMotion()) return;

    gsap.from(stage, {
      autoAlpha: 0,
      y: 14,
      duration: 0.42,
      ease: "power3.out",
      clearProps: "transform,opacity,visibility",
    });
  }, { scope: stageRef });

  return <div className={`page-stage page-stage-${view}`} ref={stageRef}>{children}</div>;
}

function Home({ navigate, setSelectedArticle, repositories, repositoryState }: { navigate: (view: View) => void; setSelectedArticle: (article: Article) => void; repositories: GitHubRepositories | null; repositoryState: RepositoryState }) {
  const profileName = "NextAlex";
  const [displayedName, setDisplayedName] = useState("");
  const projects = repositories?.repositories ?? [];
  const featuredHomeArticles = articles.slice(0, 5).map((article, index) => ({
    article,
    headline: ["并发秩序", "线程池生命周期", "异步编排", "Redis 锁边界", "集合取舍"][index] ?? article.series,
  }));
  const impactPixels = useMemo(() => Array.from({ length: 118 }, (_, index) => {
    const angle = index * 2.399963 + (index % 7) * 0.08;
    const isBlob = index % 9 === 0;
    const isStreak = index % 5 === 0;
    const distance = isBlob ? 42 + (index % 6) * 16 : 82 + (index % 14) * 18;
    const baseSize = isBlob ? 18 + (index % 4) * 8 : isStreak ? 9 + (index % 3) * 4 : 6 + (index % 5) * 2;
    const width = Math.round(isStreak ? baseSize * (2.7 + (index % 4) * 0.34) : isBlob ? baseSize * 1.55 : baseSize * (1 + (index % 3) * 0.18));
    const height = Math.round(isStreak ? baseSize * 0.74 : isBlob ? baseSize * 1.18 : baseSize * (0.92 + (index % 4) * 0.1));
    return {
      x: Math.round(Math.cos(angle) * distance * (index % 4 === 0 ? 1.62 : 1.18)),
      y: Math.round(Math.abs(Math.sin(angle)) * distance * 0.66 + (index % 8) * 10 - (index % 6 === 0 ? 48 : 14)),
      size: baseSize,
      width,
      height,
      radius: isStreak ? "999px" : index % 3 === 0 ? "58% 42% 64% 36% / 44% 60% 40% 56%" : "50%",
      scale: (isBlob ? 1.75 + (index % 4) * 0.2 : isStreak ? 1.18 + (index % 5) * 0.16 : 0.88 + (index % 6) * 0.18).toFixed(2),
      rotation: (index % 2 === 0 ? 1 : -1) * (46 + index * 9),
      delay: (index % 13) * 0.006,
      duration: (0.82 + (index % 7) * 0.055).toFixed(2),
    };
  }), []);
  const homeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let nextCharacter = 0;
    const timer = window.setInterval(() => {
      nextCharacter += 1;
      setDisplayedName(profileName.slice(0, nextCharacter));
      if (nextCharacter === profileName.length) window.clearInterval(timer);
    }, 180);

    return () => window.clearInterval(timer);
  }, []);

  useGSAP(() => {
    const root = homeRef.current;
    if (!root) return;

    const background = root.querySelector<HTMLElement>(".home-background");
    const hero = root.querySelector<HTMLElement>(".home-hero");
    const heroContent = root.querySelector<HTMLElement>(".hero-content");
    const avatar = root.querySelector<HTMLElement>(".profile-avatar");
    const profileItems = Array.from(root.querySelectorAll<HTMLElement>(".profile-copy > *"));
    const recentItems = Array.from(root.querySelectorAll<HTMLElement>(".recent-article"));
    const articleSystemInner = root.querySelector<HTMLElement>(".home-article-systems-inner");
    const articleHoverBg = root.querySelector<HTMLElement>(".home-article-hover-bg");
    const articleCursor = root.querySelector<HTMLElement>(".home-article-cursor");
    const articleRows = Array.from(root.querySelectorAll<HTMLElement>(".home-article-system-row"));
    const dropScene = hero;
    const dropObject = root.querySelector<HTMLElement>(".home-drop-object");
    const dropVisual = root.querySelector<HTMLElement>(".home-drop-visual") ?? dropObject;
    const articleSystems = root.querySelector<HTMLElement>(".home-article-systems");
    const impactLayer = root.querySelector<HTMLElement>(".home-article-impact-pixels");
    const impactPixelElements = Array.from(root.querySelectorAll<HTMLElement>(".home-impact-pixel"));
    const lowerPanels = Array.from(root.querySelectorAll<HTMLElement>(".home-lower > *"));
    const lowerSection = root.querySelector<HTMLElement>(".home-lower");
    const media = gsap.matchMedia();

    media.add("(prefers-reduced-motion: no-preference)", () => {
      const cleanup: (() => void)[] = [];
      const entrance = gsap.timeline({ defaults: { ease: "power3.out" } });
      if (avatar) entrance.from(avatar, { autoAlpha: 0, scale: 0.9, duration: 0.58 });
      if (profileItems.length > 0) entrance.from(profileItems, { autoAlpha: 0, x: 22, duration: 0.48, stagger: 0.08 }, avatar ? 0.14 : 0);

      if (articleSystemInner && articleHoverBg && articleRows.length > 0) {
        gsap.set(articleHoverBg, { autoAlpha: 0, y: 0, scaleY: 0, transformOrigin: "top center", height: articleRows[0]?.offsetHeight || 94 });
        if (articleCursor) gsap.set(articleCursor, { autoAlpha: 0, scale: 0.72, xPercent: -50, yPercent: -50 });

        const cursorX = articleCursor ? gsap.quickTo(articleCursor, "x", { duration: 0.28, ease: "power3.out" }) : undefined;
        const cursorY = articleCursor ? gsap.quickTo(articleCursor, "y", { duration: 0.28, ease: "power3.out" }) : undefined;
        const activateRow = (row: HTMLElement) => {
          const containerRect = articleSystemInner.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          articleSystemInner.classList.add("is-hovering");
          articleRows.forEach((item) => item.classList.toggle("is-active", item === row));
          articleCursor?.classList.add("is-over-dark");
          gsap.to(articleRows.filter((item) => item !== row).map((item) => item.querySelector("h2")), { x: 0, duration: 0.24, ease: "power2.out", overwrite: "auto" });
          gsap.set(articleHoverBg, {
            autoAlpha: 1,
            y: rowRect.top - containerRect.top,
            height: rowRect.height,
            scaleY: 0,
          });
          gsap.to(articleHoverBg, {
            scaleY: 1,
            duration: 0.38,
            ease: "power3.out",
            overwrite: "auto",
          });
          gsap.fromTo(row.querySelector("h2"), { x: 0 }, { x: 12, duration: 0.34, ease: "power3.out", overwrite: "auto" });
        };
        const clearActiveRow = () => {
          articleSystemInner.classList.remove("is-hovering");
          articleRows.forEach((item) => item.classList.remove("is-active"));
          articleCursor?.classList.remove("is-over-dark");
          gsap.to(articleRows.map((item) => item.querySelector("h2")), { x: 0, duration: 0.22, ease: "power2.out", overwrite: "auto" });
          gsap.to(articleHoverBg, { autoAlpha: 0, scaleY: 0, duration: 0.2, ease: "power2.out", overwrite: "auto" });
          if (articleCursor) gsap.to(articleCursor, { autoAlpha: 0, scale: 0.72, duration: 0.18, ease: "power2.out", overwrite: "auto" });
        };
        const moveCursor = (event: PointerEvent) => {
          if (!articleCursor || !cursorX || !cursorY) return;
          const containerRect = articleSystemInner.getBoundingClientRect();
          cursorX(event.clientX - containerRect.left);
          cursorY(event.clientY - containerRect.top);
          const activeRow = articleRows.find((item) => item.classList.contains("is-active"));
          if (!activeRow) {
            articleCursor.classList.remove("is-over-dark");
            return;
          }
          const activeRect = activeRow.getBoundingClientRect();
          articleCursor.classList.toggle("is-over-dark", event.clientY >= activeRect.top && event.clientY <= activeRect.bottom);
        };
        const showCursor = () => {
          if (!articleCursor) return;
          gsap.to(articleCursor, { autoAlpha: 1, scale: 1, duration: 0.22, ease: "power3.out", overwrite: "auto" });
        };

        articleRows.forEach((row) => {
          const enterRow = () => activateRow(row);
          const pressRow = () => activateRow(row);
          row.addEventListener("pointerenter", enterRow);
          row.addEventListener("pointerdown", pressRow);
          cleanup.push(() => row.removeEventListener("pointerenter", enterRow));
          cleanup.push(() => row.removeEventListener("pointerdown", pressRow));
        });
        articleSystemInner.addEventListener("pointerenter", showCursor);
        articleSystemInner.addEventListener("pointermove", moveCursor);
        articleSystemInner.addEventListener("pointerleave", clearActiveRow);
        cleanup.push(() => articleSystemInner.removeEventListener("pointerenter", showCursor));
        cleanup.push(() => articleSystemInner.removeEventListener("pointermove", moveCursor));
        cleanup.push(() => articleSystemInner.removeEventListener("pointerleave", clearActiveRow));
      }

      if (dropScene && dropObject && dropVisual && articleSystems && impactLayer && impactPixelElements.length > 0) {
        let impacted = false;
        const dropStartScale = 1;
        const dropMinScale = 0.5;
        const dropMorphStart = 0.38;
        const dropMorphEnd = 0.64;
        let dropArticleStartTop = 1;
        let dropArticleImpactTop = 1;
        let dropTravelDistance = 1;
        let dropBaseHeight = 1;
        let currentDropScale = dropStartScale;
        gsap.set(dropVisual, { xPercent: -50, yPercent: -50, autoAlpha: 1, y: 0, scale: 1, rotation: -6 });
        dropVisual.style.setProperty("--drop-visual-scale", String(dropStartScale));
        dropVisual.style.setProperty("--drop-cube-progress", "0");
        gsap.set(impactLayer, { x: 0, y: 0 });
        gsap.set(impactPixelElements, { autoAlpha: 0, x: 0, y: 0, scale: 0, rotation: 0 });

        const measureDropTravel = () => {
          const ballRect = dropVisual.getBoundingClientRect();
          const articleRect = articleSystems.getBoundingClientRect();
          dropBaseHeight = Math.max(1, ballRect.height);
          dropArticleStartTop = articleRect.top + window.scrollY;
          dropArticleImpactTop = ballRect.top + ballRect.height / 2 + (dropBaseHeight * dropMinScale) / 2;
          dropTravelDistance = Math.max(1, dropArticleStartTop - dropArticleImpactTop);
        };

        const getDropScaleForArticleTop = (articleTop: number) => {
          const travelProgress = gsap.utils.clamp(0, 1, (dropArticleStartTop - articleTop) / dropTravelDistance);

          return gsap.utils.interpolate(dropStartScale, dropMinScale, travelProgress);
        };

        const syncDropScale = () => {
          if (impacted) return;
          const articleRect = articleSystems.getBoundingClientRect();
          const travelProgress = gsap.utils.clamp(0, 1, (dropArticleStartTop - articleRect.top) / dropTravelDistance);
          const nextScale = gsap.utils.interpolate(dropStartScale, dropMinScale, travelProgress);
          const morphProgress = gsap.utils.clamp(0, 1, (travelProgress - dropMorphStart) / (dropMorphEnd - dropMorphStart));

          currentDropScale = nextScale;
          dropVisual.style.setProperty("--drop-visual-scale", String(nextScale));
          dropVisual.style.setProperty("--drop-cube-progress", String(morphProgress));
        };

        measureDropTravel();

        const getVirtualDropRect = () => {
          const visualRect = dropVisual.getBoundingClientRect();
          const centerX = visualRect.left + visualRect.width / 2;
          const centerY = visualRect.top + visualRect.height / 2;
          const width = visualRect.width * currentDropScale;
          const height = visualRect.height * currentDropScale;

          return {
            left: centerX - width / 2,
            top: centerY - height / 2,
            width,
            height,
            right: centerX + width / 2,
            bottom: centerY + height / 2,
          };
        };

        const hasVisuallyHitArticle = () => {
          const ballRect = getVirtualDropRect();
          const articleRect = articleSystems.getBoundingClientRect();

          return ballRect.bottom >= articleRect.top - 4;
        };

        const hasClearedRestoredBall = () => {
          const articleRect = articleSystems.getBoundingClientRect();
          const pinRect = dropObject.getBoundingClientRect();
          const restoredScale = getDropScaleForArticleTop(articleRect.top);
          const restoredBottom = pinRect.top + pinRect.height / 2 + (dropBaseHeight * restoredScale) / 2;

          return articleRect.top > restoredBottom + 12;
        };

        const syncImpactOrigin = () => {
          const ballRect = getVirtualDropRect();
          const layerRect = impactLayer.getBoundingClientRect();
          const impactX = ballRect.left + ballRect.width / 2 - layerRect.left;
          const impactY = Math.max(0, Math.min(120, ballRect.bottom - layerRect.top));

          gsap.set(impactLayer, { x: impactX, y: impactY });
        };

        const resetImpact = () => {
          impacted = false;
          articleSystems.classList.remove("is-impacting");
          gsap.killTweensOf([dropVisual, impactPixelElements]);
          gsap.set(dropVisual, { xPercent: -50, yPercent: -50, autoAlpha: 1, y: 0, scale: 1, rotation: -6 });
          syncDropScale();
          gsap.set(impactLayer, { x: 0, y: 0 });
          gsap.set(impactPixelElements, { autoAlpha: 0, x: 0, y: 0, scale: 0, rotation: 0 });
        };

        const triggerImpact = () => {
          if (impacted) return;
          impacted = true;
          syncImpactOrigin();
          articleSystems.classList.add("is-impacting");
          gsap.timeline({ defaults: { overwrite: "auto" } })
            .to(dropVisual, { scale: 0.64, rotation: "+=18", duration: 0.08, ease: "power3.out" })
            .to(dropVisual, { autoAlpha: 0, scale: 0.04, y: "+=34", rotation: "+=52", duration: 0.2, ease: "power4.in" }, 0.04);
          gsap.fromTo(articleSystems, { y: 34, scaleY: 0.982 }, { y: 0, scaleY: 1, duration: 0.72, ease: "elastic.out(1, 0.42)", overwrite: "auto" });
          gsap.fromTo(articleRows, { y: (index) => index % 2 === 0 ? 18 : -14, scaleX: 0.992 }, { y: 0, scaleX: 1, duration: 0.66, ease: "elastic.out(1, 0.56)", stagger: 0.028, clearProps: "transform" });
          gsap.fromTo(impactPixelElements, { autoAlpha: 1, x: 0, y: 0, scale: 0.08, rotation: 0 }, {
            autoAlpha: 0,
            x: (_, target) => Number((target as HTMLElement).dataset.impactX || 0),
            y: (_, target) => Number((target as HTMLElement).dataset.impactY || 0),
            scale: (_, target) => Number((target as HTMLElement).dataset.impactScale || 1),
            rotation: (_, target) => Number((target as HTMLElement).dataset.impactRotation || 0),
            duration: (_, target) => Number((target as HTMLElement).dataset.impactDuration || 0.96),
            delay: (_, target) => Number((target as HTMLElement).dataset.impactDelay || 0),
            ease: "power4.out",
            stagger: { amount: 0.22, from: "center" },
            overwrite: "auto",
          });
        };

        const dropImpactTrigger = ScrollTrigger.create({
          trigger: dropScene,
          start: "top top",
          end: "bottom top",
          onRefresh: measureDropTravel,
          onUpdate: (self) => {
            if (impacted && (self.progress < 0.05 || hasClearedRestoredBall())) resetImpact();
            syncDropScale();
            if (!impacted && hasVisuallyHitArticle() && self.progress > 0.08) triggerImpact();
          },
        });

        cleanup.push(() => dropImpactTrigger.kill());
        cleanup.push(() => gsap.killTweensOf([dropVisual, articleSystems, ...articleRows, ...impactPixelElements]));
      }

      recentItems.forEach((item) => {
        ScrollTrigger.create({
          trigger: item,
          start: "top 86%",
          once: true,
          onEnter: () => gsap.fromTo(item, { autoAlpha: 0, y: 24 }, {
            autoAlpha: 1,
            y: 0,
            duration: 0.58,
            ease: "power3.out",
            clearProps: "transform,opacity,visibility",
          }),
        });
      });

      if (lowerSection && lowerPanels.length > 0) {
        ScrollTrigger.create({
          trigger: lowerSection,
          start: "top 84%",
          once: true,
          onEnter: () => gsap.fromTo(lowerPanels, { autoAlpha: 0, y: 28 }, {
            autoAlpha: 1,
            y: 0,
            duration: 0.62,
            ease: "power3.out",
            stagger: 0.12,
            clearProps: "transform,opacity,visibility",
          }),
        });
      }

      return () => cleanup.forEach((release) => release());
    });

    media.add("(min-width: 769px) and (prefers-reduced-motion: no-preference)", () => {
      if (!background || !hero) return;

      gsap.timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "bottom 28%",
          scrub: 0.7,
        },
      })
        .to(background, { autoAlpha: 0.16, scale: 1.07, filter: "blur(7px)", ease: "none" }, 0);
    });

    return () => media.revert();
  }, { scope: homeRef });

  useEffect(() => {
    if (displayedName !== profileName && projects.length === 0) return;
    const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 80);
    return () => window.clearTimeout(refreshTimer);
  }, [displayedName, profileName, projects.length]);

  return (
    <div className="home-motion-root" ref={homeRef}>
      <div className="home-background" aria-hidden="true" />
      <div className="home-canvas">
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="hero-content">
            <div className="profile-identity">
              <img className="profile-avatar" src="/avatar.jpg" alt="NextAlex 的头像" />
              <div className="profile-copy">
                <p className="profile-name" aria-label={profileName}>{displayedName}<span className="typing-caret" aria-hidden="true" /></p>
                <h1>技术开发与 AI 创作</h1>
                <p>专注 Java 并发编程、后端工程实践、AI 图像创作与 AI 编程项目。</p>
                <div className="profile-links"><button onClick={() => navigate("articles")}>技术文章</button><i /><button onClick={() => navigate("gallery")}>创作图库</button><i /><button onClick={() => navigate("studio")}>创作中心</button></div>
              </div>
            </div>
          </div>
          <div className="home-drop-object" aria-hidden="true"><div className="home-drop-visual"><HomeDropScene /></div></div>
        </div>
      </section>
      <section className="recent-section home-article-systems" aria-label="首页文章展示">
        <div className="home-article-impact-pixels" aria-hidden="true">{impactPixels.map((pixel, index) => <span className={`home-impact-pixel home-impact-pixel-${index % 6}`} key={index} data-impact-x={pixel.x} data-impact-y={pixel.y} data-impact-scale={pixel.scale} data-impact-rotation={pixel.rotation} data-impact-delay={pixel.delay} data-impact-duration={pixel.duration} style={{ "--pixel-size": `${pixel.size}px`, "--pixel-width": `${pixel.width}px`, "--pixel-height": `${pixel.height}px`, "--pixel-radius": pixel.radius } as CSSProperties} />)}</div>
        <div className="home-article-systems-inner home-content"><span className="home-article-hover-bg" aria-hidden="true" /><span className="home-article-cursor" aria-hidden="true" />{featuredHomeArticles.map(({ article, headline }, index) => <button className="recent-article home-article-system-row" key={article.title} onClick={() => window.setTimeout(() => setSelectedArticle(article), prefersReducedMotion() ? 0 : 180)}><span className="recent-index">[ {String(index + 1).padStart(2, "0")} ]</span><h2>{headline}</h2><p><strong>{article.title}</strong></p></button>)}</div>
      </section>
      <section className="home-lower home-content">
        <div><div className="section-heading compact"><div><h2>创作项目</h2></div><button className="text-action" onClick={() => navigate("studio")}>进入创作中心 <span>↗</span></button></div><div className="home-project-grid">{repositoryState === "ready" && projects.length > 0 ? projects.slice(0, 2).map((project) => <RepositoryProjectCard className="home-project-card" key={project.htmlUrl} project={project} username={repositories?.username || "GitHub"} />) : <p className="home-project-empty">{repositoryState === "loading" ? "正在同步 GitHub 项目" : "GitHub 项目暂不可用"}</p>}</div></div>
        <HomeQuickFolder navigate={navigate} />
        <HomeSocialTooltip />
      </section>
      </div>
    </div>
  );
}

function HomeSocialTooltip() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`home-social-tooltip${isOpen ? " is-open" : ""}`} aria-label="社交链接">
      <button className="home-social-tooltip-trigger" type="button" onClick={() => setIsOpen((open) => !open)} aria-label={isOpen ? "收起社交链接" : "展开社交链接"} aria-expanded={isOpen}><Send size={22} fill="currentColor" strokeWidth={1.8} /></button>
      <a className="home-social-tooltip-item home-social-tooltip-github" href="https://github.com/CbhHikari0828" target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub"><svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.49c-2.01.44-2.43-.85-2.43-.85-.33-.84-.81-1.06-.81-1.06-.66-.45.05-.44.05-.44.73.05 1.12.75 1.12.75.65 1.11 1.7.79 2.12.6.07-.47.25-.79.46-.97-1.61-.18-3.31-.81-3.31-3.59 0-.79.28-1.44.75-1.95-.08-.18-.33-.92.07-1.92 0 0 .61-.2 2 .75A6.9 6.9 0 0 1 8 3.88c.61 0 1.22.08 1.79.24 1.39-.95 2-.75 2-.75.4 1 .15 1.74.07 1.92.47.51.75 1.16.75 1.95 0 2.79-1.7 3.4-3.32 3.58.26.23.49.67.49 1.35v2.01c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" /></svg></a>
      <a className="home-social-tooltip-item home-social-tooltip-email" href="mailto:alexlee0828cbh@gmail.com" aria-label="Email" title="Email"><Mail size={20} /></a>
      <a className="home-social-tooltip-item home-social-tooltip-linkedin" href="https://www.linkedin.com/in/%E5%AE%9D%E5%90%88-%E9%99%88-a69233415/" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn"><svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M0 1.15C0 .51.53 0 1.18 0h13.64C15.47 0 16 .51 16 1.15v13.7c0 .64-.53 1.15-1.18 1.15H1.18C.53 16 0 15.49 0 14.85V1.15Zm4.94 12.54V6.17H2.44v7.52h2.5ZM3.69 5.14c.87 0 1.41-.58 1.41-1.3-.02-.73-.54-1.29-1.4-1.29-.86 0-1.42.56-1.42 1.29 0 .72.54 1.3 1.39 1.3h.02Zm2.64 8.55h2.5V9.49c0-.22.02-.44.08-.6.18-.44.6-.9 1.3-.9.91 0 1.28.69 1.28 1.7v4h2.5V9.4c0-2.3-1.23-3.37-2.87-3.37-1.32 0-1.9.73-2.23 1.24h.02V6.17h-2.5c.03.71 0 7.52 0 7.52Z" /></svg></a>
      <span className="home-social-tooltip-hitbox" aria-hidden="true" />
    </div>
  );
}

function HomeQuickFolder({ navigate }: { navigate: (view: View) => void }) {
  const [open, setOpen] = useState(false);
  const matchesSearch = (_name: string) => true;
  const openView = (view: View) => {
    setOpen(false);
    navigate(view);
  };

  return (
    <aside className="home-folder-widget">
      <div className="folder-card">
        <input checked={open} className="folder-toggle" id="home-quick-folder" onChange={(event) => setOpen(event.target.checked)} type="checkbox" />
        <label className="folder-trigger" htmlFor="home-quick-folder" aria-label={open ? "收起快捷入口" : "展开快捷入口"} />
        <div className="hint-wrapper" aria-hidden="true"><span className="hint-text">点击展开</span><svg className="hint-arrow" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 35 5 C 35 5, 15 5, 10 25 M 10 25 L 3 18 M 10 25 L 18 22" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <div className="folder-container">
          <svg className="folder-back" viewBox="0 0 50 40" fill="none" aria-hidden="true"><path d="M0 4C0 1.79086 1.79086 0 4 0H16.524C17.721 0 18.8415 0.54051 19.574 1.4673L22.426 5.0654C23.1585 5.99219 24.279 6.5327 25.476 6.5327H46C48.2091 6.5327 50 8.32356 50 10.5327V36C50 38.2091 48.2091 40 46 40H4C1.79086 40 0 38.2091 0 36V4Z" fill="#0056b3" /></svg>
          <button className={`file file-5${matchesSearch("创作图库") ? "" : " is-filtered-out"}`} onClick={() => openView("gallery")} type="button"><div className="shine" /><svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg><div className="file-text">创作图库.png</div><div className="file-tag">GALLERY · LINK</div></button>
          <button className={`file file-4${matchesSearch("留言板") ? "" : " is-filtered-out"}`} onClick={() => openView("guestbook")} type="button"><div className="shine" /><svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg><div className="file-text">访客留言.msg</div><div className="file-tag">MESSAGE · LINK</div></button>
          <button className={`file file-3${matchesSearch("创作中心") ? "" : " is-filtered-out"}`} onClick={() => openView("studio")} type="button"><div className="shine" /><svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg><div className="file-text">创作中心.code</div><div className="file-tag">WORKS · LINK</div></button>
          <button className={`file file-2${matchesSearch("文章") ? "" : " is-filtered-out"}`} onClick={() => openView("articles")} type="button"><div className="shine" /><svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg><div className="file-text">技术文章.md</div><div className="file-tag">ARTICLES · LINK</div></button>
          <button className={`file file-1${matchesSearch("笔记") ? "" : " is-filtered-out"}`} onClick={() => openView("notes")} type="button"><div className="shine" /><svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg><div className="file-text">日常笔记.md</div><div className="file-tag">NOTES · LINK</div></button>
          <label className="folder-front-wrapper" htmlFor="home-quick-folder" aria-label="切换快捷入口"><svg className="folder-front" viewBox="0 0 50 34" fill="none" aria-hidden="true"><path d="M0 4C0 1.79086 1.79086 0 4 0H46C48.2091 0 50 1.79086 50 4V30C50 32.2091 48.2091 34 46 34H4C1.79086 34 0 32.2091 0 30V4Z" fill="rgba(0, 123, 255, 0.65)" /></svg><div className="folder-label" /></label>
          <button className="folder-collapse-button" onClick={() => setOpen(false)} type="button">收起文件</button>
        </div>
      </div>
    </aside>
  );
}

function Articles({ activeCategory, setActiveCategory, paginatedArticles, articlePage, articlePageCount, setArticlePage, setSelectedArticle }: { activeCategory: string; setActiveCategory: (category: string) => void; paginatedArticles: Article[]; articlePage: number; articlePageCount: number; setArticlePage: (page: number) => void; setSelectedArticle: (article: Article) => void }) {
  const articleRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    const root = articleRef.current;
    const items = root ? Array.from(root.querySelectorAll<HTMLElement>(".article-feed-item")) : [];
    if (!root || items.length === 0 || prefersReducedMotion()) return;

    gsap.from(items, {
      autoAlpha: 0,
      y: 24,
      duration: 0.54,
      ease: "power3.out",
      stagger: { each: 0.08, from: "start" },
      clearProps: "transform,opacity,visibility",
      scrollTrigger: {
        trigger: root,
        start: "top 82%",
        once: true,
      },
    });
  }, { scope: articleRef, dependencies: [activeCategory, articlePage, paginatedArticles.length], revertOnUpdate: true });

  return <section className="content-band article-index" ref={articleRef}><div className="article-feed"><h1>最新发布</h1><div className="article-list">{paginatedArticles.map((article) => <button className="article-feed-item" key={article.title} onClick={() => setSelectedArticle(article)}><h2>{article.title}</h2><p>{article.excerpt}</p><span className="article-read-action">阅读全文 <i aria-hidden="true">→</i></span></button>)}</div><nav className="article-pagination" aria-label="文章分页"><button className="article-pagination-arrow" type="button" onClick={() => setArticlePage(articlePage - 1)} disabled={articlePage === 1} aria-label="上一页" title="上一页"><ChevronLeft aria-hidden="true" size={17} /></button>{Array.from({ length: articlePageCount }, (_, index) => index + 1).map((page) => <button className={`article-pagination-page${page === articlePage ? " active" : ""}`} type="button" key={page} aria-current={page === articlePage ? "page" : undefined} onClick={() => setArticlePage(page)}>{page}</button>)}<button className="article-pagination-arrow" type="button" onClick={() => setArticlePage(articlePage + 1)} disabled={articlePage === articlePageCount} aria-label="下一页" title="下一页"><ChevronRight aria-hidden="true" size={17} /></button></nav></div><aside className="article-aside"><section className="article-category-panel"><h2>文章分类</h2><div className="article-category-tags" role="tablist" aria-label="文章分类">{categories.map((category) => <button key={category} role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? "filter-active" : ""} onClick={() => setActiveCategory(category)}>{category}</button>)}</div></section><section className="popular-articles"><h2>热门文章</h2><div>{articles.slice(0, 5).map((article) => <button key={article.title} onClick={() => setSelectedArticle(article)}><span aria-hidden="true">→</span>{article.title}</button>)}</div></section></aside></section>;
}

function Notes({ notes, setSelectedNote }: { notes: Note[]; setSelectedNote: (note: Note) => void }) {
  const notesRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    const root = notesRef.current;
    const cards = root ? Array.from(root.querySelectorAll<HTMLElement>(".note-wobble-button")) : [];
    if (!root || cards.length === 0 || prefersReducedMotion()) return;

    gsap.set(cards, { autoAlpha: 0, y: 28 });

    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: root,
        start: "top 82%",
        once: true,
      },
      defaults: { ease: "power3.out" },
    });
    timeline.to(cards, {
      autoAlpha: 1,
      y: 0,
      duration: 0.56,
      stagger: { each: 0.09, from: "start" },
      clearProps: "transform,opacity,visibility",
    });
  }, { scope: notesRef, dependencies: [notes.length], revertOnUpdate: true });

  return (
    <section className="content-band notes-layout" ref={notesRef}>
      <div className="notes-list">
        <h1>最近更新</h1>
        <div className="notes-wobble-grid">{notes.map((note, index) => <WobbleNoteCard note={note} index={index} key={`${note.year ?? "2026"}-${note.date}-${note.title}`} open={() => setSelectedNote(note)} />)}</div>
      </div>
      <aside className="notes-about">
        <div className="card notes-about-card">
          <div className="content">
            <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M20 9V5H4V9H20ZM20 11H4V19H20V11ZM3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM5 12H8V17H5V12ZM5 6H7V8H5V6ZM9 6H11V8H9V6Z" />
            </svg>
            <h2>关于本站</h2>
            <p className="para">用于记录学习摘要、项目更新和阅读记录。内容按时间顺序归档。</p>
            <div className="notes-about-links">
              <a className="link" href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer"><img className="notes-github-icon" src="/github.svg" alt="" aria-hidden="true" />GitHub</a>
              <a className="link" href="mailto:alexlee0828cbh@gmail.com"><Mail size={20} aria-hidden="true" />Email</a>
              <span><Rss size={20} aria-hidden="true" />RSS</span>
            </div>
          </div>
        </div>
      </aside>
    </section>
  );
}

function WobbleNoteCard({ note, index, open }: { note: Note; index: number; open: () => void }) {
  const cardClass = index === 0 ? "note-wobble-primary" : `note-wobble-${index + 1}`;

  return <WobbleCard className={`note-wobble-card ${cardClass}`}>
    <button aria-label={`打开笔记 ${note.title}`} className="note-entry note-wobble-button" onClick={open} type="button">
      <span className="note-wobble-glow" aria-hidden="true" />
      <span className="note-wobble-orbit" aria-hidden="true"><i /><i /><i /></span>
      <time>{note.date} / {note.year ?? "2026"}</time>
      <span className="note-wobble-copy"><strong>{note.title}</strong><span>{note.body}</span></span>
    </button>
  </WobbleCard>;
}

function WobbleCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-300, 300], [10, -10]), { stiffness: 100, damping: 10, mass: 0.5 });
  const rotateY = useSpring(useTransform(mouseX, [-300, 300], [-10, 10]), { stiffness: 100, damping: 10, mass: 0.5 });

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    mouseX.set(event.clientX - (bounds.left + bounds.width / 2));
    mouseY.set(event.clientY - (bounds.top + bounds.height / 2));
  }

  function resetPointer() {
    mouseX.set(0);
    mouseY.set(0);
  }

  return <motion.div ref={containerRef} className={className} onPointerMove={handlePointerMove} onPointerLeave={resetPointer} style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}>{children}</motion.div>;
}

function Gallery({ creations, setSelectedCreation }: { creations: Creation[]; setSelectedCreation: (creation: Creation) => void }) {
  const cards: LayoutGridCard[] = creations.map((creation, index) => ({
    id: index + 1,
    thumbnail: creation.image,
    className: "gallery-card",
    content: <GalleryLayoutContent creation={creation} setSelectedCreation={setSelectedCreation} />,
    label: creation.title,
  }));

  return <section className="gallery-showcase"><div className="gallery-head"><p>展示 AI 生成图像、视觉研究和界面设计作品，按项目归档。</p><span>{String(creations.length).padStart(2, "0")} PROJECTS</span></div>{creations.length > 0 ? <LayoutGrid cards={cards} /> : <div className="gallery-empty">暂无作品</div>}</section>;
}

type LayoutGridCard = {
  id: number;
  content: ReactNode;
  className: string;
  thumbnail: string;
  label: string;
};

function LayoutGrid({ cards }: { cards: LayoutGridCard[] }) {
  const [selected, setSelected] = useState<LayoutGridCard | null>(null);
  const [lastSelected, setLastSelected] = useState<LayoutGridCard | null>(null);
  const [imageRatios, setImageRatios] = useState<Record<number, number>>({});
  const [gridMetrics, setGridMetrics] = useState({ width: 0, columns: 3 });
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const updateMetrics = () => {
      const style = window.getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      setGridMetrics({ width: grid.clientWidth, columns });
    };
    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  useGSAP(() => {
    const grid = gridRef.current;
    if (!grid || cards.length === 0) return;

    const slots = Array.from(grid.querySelectorAll<HTMLElement>(".layout-grid-slot"));
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(slots, {
        autoAlpha: 0,
        y: 30,
        duration: 0.56,
        ease: "power3.out",
        stagger: { each: 0.055, from: "start" },
        clearProps: "transform,opacity,visibility",
        scrollTrigger: { trigger: grid, start: "top 82%", once: true },
      });
    });

    const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 0);
    return () => {
      window.clearTimeout(refreshTimer);
      media.revert();
    };
  }, { scope: gridRef, dependencies: [cards.length], revertOnUpdate: true });

  function handleClick(card: LayoutGridCard) {
    setLastSelected(selected);
    setSelected(card);
  }

  function handleOutsideClick() {
    setLastSelected(selected);
    setSelected(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, card: LayoutGridCard) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick(card);
    }
  }

  return <div className="layout-grid gallery-grid" ref={gridRef}>
    {cards.map((card) => {
      const ratio = imageRatios[card.id];
      const columnWidth = gridMetrics.width / gridMetrics.columns;
      const imageHeight = ratio && columnWidth > 0 ? columnWidth / ratio : 240;
      const rowSpan = Math.max(1, Math.ceil(imageHeight));
      return <div className="layout-grid-slot" key={card.id} style={{ gridRowEnd: `span ${rowSpan}`, height: `${imageHeight}px` }}>
      <motion.div
        onClick={() => handleClick(card)}
        onKeyDown={(event) => handleKeyDown(event, card)}
        className={`gallery-card layout-grid-card${selected?.id === card.id ? " layout-grid-selected" : lastSelected?.id === card.id ? " layout-grid-last-selected" : ""}`}
        layoutId={`card-${card.id}`}
        role="button"
        tabIndex={selected?.id === card.id ? -1 : 0}
        aria-label={`${selected?.id === card.id ? "收起" : "展开"}${card.label}`}
      >
        {selected?.id === card.id && <LayoutGridSelectedCard card={selected} />}
        <LayoutGridImage card={card} onRatio={(nextRatio) => setImageRatios((current) => current[card.id] === nextRatio ? current : { ...current, [card.id]: nextRatio })} />
        <span className="gallery-layout-title">{card.label}</span>
      </motion.div>
      </div>;
    })}
    <motion.div onClick={handleOutsideClick} className={`layout-grid-backdrop${selected?.id ? " is-active" : ""}`} animate={{ opacity: selected?.id ? 0.3 : 0 }} aria-hidden="true" />
  </div>;
}

function LayoutGridImage({ card, onRatio }: { card: LayoutGridCard; onRatio: (ratio: number) => void }) {
  return <motion.img layoutId={`image-${card.id}-image`} src={card.thumbnail} className="gallery-card-image" alt={card.label} onLoad={(event) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) onRatio(image.naturalWidth / image.naturalHeight);
  }} />;
}

function LayoutGridSelectedCard({ card }: { card: LayoutGridCard | null }) {
  return <div className="layout-grid-selected-content">
    <motion.div layoutId={`content-${card?.id}`} initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} transition={{ duration: 0.3, ease: "easeInOut" }} className="gallery-card-content layout-grid-card-content">
      {card?.content}
    </motion.div>
  </div>;
}

function GalleryLayoutContent({ creation, setSelectedCreation }: { creation: Creation; setSelectedCreation: (creation: Creation) => void }) {
  return <div className="gallery-layout-details">
    <strong>{creation.title}</strong>
    <small>模型 / {creation.model}</small>
    <p>{creation.prompt}</p>
    <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedCreation(creation); }}>查看详情 <ArrowUpRight size={16} aria-hidden="true" /></button>
  </div>;
}

function RepositoryProjectCard({ project, username, className = "" }: { project: GitHubRepository; username: string; className?: string }) {
  return <div className={`studio-project-parent${className ? ` ${className}` : ""}`}>
    <a className="studio-project-card" href={project.htmlUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${username} 的 GitHub 项目 ${project.name}`}>
      <div className="studio-project-logo" aria-hidden="true">
        <span className="studio-project-circle studio-project-circle1" />
        <span className="studio-project-circle studio-project-circle2" />
        <span className="studio-project-circle studio-project-circle3" />
        <span className="studio-project-circle studio-project-circle4" />
        <span className="studio-project-circle studio-project-circle5"><GitBranch className="studio-project-svg" size={20} /></span>
      </div>
      <div className="studio-project-glass" aria-hidden="true" />
      <div className="studio-project-card-content">
        <span className="studio-project-title">{project.name}</span>
        <span className="studio-project-text">{project.description || "暂无项目说明"}</span>
      </div>
      <div className="studio-project-bottom" aria-hidden="true">
        <div className="studio-project-social-buttons-container">
          <span className="studio-project-social-button" title={`${project.stars} stars`}><Star className="studio-project-svg" size={15} /></span>
          <span className="studio-project-social-button" title={`${project.forks} forks`}><GitFork className="studio-project-svg" size={15} /></span>
          <span className="studio-project-social-button" title={formatRepositoryDate(project.updatedAt)}><GitBranch className="studio-project-svg" size={15} /></span>
        </div>
        <div className="studio-project-view-more">
          <span className="studio-project-view-more-button">{project.language || "Repository"}</span>
          <ChevronDown className="studio-project-svg" size={15} strokeWidth={3} />
        </div>
      </div>
    </a>
  </div>;
}

function Studio({ contributions, contributionState, repositories, repositoryState, profile, profileState }: { contributions: GitHubContributions | null; contributionState: ContributionState; repositories: GitHubRepositories | null; repositoryState: RepositoryState; profile: GitHubProfile | null; profileState: RepositoryState }) {
  const studioRef = useRef<HTMLElement>(null);
  const contributionYear = contributions?.year ?? new Date().getFullYear();
  const contributionWeeks = buildContributionWeeks(contributionYear, contributions?.days ?? []);
  const contributionMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const contributionMonths = contributionWeeks.flatMap((week, weekIndex) => {
    const firstDayOfMonth = week.find((cell) => cell.date?.endsWith("-01"));
    if (!firstDayOfMonth?.date) return [];

    return [{ name: contributionMonthNames[Number(firstDayOfMonth.date.slice(5, 7)) - 1], weekIndex }];
  });
  const contributionSummary = contributionState === "ready" ? `${contributionYear} 年 ${contributions?.total ?? 0} 次贡献` : contributionState === "loading" ? "正在同步贡献记录" : "贡献记录暂不可用";
  const projects = repositories?.repositories ?? [];
  const profileStat = (value: number | undefined) => profileState === "ready" && profile && value !== undefined ? value.toLocaleString("zh-CN") : "-";

  useGSAP(() => {
    const root = studioRef.current;
    if (!root || prefersReducedMotion()) return;

    const intro = root.querySelector<HTMLElement>(".studio-intro");
    const contribution = root.querySelector<HTMLElement>(".contribution-panel");
    const projectsRoot = root.querySelector<HTMLElement>(".studio-projects");
    const projectCards = projectsRoot ? Array.from(projectsRoot.querySelectorAll<HTMLElement>(".studio-project-parent")) : [];
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: root,
        start: "top 82%",
        toggleActions: "play none none reset",
      },
      defaults: { duration: 0.58, ease: "power3.out" },
    });

    if (intro) timeline.from(intro, { autoAlpha: 0, x: -26, clearProps: "transform,opacity,visibility" }, 0);
    if (contribution) timeline.from(contribution, { autoAlpha: 0, x: 26, clearProps: "transform,opacity,visibility" }, 0.08);
    if (projectsRoot) timeline.from(projectsRoot, { autoAlpha: 0, y: 24, clearProps: "transform,opacity,visibility" }, "-=0.22");
    if (projectCards.length > 0) timeline.from(projectCards, { autoAlpha: 0, y: 24, duration: 0.48, stagger: 0.08, clearProps: "transform,opacity,visibility" }, "-=0.26");
  }, { scope: studioRef, dependencies: [contributionState, repositoryState, projects.length, profileState], revertOnUpdate: true });

  return <section className="studio-layout" ref={studioRef}>
    <div className="studio-overview">
      <div className="studio-intro">
        <p className="section-kicker">创作中心</p>
        <h1>WORKS</h1>
        <span className="studio-title-rule" aria-hidden="true" />
        <div className="studio-stats">
          <div><Code2 size={25} strokeWidth={1.8} /><strong>{profileStat(profile?.repositoryCount)}</strong><span>Repositories</span></div>
          <div><Star size={25} strokeWidth={1.8} /><strong>{profileStat(profile?.stars)}</strong><span>Stars</span></div>
          <div><GitFork size={25} strokeWidth={1.8} /><strong>{profileStat(profile?.forks)}</strong><span>Forks</span></div>
          <div><Users size={25} strokeWidth={1.8} /><strong>{profileStat(profile?.followers)}</strong><span>Followers</span></div>
        </div>
        <div className="studio-actions"><a className="studio-action-primary" href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer">View on GitHub <ArrowUpRight size={17} /></a><a className="studio-action-secondary" href="https://github.com/CbhHikari0828?tab=repositories" target="_blank" rel="noreferrer">All Projects <ArrowUpRight size={17} /></a></div>
      </div>
      <section className="contribution-panel" aria-label="项目贡献记录">
        <header><strong>{contributionSummary}</strong><a href="https://github.com/CbhHikari0828" target="_blank" rel="noreferrer">{contributionYear} <ChevronDown size={16} /></a></header>
        <div className="contribution-calendar" style={{ "--contribution-week-count": contributionWeeks.length } as React.CSSProperties}>
          <div className="contribution-months">{contributionMonths.map((month) => <span key={`${month.name}-${month.weekIndex}`} style={{ gridColumnStart: month.weekIndex + 1 }}>{month.name}</span>)}</div>
          <div className="contribution-grid">{contributionWeeks.map((week, weekIndex) => <div className="contribution-week" key={weekIndex}>{week.map((cell, dayIndex) => <i className={`contribution-cell contribution-level-${cell.level}${cell.date ? "" : " contribution-cell-outside"}`} key={dayIndex} title={cell.date ? `${cell.date}: ${cell.count} 次贡献` : undefined} />)}</div>)}</div>
        </div>
        <footer><span>少</span><i className="contribution-cell contribution-level-0" /><i className="contribution-cell contribution-level-1" /><i className="contribution-cell contribution-level-2" /><i className="contribution-cell contribution-level-3" /><i className="contribution-cell contribution-level-4" /><span>多</span></footer>
      </section>
    </div>
    <section className="studio-projects"><header><h2>PROJECTS</h2><span /><a href="https://github.com/CbhHikari0828?tab=repositories" target="_blank" rel="noreferrer">VIEW ALL <ArrowUpRight size={17} /></a></header><div className="studio-project-grid">{repositoryState === "ready" && projects.length > 0 ? projects.map((project) => <RepositoryProjectCard key={project.htmlUrl} project={project} username={repositories?.username || "GitHub"} />) : <p className="studio-project-empty">{repositoryState === "loading" ? "正在同步 GitHub 项目" : "GitHub 项目暂不可用"}</p>}</div></section>
  </section>;
}

function SteamEntertainment({ overview, state, musicPreferences }: { overview: SteamOverview | null; state: SteamState; musicPreferences: MusicPreference[] }) {
  const showSteam = state === "ready" && overview !== null;
  const recentGames = overview?.recentlyPlayed.filter((game) => !isHiddenSteamGame(game)) ?? [];
  const libraryGames = overview?.games.filter((game) => !isHiddenSteamGame(game)) ?? [];

  return <section className="steam-page entertainment-page">
    {showSteam && overview ? <>
      <header className="steam-profile">
        <div><h1>{overview.profile.name}</h1><a href={overview.profile.profileUrl} target="_blank" rel="noreferrer">Steam 个人主页</a></div>
        <div className="steam-profile-cards"><SteamProfileStatCard title="游戏库" value={`${overview.gameCount}`} detail="拥有游戏" /><SteamProfileStatCard title="游玩时长" value={formatSteamPlaytime(overview.totalPlaytime)} detail="累计时长" /></div>
      </header>
      <div className="steam-games-zone">
        {recentGames.length > 0 && <section className="steam-section"><h2>最近游玩</h2><SteamGameCoverStrip games={recentGames} recent /></section>}
        <section className="steam-section"><h2>游戏库</h2><SteamGameAccordion games={libraryGames} /></section>
      </div>
    </> : <div className="steam-state"><p>{state === "loading" ? "正在同步 Steam 数据" : "Steam 数据暂不可用"}</p></div>}
    <MusicSection musicPreferences={musicPreferences} />
  </section>;
}

function MusicSection({ musicPreferences }: { musicPreferences: MusicPreference[] }) {
  return <section className="entertainment-music" aria-labelledby="music-preferences-title">
    <header className="music-section-heading"><h2 id="music-preferences-title">音乐偏好</h2></header>
    <div className="music-grid">{musicPreferences.map((track, index) => <a className={`music-card music-card-theme-${index}`} href={track.href} key={`${track.artist}-${track.title}`} target="_blank" rel="noreferrer">
      <div className="music-card-overlay" aria-hidden="true" />
      <div className="music-card-circle"><img src={track.cover} alt={`${track.artist} - ${track.title}`} loading="lazy" /></div>
      <p>{track.title}</p>
      <small>{track.artist} · {track.album}</small>
      <span className="music-card-meta">{track.genre} · {track.duration} · {track.releaseDate}</span>
    </a>)}</div>
  </section>;
}

function isHiddenSteamGame(game: SteamGame) {
  return game.appId === 431960 || game.name.trim().toLocaleLowerCase("en-US") === "wallpaper engine";
}

function SteamGameCoverStrip({ games, recent = false }: { games: SteamGame[]; recent?: boolean }) {
  const featuredGames = [...games].sort((left, right) => right.playtimeForever - left.playtimeForever).slice(0, 10);

  return <div className="steam-game-strip" role="list">{featuredGames.map((game, index) => {
    const playtime = recent ? `${formatSteamPlaytime(game.playtime2Weeks)} / 近两周` : formatSteamPlaytime(game.playtimeForever);
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/header.jpg`;

    return <a className="steam-game-item" key={game.appId} href={`https://store.steampowered.com/app/${game.appId}`} target="_blank" rel="noreferrer" role="listitem" aria-label={`${game.name}，${playtime}`} data-game={`${game.name} · ${playtime}`} style={{ "--color": steamGameColors[index], "--cover": `url(${cover})` } as React.CSSProperties} />;
  })}</div>;
}

function SteamProfileStatCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="steam-stat-card">
    <div className="steam-stat-image"><svg xmlns="http://www.w3.org/2000/svg" height="77" width="76" viewBox="0 0 76 77" aria-hidden="true"><path fillRule="nonzero" fill="#3F9CBB" d="m60.91 71.846 12.314-19.892c3.317-5.36 3.78-13.818-2.31-19.908l-26.36-26.36c-4.457-4.457-12.586-6.843-19.908-2.31L4.753 15.69c-5.4 3.343-6.275 10.854-1.779 15.35a7.773 7.773 0 0 0 7.346 2.035l7.783-1.945a3.947 3.947 0 0 1 3.731 1.033l22.602 22.602c.97.97 1.367 2.4 1.033 3.732l-1.945 7.782a7.775 7.775 0 0 0 2.037 7.349c4.49 4.49 12.003 3.624 15.349-1.782Zm-24.227-46.12-1.891-1.892-1.892 1.892a2.342 2.342 0 0 1-3.312-3.312l1.892-1.892-1.892-1.891a2.342 2.342 0 0 1 3.312-3.312l1.892 1.891 1.891-1.891a2.342 2.342 0 0 1 3.312 3.312l-1.891 1.891 1.891 1.892a2.342 2.342 0 0 1-3.312 3.312Zm14.19 14.19a2.343 2.343 0 1 1 3.315-3.312 2.343 2.343 0 0 1-3.314 3.312Zm0 7.096a2.343 2.343 0 0 1 3.313-3.312 2.343 2.343 0 0 1-3.312 3.312Zm7.096-7.095a2.343 2.343 0 1 1 3.312 0 2.343 2.343 0 0 1-3.312 0Zm0 7.095a2.343 2.343 0 0 1 3.312-3.312 2.343 2.343 0 0 1-3.312 3.312Z" /></svg></div>
    <div className="steam-stat-desc"><div className="steam-stat-header"><div className="steam-stat-title">{title}</div><div className="steam-stat-menu" aria-hidden="true"><i /><i /><i /></div></div><div className="steam-stat-time">{value}</div><p>{detail}</p></div>
  </div>;
}

function SteamGameAccordion({ games }: { games: SteamGame[] }) {
  const featuredGames = [...games].sort((left, right) => right.playtimeForever - left.playtimeForever).slice(0, 16);
  const [activeGameId, setActiveGameId] = useState<number | null>(() => featuredGames[0]?.appId ?? null);
  const defaultGameId = featuredGames[0]?.appId ?? null;

  return <div className="steam-library-accordion" role="list" onMouseLeave={() => setActiveGameId(defaultGameId)}>{featuredGames.map((game, index) => {
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/header.jpg`;
    const playtime = formatSteamPlaytime(game.playtimeForever);
    const active = game.appId === activeGameId;

    return <a className={`steam-library-accordion-item${active ? " is-active" : ""}`} key={game.appId} href={`https://store.steampowered.com/app/${game.appId}`} target="_blank" rel="noreferrer" role="listitem" aria-current={active ? "true" : undefined} aria-label={`${game.name}，${playtime}`} onFocus={() => setActiveGameId(game.appId)} onMouseEnter={() => setActiveGameId(game.appId)} style={{ "--cover": `url(${cover})`, "--accent": steamGameColors[index] } as React.CSSProperties}>
      <span className="steam-library-accordion-cover" aria-hidden="true" />
      <span className="steam-library-accordion-details"><strong>{game.name}</strong><span>总时长 {playtime}</span><span className="steam-library-accordion-action">查看商店 <ArrowUpRight size={16} aria-hidden="true" /></span></span>
    </a>;
  })}</div>;
}

function Guestbook({ visitor, message, setVisitor, setMessage, comments, submitMessage }: { visitor: string; message: string; setVisitor: (value: string) => void; setMessage: (value: string) => void; comments: GuestbookComment[]; submitMessage: (event: FormEvent<HTMLFormElement>, color: NoteColor) => void }) {
  const [selectedColor, setSelectedColor] = useState<NoteColor>("ice");
  const visibleComments = comments.length > 0 ? comments : mockGuestbookComments;
  const boardHeight = 690 + Math.max(0, Math.ceil(visibleComments.length / noteLayouts.length) - 1) * 180;

  return <><div className="guestbook-grid-wrapper" aria-hidden="true"><div className="guestbook-grid-background" /></div><section className="guestbook-wall"><div className="guestbook-canvas"><div className="note-board" aria-live="polite" style={{ "--note-board-height": `${boardHeight}px` } as React.CSSProperties}>{visibleComments.map((comment, index) => { const layout = getNoteLayout(index); return <article className={`visitor-note visitor-note-${comment.color}`} key={`${comment.name}-${index}`} style={{ "--note-x": layout.x, "--note-y": layout.y, "--note-tilt": `${layout.tilt}deg`, "--note-z": layout.z, "--note-delay": `${index * 55}ms` } as React.CSSProperties}><p className="visitor-note-title">{comment.name}</p><p className="visitor-note-description">{comment.body}</p><time className="visitor-note-date">{comment.date}</time><div className="visitor-note-corner" aria-hidden="true"><span>→</span></div></article>; })}</div><section className="guestbook-editor"><form className="guestbook-submit-form" onSubmit={(event) => submitMessage(event, selectedColor)}><div className="guestbook-submit-heading"><p>发布留言</p><span>{message.length}/160</span></div><div className="guestbook-submit-name"><input aria-label="昵称" value={visitor} onChange={(event) => setVisitor(event.target.value)} placeholder="昵称" maxLength={20} required /></div><div className="guestbook-submit-message"><textarea aria-label="留言内容" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="留言内容" maxLength={160} rows={4} required /></div><div className="guestbook-submit-footer"><div className="guestbook-submit-colors" aria-label="便签颜色">{noteColors.map((color) => <button key={color} type="button" className={`guestbook-submit-color guestbook-submit-color-${color}${selectedColor === color ? " selected" : ""}`} onClick={() => setSelectedColor(color)} aria-label={`选择${color}颜色`} />)}</div><button type="submit">提交留言</button></div><div className="guestbook-submit-background" aria-hidden="true" /><div className="guestbook-submit-white-filter" aria-hidden="true" /></form></section></div></section></>;
}

function ArticleReader({ article, close }: { article: Article; close: () => void }) {
  const readerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const outlineRef = useRef<HTMLElement>(null);
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const outlineOpenRef = useRef(false);
  const [headings, setHeadings] = useState<ArticleHeading[]>([]);
  const [activeHeading, setActiveHeading] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [closing, requestClose] = useAnimatedDismiss(close, 180);

  useEffect(() => {
    outlineOpenRef.current = outlineOpen;
  }, [outlineOpen]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const reader = readerRef.current;
    const restoreSiblings = reader ? hideModalSiblings(reader) : () => undefined;
    const focusFrame = window.requestAnimationFrame(() => backButtonRef.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (outlineOpenRef.current) {
        setOutlineOpen(false);
        window.requestAnimationFrame(() => outlineToggleRef.current?.focus({ preventScroll: true }));
        return;
      }
      requestClose();
    };
    const keepFocusInside = (event: KeyboardEvent) => {
      if (reader) trapModalFocus(event, reader);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("keydown", keepFocusInside);
      restoreSiblings();
      previousFocus?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  useEffect(() => {
    const reader = readerRef.current;
    const content = contentRef.current;
    if (!reader || !content) return;

    reader.scrollTop = 0;
    const headingElements = Array.from(content.querySelectorAll<HTMLElement>(".article-reader-intro h1, .markdown-content h2, .markdown-content h3"));
    const nextHeadings = headingElements.map((heading, index) => {
      const id = `article-heading-${index}`;
      heading.id = id;
      heading.tabIndex = -1;
      return {
        id,
        title: heading.textContent?.trim() || `第 ${index + 1} 节`,
        level: Number(heading.tagName.slice(1)) as ArticleHeading["level"],
      };
    });

    setHeadings(nextHeadings);
    setActiveHeading(0);
    setOutlineOpen(false);
  }, [article]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || headings.length === 0) return;

    const updateActiveHeading = () => {
      const readerTop = reader.getBoundingClientRect().top;
      const activationLine = readerTop + Math.min(180, reader.clientHeight * .24);
      let nextActive = 0;

      headings.forEach((heading, index) => {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= activationLine) nextActive = index;
      });

      setActiveHeading((current) => current === nextActive ? current : nextActive);
    };

    updateActiveHeading();
    reader.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      reader.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [headings]);

  useEffect(() => {
    if (!outlineOpen) return;

    const closeOutline = (event: PointerEvent) => {
      if (!outlineRef.current?.contains(event.target as Node)) setOutlineOpen(false);
    };

    document.addEventListener("pointerdown", closeOutline);
    return () => {
      document.removeEventListener("pointerdown", closeOutline);
    };
  }, [outlineOpen]);

  const jumpToHeading = (heading: ArticleHeading, index: number) => {
    const target = contentRef.current?.querySelector<HTMLElement>(`#${heading.id}`);
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
    setActiveHeading(index);
    setOutlineOpen(false);
  };

  return (
    <section className={`article-reader${closing ? " is-closing" : ""}`} aria-label="文章正文" aria-modal="true" role="dialog" ref={readerRef} tabIndex={-1}>
      <header className="article-reader-header"><button className="article-reader-back" onClick={requestClose} ref={backButtonRef}>← 返回文章</button></header>
      <article className="article-reader-content" ref={contentRef}>
        <header className="article-reader-intro"><p>{article.category} · {article.series}</p><h1>{article.title}</h1><div className="article-reader-meta"><time>{article.date}</time><span aria-hidden="true">·</span><span>{article.readTime}</span><span aria-hidden="true">·</span><span className="article-reader-views" aria-label={`浏览量 ${article.views.toLocaleString("zh-CN")}`}><Eye aria-hidden="true" size={15} strokeWidth={1.8} />{article.views.toLocaleString("zh-CN")}</span></div></header>
        <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{article.content}</ReactMarkdown></div>
      </article>
      {headings.length > 1 && (
        <nav className={`article-outline${outlineOpen ? " is-open" : ""}`} aria-label="文章导览" ref={outlineRef}>
          <button
            className="article-outline-toggle"
            type="button"
            aria-label={outlineOpen ? "收起文章导览" : "展开文章导览"}
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}
            ref={outlineToggleRef}
          >
            <span className="article-outline-rail" aria-hidden="true">
              {headings.map((heading, index) => <i className={`level-${heading.level}${activeHeading === index ? " active" : ""}`} key={heading.id} />)}
            </span>
          </button>
          <div className="article-outline-panel" aria-hidden={!outlineOpen}>
            {headings.map((heading, index) => (
              <button
                className={`article-outline-link level-${heading.level}${activeHeading === index ? " active" : ""}`}
                key={heading.id}
                onClick={() => jumpToHeading(heading, index)}
                style={{ animationDelay: `${Math.min(index * 10, 60)}ms` }}
                tabIndex={outlineOpen ? 0 : -1}
                type="button"
              >
                {heading.title}
              </button>
            ))}
          </div>
        </nav>
      )}
    </section>
  );
}
function CreationDrawer({ creation, close }: { creation: Creation; close: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [closing, requestClose] = useAnimatedDismiss(close, 180);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const backdrop = closeButtonRef.current?.closest<HTMLElement>(".drawer-backdrop") || null;
    const restoreSiblings = backdrop ? hideModalSiblings(backdrop) : () => undefined;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    const keepFocusInside = (event: KeyboardEvent) => {
      if (backdrop) trapModalFocus(event, backdrop);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("keydown", keepFocusInside);
      restoreSiblings();
      previousFocus?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  return (
    <div className={`drawer-backdrop${closing ? " is-closing" : ""}`} onClick={requestClose}>
      <article className="drawer creation-drawer" aria-label={creation.title} aria-modal="true" role="dialog" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={requestClose} aria-label="关闭" ref={closeButtonRef}>×</button>
        <img src={creation.image} alt={creation.title} />
        <p className="section-kicker">{creation.type} / {creation.state}</p>
        <h2>{creation.title}</h2>
        <dl className="creation-prompt"><div><dt>模型</dt><dd>{creation.model}</dd></div><div><dt>完整提示词</dt><dd>{creation.prompt}</dd></div></dl>
      </article>
    </div>
  );
}

function NoteDialog({ note, close }: { note: Note; close: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [closing, requestClose] = useAnimatedDismiss(close, 180);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const backdrop = closeButtonRef.current?.closest<HTMLElement>(".drawer-backdrop") || null;
    const restoreSiblings = backdrop ? hideModalSiblings(backdrop) : () => undefined;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    const keepFocusInside = (event: KeyboardEvent) => {
      if (backdrop) trapModalFocus(event, backdrop);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("keydown", keepFocusInside);
      restoreSiblings();
      previousFocus?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  return (
    <div className={`drawer-backdrop${closing ? " is-closing" : ""}`} onClick={requestClose}>
      <article className="drawer note-dialog" aria-label={note.title} aria-modal="true" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="tools" aria-hidden="true">
          <div className="circle"><span className="red box" /></div>
          <div className="circle"><span className="yellow box" /></div>
          <div className="circle"><span className="green box" /></div>
        </div>
        <button className="close-button" onClick={requestClose} aria-label="关闭" ref={closeButtonRef}>×</button>
        <div className="card__content">
          <time>{note.date} / {note.year ?? "2026"}</time>
          <h2>{note.title}</h2>
          {note.markdown ? <article className="note-dialog-content markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{note.markdown}</ReactMarkdown></article> : <div className="note-dialog-content">{note.content.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>}
        </div>
      </article>
    </div>
  );
}

export default App;
