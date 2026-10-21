export type ArticleAssistantRole = "user" | "assistant";

export type ArticleAssistantHistoryItem = {
  role: ArticleAssistantRole;
  content: string;
};

// Keep a margin below the backend's 6,000-rune limit for future request-shape
// changes while preserving a coherent, recent conversation suffix.
export const articleAssistantMaxHistoryItems = 8;
export const articleAssistantHistoryRuneBudget = 5_600;

function runeLength(value: string) {
  return Array.from(value).length;
}

export function limitArticleAssistantHistory(history: ArticleAssistantHistoryItem[]) {
  const normalized = history
    .map((item) => ({ ...item, content: item.content.trim() }))
    .filter((item) => item.content.length > 0)
    .slice(-articleAssistantMaxHistoryItems);
  const kept: ArticleAssistantHistoryItem[] = [];
  let totalRunes = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const item = normalized[index];
    const itemRunes = runeLength(item.content);
    if (totalRunes + itemRunes > articleAssistantHistoryRuneBudget) break;
    kept.push(item);
    totalRunes += itemRunes;
  }

  return kept.reverse();
}

export type ArticleAssistantSource = {
  id: string;
  articleId: number;
  slug: string;
  title: string;
  excerpt: string;
};

type StreamArticleAssistantOptions = {
  message: string;
  history: ArticleAssistantHistoryItem[];
  signal: AbortSignal;
  onSources: (sources: ArticleAssistantSource[]) => void;
  onDelta: (content: string) => void;
  onDone: (sources: ArticleAssistantSource[]) => void;
};

export class ArticleAssistantError extends Error {
  code: string;

  constructor(message: string, code = "assistant_error") {
    super(message);
    this.name = "ArticleAssistantError";
    this.code = code;
  }
}

function parseSources(value: unknown): ArticleAssistantSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((source) => {
    if (!source || typeof source !== "object") return [];
    const candidate = source as Partial<ArticleAssistantSource>;
    if (
      typeof candidate.id !== "string"
      || !Number.isInteger(candidate.articleId)
      || Number(candidate.articleId) <= 0
      || typeof candidate.title !== "string"
    ) return [];

    return [{
      id: candidate.id,
      articleId: Number(candidate.articleId),
      slug: typeof candidate.slug === "string" ? candidate.slug : "",
      title: candidate.title,
      excerpt: typeof candidate.excerpt === "string" ? candidate.excerpt : "",
    }];
  });
}

async function readRequestError(response: Response) {
  const fallback = `智能助手暂时不可用（${response.status}）`;
  try {
    const payload = await response.json() as { code?: unknown; message?: unknown; error?: unknown };
    const message = typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string" ? payload.error : fallback;
    const code = typeof payload.code === "string" ? payload.code : `http_${response.status}`;
    return new ArticleAssistantError(message, code);
  } catch {
    return new ArticleAssistantError(fallback, `http_${response.status}`);
  }
}

function parseEventBlock(block: string) {
  let event = "message";
  const data: string[] = [];

  block.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  });

  return { event, data: data.join("\n") };
}

export async function streamArticleAssistant({
  message,
  history,
  signal,
  onSources,
  onDelta,
  onDone,
}: StreamArticleAssistantOptions) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, history }),
    signal,
  });

  if (!response.ok) throw await readRequestError(response);
  if (!response.body) throw new ArticleAssistantError("回答连接未返回数据", "empty_stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let receivedDeltaText = false;
  let streamEnded = false;

  const consumeBlock = (block: string) => {
    const parsed = parseEventBlock(block);
    if (!parsed.data) return;

    let payload: unknown;
    try {
      payload = JSON.parse(parsed.data);
    } catch {
      throw new ArticleAssistantError("回答数据格式异常", "invalid_stream_data");
    }

    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (parsed.event === "sources") {
      onSources(parseSources(data.sources));
      return;
    }
    if (parsed.event === "delta") {
      if (typeof data.content === "string" && data.content) {
        if (data.content.trim()) receivedDeltaText = true;
        onDelta(data.content);
      }
      return;
    }
    if (parsed.event === "done") {
      completed = true;
      onDone(parseSources(data.sources));
      return;
    }
    if (parsed.event === "error") {
      throw new ArticleAssistantError(
        typeof data.message === "string" ? data.message : "智能助手暂时不可用",
        typeof data.code === "string" ? data.code : "stream_error",
      );
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      streamEnded = done;
      buffer += decoder.decode(value, { stream: !done });

      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
        buffer = buffer.slice(boundary + separator.length);
        consumeBlock(block);
        if (completed) break;
        boundary = buffer.search(/\r?\n\r?\n/);
      }

      if (done || completed) break;
    }

    if (!completed && buffer.trim()) consumeBlock(buffer);
    if (!completed) throw new ArticleAssistantError("回答连接意外中断，请重试", "incomplete_stream");
    if (!receivedDeltaText) throw new ArticleAssistantError("智能助手未返回讲解正文，请重试", "empty_answer");
  } finally {
    if (!streamEnded) {
      try {
        await reader.cancel();
      } catch {
        // The fetch may already have closed the stream while handling an error.
      }
    }
    reader.releaseLock();
  }
}
