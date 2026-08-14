import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Code2, Eye, GitBranch, GitFork, Mail, Rss, Star, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type View = "home" | "articles" | "notes" | "gallery" | "studio" | "guestbook";
type ApiState = "checking" | "online" | "offline";
type ContributionState = "loading" | "ready" | "unavailable";

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

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

type ViewTransitionHandle = {
  finished: Promise<void>;
  skipTransition?: () => void;
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
  title: string;
  body: string;
  content: string[];
};

type GuestbookComment = {
  name: string;
  body: string;
  date: string;
  color: string;
};

const noteColors = ["ice", "mint", "lavender", "rose"] as const;
type NoteColor = typeof noteColors[number];
const articlesPerPage = 5;

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

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
let pageTransitionSequence = 0;
let activePageTransition: ViewTransitionHandle | null = null;

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
  const transitionDocument = document as ViewTransitionDocument;
  if (!transitionDocument.startViewTransition || prefersReducedMotion()) {
    pageTransitionSequence += 1;
    activePageTransition?.skipTransition?.();
    activePageTransition = null;
    delete document.documentElement.dataset.pageTransition;
    update();
    return;
  }

  const transitionSequence = ++pageTransitionSequence;
  if (activePageTransition) {
    activePageTransition.skipTransition?.();
    activePageTransition = null;
    delete document.documentElement.dataset.pageTransition;
    flushSync(update);
    return;
  }

  let committed = false;
  const commit = () => {
    if (committed || transitionSequence !== pageTransitionSequence) return;
    committed = true;
    flushSync(update);
  };

  document.documentElement.dataset.pageTransition = "running";
  try {
    const transition = transitionDocument.startViewTransition(commit);
    document.documentElement.classList.add("view-transitions-enabled");
    activePageTransition = transition;
    void transition.finished.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (transitionSequence !== pageTransitionSequence) return;
      activePageTransition = null;
      delete document.documentElement.dataset.pageTransition;
    });
  } catch {
    if (transitionSequence === pageTransitionSequence) {
      activePageTransition = null;
      delete document.documentElement.dataset.pageTransition;
    }
    commit();
  }
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

const creations: Creation[] = [
  {
    title: "Neon Archive",
    type: "AI 视觉实验",
    state: "展出中",
    description: "以城市夜景为主题的 AI 生成图像系列。",
    model: "Midjourney v6.1",
    prompt: "rain-soaked cyberpunk street at night, neon magenta and cyan reflections, empty urban boulevard, cinematic wide angle, atmospheric haze, high contrast, detailed architecture, 35mm film still --ar 16:9 --stylize 250",
    image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1200&q=85",
    accent: "#ffffff",
  },
  {
    title: "Prompt Garden",
    type: "AI 编程作品",
    state: "迭代中",
    description: "用于管理提示词、版本记录和项目素材的交互式工具。",
    model: "FLUX.1 Pro",
    prompt: "ancient stone castle emerging from morning fog, quiet mountain valley, warm sunrise through the mist, weathered walls, cinematic landscape photography, soft natural light, restrained colors, highly detailed --ar 16:9",
    image: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=85",
    accent: "#7b9d82",
  },
  {
    title: "Quiet Machines",
    type: "交互原型",
    state: "已归档",
    description: "一场关于自动化和人类注意力的黑白界面练习。",
    model: "SDXL 1.0",
    prompt: "friendly white service robot in a contemporary research lab, close-up portrait, soft daylight, clean industrial display, precise material detail, documentary photography, neutral palette, shallow depth of field --ar 16:9",
    image: "https://images.unsplash.com/photo-1535378917042-10a22c95931a?auto=format&fit=crop&w=1200&q=85",
    accent: "#8a9aa5",
  },
];

const notes: Note[] = [
  { date: "08.11", title: "并发学习方法", body: "先识别共享状态和状态转换，再选择并发控制方案。", content: ["并发问题通常不是从锁开始，而是从共享状态开始。先明确哪些数据会被多个线程读取或修改，再标出状态变化发生的位置。", "随后根据一致性要求选择控制方式：只需要可见性时使用 volatile；需要复合操作原子性时使用同步机制或原子类；读多写少的场景则优先评估不可变对象和并发集合。", "每次引入同步都应说明它保护的状态以及释放锁后的不变量，这比单纯记忆 API 更可靠。"] },
  { date: "08.06", title: "Prompt Garden 交互调整", body: "完成项目工作区的配色和信息层级优化。", content: ["本次调整重点在于压缩无效的视觉噪声，让工作区在首次进入时先呈现任务，而不是装饰。", "配色减少为中性色和单一强调色，标题、说明和状态的层级通过字号与间距建立。交互状态只在悬停和选中时出现，避免持续争夺注意力。", "后续会继续整理移动端的列表密度和面板折叠行为。"] },
  { date: "07.29", title: "《置身事内》阅读摘要", body: "整理地方经济运行机制及其与具体决策之间的关系。", content: ["地方经济运行并不只是抽象政策的执行结果，也受到土地、融资和招商等具体工具的共同影响。", "阅读时重点关注了政府、企业和金融机构之间的协作关系：不同阶段的目标不同，资源配置的方式也会随之变化。", "这类分析框架可以帮助理解现实项目中的约束条件，而不是只从单一指标判断决策。"] },
];

const categories = ["全部文章", "Java 并发编程", "JUC 基础", "异步工具箱", "后端实践", "系统设计"];

function App() {
  const [view, setView] = useState<View>("home");
  const [apiState, setApiState] = useState<ApiState>("checking");
  const contributionYear = new Date().getFullYear();
  const [githubContributions, setGithubContributions] = useState<GitHubContributions | null>(null);
  const [contributionState, setContributionState] = useState<ContributionState>("loading");
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepositories | null>(null);
  const [repositoryState, setRepositoryState] = useState<RepositoryState>("loading");
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false);
  const [copyNoticeVisible, setCopyNoticeVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState("全部文章");
  const [articlePage, setArticlePage] = useState(1);
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
    guestbook: "访客留言",
  };

  return (
    <main className={`app-shell${view === "home" ? " home-shell" : ""}${view === "articles" ? " articles-shell" : ""}${view === "notes" ? " notes-shell" : ""}${view === "gallery" ? " gallery-shell" : ""}${view === "studio" ? " studio-shell" : ""}${view === "guestbook" ? " guestbook-shell" : ""}`}>
      {(copyNoticeVisible || developerToolsOpen) && <div className="developer-tools-notice" role="status">{copyNoticeVisible ? "复制已完成，转载请标明出处" : "开发者模式已打开，请遵循 GPL 协议"}</div>}
      <header className="site-header">
        <button className="brand" onClick={() => navigate("home")} aria-label="返回首页">
          <span className="brand-mark">A</span>
          <span>ALEX / WORKS</span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button aria-current={view === "home" ? "page" : undefined} className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>主页</button>
          <button aria-current={view === "articles" ? "page" : undefined} className={view === "articles" ? "active" : ""} onClick={() => navigate("articles")}>文章</button>
          <button aria-current={view === "notes" ? "page" : undefined} className={view === "notes" ? "active" : ""} onClick={() => navigate("notes")}>笔记</button>
          <button aria-current={view === "gallery" ? "page" : undefined} className={view === "gallery" ? "active" : ""} onClick={() => navigate("gallery")}>创作图库</button>
          <button aria-current={view === "studio" ? "page" : undefined} className={view === "studio" ? "active" : ""} onClick={() => navigate("studio")}>创作中心</button>
          <button aria-current={view === "guestbook" ? "page" : undefined} className={view === "guestbook" ? "active" : ""} onClick={() => navigate("guestbook")}>留言板</button>
        </nav>
        <span className={`api-pill api-pill-${apiState}`}><span />{apiState === "online" ? "在线" : apiState === "offline" ? "离线 Demo" : "连接中"}</span>
      </header>

      <div className={`page-stage page-stage-${view}`} key={`${view}-${viewSequence}`}>
        {view !== "home" && view !== "guestbook" && view !== "articles" && view !== "notes" && view !== "gallery" && view !== "studio" && <section className="page-intro">
          <h1>{viewTitle[view]}</h1>
          <p className="intro-copy">汇集 Java 技术文章、阅读笔记、AI 图像作品和 AI 编程项目。</p>
        </section>}

        {view === "home" && <Home navigate={navigate} setSelectedArticle={openArticle} repositories={githubRepositories} repositoryState={repositoryState} />}
        {view === "articles" && (
          <Articles activeCategory={activeCategory} setActiveCategory={selectArticleCategory} paginatedArticles={paginatedArticles} articlePage={visibleArticlePage} articlePageCount={articlePageCount} setArticlePage={setArticlePage} setSelectedArticle={openArticle} />
        )}
        {view === "notes" && <Notes setSelectedNote={openNote} />}
        {view === "gallery" && <Gallery creations={creations} setSelectedCreation={openCreation} />}
        {view === "studio" && <Studio contributions={githubContributions} contributionState={contributionState} repositories={githubRepositories} repositoryState={repositoryState} />}
        {view === "guestbook" && <Guestbook visitor={visitor} message={message} setVisitor={setVisitor} setMessage={setMessage} comments={comments} submitMessage={submitMessage} />}
      </div>

      {selectedArticle && <ArticleReader article={selectedArticle} close={() => setSelectedArticle((current) => current === selectedArticle ? null : current)} key={selectedArticle.title} />}
      {selectedCreation && <CreationDrawer creation={selectedCreation} close={() => setSelectedCreation((current) => current === selectedCreation ? null : current)} key={selectedCreation.title} />}
      {selectedNote && <NoteDialog note={selectedNote} close={() => setSelectedNote((current) => current === selectedNote ? null : current)} key={selectedNote.title} />}

      <footer className={`site-footer${view === "notes" ? " notes-footer" : ""}${view === "studio" ? " studio-footer" : ""}`}>
        {view === "notes" ? <><span>© {new Date().getFullYear()} Alex / Works. All rights reserved.</span><span>React · Gin · PostgreSQL</span></> : view === "studio" ? <><span>© {new Date().getFullYear()} Alex / Works</span><div className="studio-footer-links"><a href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer" aria-label="GitHub"><GitBranch size={18} strokeWidth={2.1} /></a><i aria-hidden="true" /><a href="#rss">RSS</a></div></> : <><div className="footer-primary"><strong>NextAlex</strong><span>© {new Date().getFullYear()} NextAlex. All rights reserved.</span></div><div className="footer-meta"><span>Version 0.1.0</span><span>React · Gin · PostgreSQL</span></div><div className="footer-compliance"><span>ICP备案信息待配置</span><span>公安网备信息待配置</span></div></>}
      </footer>
    </main>
  );
}

function Home({ navigate, setSelectedArticle, repositories, repositoryState }: { navigate: (view: View) => void; setSelectedArticle: (article: Article) => void; repositories: GitHubRepositories | null; repositoryState: RepositoryState }) {
  const profileName = "NextAlex";
  const [displayedName, setDisplayedName] = useState("");
  const projects = repositories?.repositories ?? [];

  useEffect(() => {
    let nextCharacter = 0;
    const timer = window.setInterval(() => {
      nextCharacter += 1;
      setDisplayedName(profileName.slice(0, nextCharacter));
      if (nextCharacter === profileName.length) window.clearInterval(timer);
    }, 180);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
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
        </div>
      </section>
      <section className="recent-section home-content">
        <div className="section-heading"><div><h2>近期文章</h2></div><button className="text-action" onClick={() => navigate("articles")}>全部文章 <span>↗</span></button></div>
        <div className="recent-list">{articles.slice(0, 3).map((article, index) => <button className="recent-article" key={article.title} onClick={() => setSelectedArticle(article)}><span className="recent-index">0{index + 1}</span><div><p>{article.category} / {article.series}</p><h3>{article.title}</h3><span>{article.excerpt}</span></div><aside><time>{article.date}</time><small>{article.readTime}</small><b>↗</b></aside></button>)}</div>
      </section>
      <section className="home-lower home-content">
        <div><div className="section-heading compact"><div><h2>创作项目</h2></div><button className="text-action" onClick={() => navigate("studio")}>进入创作中心 <span>↗</span></button></div><div className="home-project-grid">{repositoryState === "ready" && projects.length > 0 ? projects.slice(0, 2).map((project) => <RepositoryProjectCard className="home-project-card" key={project.htmlUrl} project={project} username={repositories?.username || "GitHub"} />) : <p className="home-project-empty">{repositoryState === "loading" ? "正在同步 GitHub 项目" : "GitHub 项目暂不可用"}</p>}</div></div>
        <aside className="guestbook-tease"><h2>笔记与留言</h2><p>查看最新笔记，或提交对文章和创作项目的反馈。</p><div className="tease-actions"><button className="outline-action" onClick={() => navigate("notes")}>查看笔记</button><button className="outline-action" onClick={() => navigate("guestbook")}>进入留言板</button></div></aside>
      </section>
      </div>
    </>
  );
}

function Articles({ activeCategory, setActiveCategory, paginatedArticles, articlePage, articlePageCount, setArticlePage, setSelectedArticle }: { activeCategory: string; setActiveCategory: (category: string) => void; paginatedArticles: Article[]; articlePage: number; articlePageCount: number; setArticlePage: (page: number) => void; setSelectedArticle: (article: Article) => void }) {
  return <section className="content-band article-index"><div className="article-feed"><h1>最新发布</h1><div className="article-list">{paginatedArticles.map((article) => <button className="article-feed-item" key={article.title} onClick={() => setSelectedArticle(article)}><h2>{article.title}</h2><p>{article.excerpt}</p><span className="article-read-action">阅读全文 <i aria-hidden="true">→</i></span></button>)}</div><nav className="article-pagination" aria-label="文章分页"><button className="article-pagination-arrow" type="button" onClick={() => setArticlePage(articlePage - 1)} disabled={articlePage === 1} aria-label="上一页" title="上一页"><ChevronLeft aria-hidden="true" size={17} /></button>{Array.from({ length: articlePageCount }, (_, index) => index + 1).map((page) => <button className={`article-pagination-page${page === articlePage ? " active" : ""}`} type="button" key={page} aria-current={page === articlePage ? "page" : undefined} onClick={() => setArticlePage(page)}>{page}</button>)}<button className="article-pagination-arrow" type="button" onClick={() => setArticlePage(articlePage + 1)} disabled={articlePage === articlePageCount} aria-label="下一页" title="下一页"><ChevronRight aria-hidden="true" size={17} /></button></nav></div><aside className="article-aside"><section className="article-category-panel"><h2>文章分类</h2><div className="article-category-tags" role="tablist" aria-label="文章分类">{categories.map((category) => <button key={category} role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? "filter-active" : ""} onClick={() => setActiveCategory(category)}>{category}</button>)}</div></section><section className="popular-articles"><h2>热门文章</h2><div>{articles.slice(0, 5).map((article) => <button key={article.title} onClick={() => setSelectedArticle(article)}><span aria-hidden="true">→</span>{article.title}</button>)}</div></section></aside></section>;
}

function Notes({ setSelectedNote }: { setSelectedNote: (note: Note) => void }) {
  return <section className="content-band notes-layout"><div className="notes-list"><h1>最近更新</h1>{notes.map((note) => <button className="note-entry" type="button" key={note.title} onClick={() => setSelectedNote(note)}><time>{note.date} / 2026</time><span><h2>{note.title}</h2><p>{note.body}</p></span></button>)}</div><aside className="notes-about"><div className="notes-about-card"><h2>关于本站</h2><p>用于记录学习摘要、项目更新和阅读记录。内容按时间顺序归档。</p><div className="notes-about-links"><a href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer"><GitBranch size={20} aria-hidden="true" />GitHub</a><span><Mail size={20} aria-hidden="true" />Email</span><span><Rss size={20} aria-hidden="true" />RSS</span></div></div></aside></section>;
}

function Gallery({ creations, setSelectedCreation }: { creations: Creation[]; setSelectedCreation: (creation: Creation) => void }) {
  return <section className="gallery-showcase"><div className="gallery-head"><p>展示 AI 生成图像、视觉研究和界面设计作品，按项目归档。</p><span>{String(creations.length).padStart(2, "0")} PROJECTS</span></div><div className="gallery-grid">{creations.map((creation) => <GalleryDisclosureCard creation={creation} key={creation.title} setSelectedCreation={setSelectedCreation} />)}</div></section>;
}

function GalleryDisclosureCard({ creation, setSelectedCreation }: { creation: Creation; setSelectedCreation: (creation: Creation) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleOpen = () => setIsOpen((open) => !open);

  return <article className={`gallery-card${isOpen ? " is-open" : ""}`}>
    <button className="gallery-card-image" type="button" onClick={toggleOpen} aria-label={`${isOpen ? "收起" : "展开"}${creation.title}`} aria-expanded={isOpen}>
      <img src={creation.image} alt={creation.title} />
    </button>
    <div className="gallery-card-disclosure">
      <button className="gallery-card-trigger" type="button" onClick={toggleOpen} aria-expanded={isOpen}>
        <span><strong>{creation.title}</strong><small>模型 / {creation.model}</small></span><ChevronDown aria-hidden="true" size={18} />
      </button>
      <div className="gallery-card-content" aria-hidden={!isOpen}>
        <div><div className="gallery-card-prompt"><span>提示词</span><p>{creation.prompt}</p></div><button type="button" tabIndex={isOpen ? 0 : -1} onClick={() => setSelectedCreation(creation)}>查看详情 <ArrowUpRight size={16} aria-hidden="true" /></button></div>
      </div>
    </div>
  </article>;
}

function RepositoryProjectCard({ project, username, className = "" }: { project: GitHubRepository; username: string; className?: string }) {
  return <a className={`studio-project-card${className ? ` ${className}` : ""}`} href={project.htmlUrl} target="_blank" rel="noreferrer"><div className="studio-project-preview" aria-hidden="true"><span>{username} /</span><strong>{project.name}</strong><GitBranch size={24} strokeWidth={1.8} /></div><div className="studio-project-card-body"><span>{project.language || "Repository"}</span><h3>{project.name}</h3><p>{project.description || "暂无项目说明"}</p><footer><span><Star size={16} />{project.stars}</span><span><GitFork size={16} />{project.forks}</span><time dateTime={project.updatedAt}>{formatRepositoryDate(project.updatedAt)}</time><ArrowUpRight size={19} /></footer></div></a>;
}

function Studio({ contributions, contributionState, repositories, repositoryState }: { contributions: GitHubContributions | null; contributionState: ContributionState; repositories: GitHubRepositories | null; repositoryState: RepositoryState }) {
  const contributionYear = contributions?.year ?? new Date().getFullYear();
  const contributionMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const contributionWeeks = buildContributionWeeks(contributionYear, contributions?.days ?? []);
  const projects = repositories?.repositories ?? [];

  return <section className="studio-layout">
    <div className="studio-overview">
      <div className="studio-intro">
        <p className="section-kicker">创作中心</p>
        <h1>WORKS</h1>
        <span className="studio-title-rule" aria-hidden="true" />
        <div className="studio-stats">
          <div><Code2 size={25} strokeWidth={1.8} /><strong>12</strong><span>Repositories</span></div>
          <div><Star size={25} strokeWidth={1.8} /><strong>68</strong><span>Stars</span></div>
          <div><GitFork size={25} strokeWidth={1.8} /><strong>15</strong><span>Forks</span></div>
          <div><Users size={25} strokeWidth={1.8} /><strong>32</strong><span>Followers</span></div>
        </div>
        <div className="studio-actions"><a className="studio-action-primary" href="https://github.com/CbhHikari0828/NextAlexBlog" target="_blank" rel="noreferrer">View on GitHub <ArrowUpRight size={17} /></a><a className="studio-action-secondary" href="https://github.com/CbhHikari0828?tab=repositories" target="_blank" rel="noreferrer">All Projects <ArrowUpRight size={17} /></a></div>
      </div>
      <section className="contribution-panel" aria-label="项目贡献记录">
        <header><strong>GITHUB CONTRIBUTIONS</strong><a href="https://github.com/CbhHikari0828" target="_blank" rel="noreferrer">{contributionYear} <ChevronDown size={16} /></a></header>
        <div className="contribution-months">{contributionMonths.map((month) => <span key={month}>{month}</span>)}</div>
        <div className="contribution-grid">{contributionWeeks.map((week, weekIndex) => <div className="contribution-week" key={weekIndex}>{week.map((cell, dayIndex) => <i className={`contribution-cell contribution-level-${cell.level}${cell.date ? "" : " contribution-cell-outside"}`} key={dayIndex} title={cell.date ? `${cell.date}: ${cell.count} contributions` : undefined} />)}</div>)}</div>
        <footer><span>{contributionState === "ready" ? `${contributions?.total ?? 0} contributions` : contributionState === "loading" ? "Loading GitHub data" : "GitHub data unavailable"}</span><i className="contribution-cell contribution-level-0" /><i className="contribution-cell contribution-level-1" /><i className="contribution-cell contribution-level-2" /><i className="contribution-cell contribution-level-3" /><i className="contribution-cell contribution-level-4" /></footer>
      </section>
    </div>
    <section className="studio-projects"><header><h2>PROJECTS</h2><span /><a href="https://github.com/CbhHikari0828?tab=repositories" target="_blank" rel="noreferrer">VIEW ALL <ArrowUpRight size={17} /></a></header><div className="studio-project-grid">{repositoryState === "ready" && projects.length > 0 ? projects.map((project) => <RepositoryProjectCard key={project.htmlUrl} project={project} username={repositories?.username || "GitHub"} />) : <p className="studio-project-empty">{repositoryState === "loading" ? "正在同步 GitHub 项目" : "GitHub 项目暂不可用"}</p>}</div></section>
  </section>;
}

function Guestbook({ visitor, message, setVisitor, setMessage, comments, submitMessage }: { visitor: string; message: string; setVisitor: (value: string) => void; setMessage: (value: string) => void; comments: GuestbookComment[]; submitMessage: (event: FormEvent<HTMLFormElement>, color: NoteColor) => void }) {
  const [selectedColor, setSelectedColor] = useState<NoteColor>("ice");
  const visibleComments = comments.length > 0 ? comments : mockGuestbookComments;
  const boardHeight = 690 + Math.max(0, Math.ceil(visibleComments.length / noteLayouts.length) - 1) * 180;

  return <><div className="guestbook-background" aria-hidden="true" /><section className="guestbook-wall"><div className="guestbook-canvas"><div className="note-board" aria-live="polite" style={{ "--note-board-height": `${boardHeight}px` } as React.CSSProperties}>{visibleComments.map((comment, index) => { const layout = getNoteLayout(index); return <article className={`visitor-note visitor-note-${comment.color}`} key={`${comment.name}-${index}`} style={{ "--note-x": layout.x, "--note-y": layout.y, "--note-tilt": `${layout.tilt}deg`, "--note-z": layout.z, "--note-delay": `${index * 55}ms` } as React.CSSProperties}><div className="visitor-note-top"><span className="note-pins"><i /><i /><i /></span><time>{comment.date}</time></div><p>{comment.body}</p><footer>{comment.name}</footer></article>; })}</div><section className="guestbook-editor"><form className="message-form guestbook-editor-form" onSubmit={(event) => submitMessage(event, selectedColor)}><h2>发布留言</h2><label>姓名或昵称<input value={visitor} onChange={(event) => setVisitor(event.target.value)} placeholder="请输入姓名或昵称" maxLength={20} required /></label><label>留言内容<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="请输入留言内容" maxLength={160} rows={5} required /></label><div className="note-color-picker" aria-label="便签颜色">{noteColors.map((color) => <button key={color} type="button" className={`note-color note-color-${color}${selectedColor === color ? " selected" : ""}`} onClick={() => setSelectedColor(color)} aria-label={`选择${color}颜色`} />)}</div><div className="message-form-footer"><span>{message.length}/160</span><button className="solid-action" type="submit">发布便签 <span>↗</span></button></div></form></section></div></section></>;
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
        <button className="close-button" onClick={requestClose} aria-label="关闭" ref={closeButtonRef}>×</button>
        <time>{note.date} / 2026</time>
        <h2>{note.title}</h2>
        <div className="note-dialog-content">{note.content.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </article>
    </div>
  );
}

export default App;
