const DEFAULT_PRESET_PROMPTS = [
  "生成视频摘要和结论",
  "按章节整理视频内容",
  "生成带时间轴的笔记"
];
const DEFAULT_INITIAL_QUICK_PROMPTS = [
  "用 3 句话总结这个视频",
  "提炼这个视频的 5 个重点",
  "按时间顺序整理这期视频的内容",
  "根据评论总结观众的看法"
];
const DEFAULT_PLAYER_AI_QUICK_PROMPT = "整理这期视频的内容，输出结构化总结：主题、核心观点、关键细节、结论与可执行启发。";
const PLAYER_AI_QUICK_ACTION_STORAGE_KEY = "yoc_player_ai_quick_action_v1";
const STREAM_FIRST_TOKEN_TIMEOUT_MS = 90000;
const LEGACY_DEFAULT_AI_SYSTEM_PROMPT = [
  "你是一名专业的视频内容分析助手。基于字幕与评论提炼高价值信息，不要复述内容，不要输出思考过程或 think 标签。",
  "优先输出：主题与核心观点、关键数据与事实、逻辑链路与重要结论、可执行建议。",
  "回答应结构化、信息密度高、便于收藏和复习；自动过滤广告、废话和重复表达。",
  "信息不足时明确说明，不得猜测或编造；涉及专业内容时，区分事实、数据、推测与作者观点。",
  "输出时间戳时请使用普通正文格式，如 09:15、01:09:15，不要使用反引号、代码块或表格代码格式包裹时间戳。"
].join("\n");
const DEFAULT_AI_SYSTEM_PROMPT = [
  "你是一名专业的视频内容分析助手。",
  "基于字幕与评论提炼高价值信息，不要复述内容，不要输出思考过程或 think 标签。",
  "优先输出：主题与核心观点、关键数据与事实、逻辑链路与重要结论、可执行建议。",
  "回答应结构化、信息密度高、便于收藏和复习，可适当使用 Emoji、列表和表格。",
  "自动过滤广告、废话和重复表达。",
  "信息不足时明确说明，不得猜测或编造；涉及专业内容时，区分事实、数据、推测与作者观点。",
  "输出时间戳时请使用普通正文格式，如 09:15、01:09:15，不要使用反引号、代码块或表格代码格式包裹时间戳。"
].join("\n");

const DEFAULT_SYNC_SETTINGS = {
  noteFolder: "Clippings/YouTube",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  tags: "clippings,youtube",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeHotCommentsInNote: false,
  enablePlayerAiQuickAction: false,
  playerAiQuickPrompt: DEFAULT_PLAYER_AI_QUICK_PROMPT,
  includeTimestampInBody: true,
  enableDebugLogs: false,
  readerTheme: "light",
  readerFontScale: "m",
  readerLetterSpacing: "normal",
  readerLineHeight: "tight",
  readerContentWidth: "medium",
  readerChapterVisibility: "show",
  readerTranscriptVisible: true,
  frontmatterFields: [
    "title",
    "url",
    "videoId",
    "author",
    "upload_date",
    "subtitle_lang",
    "created",
    "tags"
  ],
  fixedFrontmatterProperties: [],
  notePlaceholderSections: [],
  aiSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  aiInitialQuickPrompts: DEFAULT_INITIAL_QUICK_PROMPTS.slice(),
  aiPresetPrompts: DEFAULT_PRESET_PROMPTS.slice()
};

const DEFAULT_LOCAL_SETTINGS = {
  obsidianApiKey: ""
};
const EXPECTED_CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version || "";

chrome.runtime.onInstalled.addListener(async () => {
  await initializeSettingsStorage();
});

async function ensureReaderContentReady(tabId) {
  if (!chrome.scripting || !tabId) {
    return;
  }

  const loadedVersion = await probeContentScriptVersion(tabId);
  if (loadedVersion === EXPECTED_CONTENT_SCRIPT_VERSION) {
    return;
  }

  await injectReaderContent(tabId);
  const reinjectedVersion = await probeContentScriptVersion(tabId);
  if (reinjectedVersion === EXPECTED_CONTENT_SCRIPT_VERSION) {
    return;
  }

  if (loadedVersion && loadedVersion !== EXPECTED_CONTENT_SCRIPT_VERSION) {
    await chrome.tabs.reload(tabId);
    const ready = await waitForTabComplete(tabId);
    if (!ready) {
      throw new Error("扩展更新后页面未及时恢复，请刷新浏览器网页重试");
    }
    await sleep(120);
    await injectReaderContent(tabId);
    const reloadedVersion = await probeContentScriptVersion(tabId);
    if (reloadedVersion === EXPECTED_CONTENT_SCRIPT_VERSION) {
      return;
    }
  }

  throw new Error("扩展脚本未能和当前页面同步，请刷新浏览器网页重试");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeContentScriptVersion(tabId) {
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__YOC_CONTENT_SCRIPT_LOADED__ || ""
    });
    return String(probe?.[0]?.result || "");
  } catch {
    return "";
  }
}

async function injectReaderContent(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("Identifier 'DEFAULT_SETTINGS' has already been declared")) {
      throw error;
    }
  }
}

async function waitForTabComplete(tabId, retries = 40, delayMs = 250) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === "complete") {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

async function triggerReaderModeInTab(tabId, readerUrl = "", retries = 12, delayMs = 300) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(delayMs);
    }

    try {
      const response = await sendMessageToTab(tabId, {
        type: "popup-trigger-reading-view",
        readerUrl
      });
      if (response?.ok) {
        return true;
      }
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("Could not establish connection. Receiving end does not exist.")) {
        try {
          await ensureReaderContentReady(tabId);
        } catch {
          // keep retrying
        }
        continue;
      }
    }
  }

  return false;
}

function isSupportedAiTabUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!parsed.hostname.includes("youtube.com")) {
      if (parsed.hostname !== "youtu.be") return false;
      const match = parsed.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      return Boolean(match);
    }
    return parsed.pathname.startsWith("/watch") || parsed.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

async function getAiSidepanelState(tabId, { forceRefresh = false } = {}) {
  if (!tabId) {
    throw new Error("缺少标签页信息");
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    throw new Error("找不到当前标签页。");
  }

  if (!isSupportedAiTabUrl(tab.url)) {
    return {
      title: String(tab.title || "").trim(),
      url: String(tab.url || "").trim(),
      author: "",
      uploadDate: "",
      subtitleMarkdown: "",
      subtitleBody: [],
      hotComments: [],
      isVideoContext: false
    };
  }

  await ensureReaderContentReady(tab.id);

  let contextResp = await sendMessageToTab(tab.id, { type: "sidepanel-get-context" });
  const hasPayload = Boolean(contextResp?.ok && contextResp?.payload);
  const hasLoadedClip = Boolean(
    contextResp?.payload?.videoId ||
    contextResp?.payload?.title
  );
  const needsRefresh =
    forceRefresh ||
    !hasPayload ||
    (!hasLoadedClip && (!Array.isArray(contextResp.payload.subtitleBody) || !contextResp.payload.subtitleBody.length));

  if (needsRefresh) {
    const refreshResp = await sendMessageToTab(tab.id, { type: "popup-refresh" });
    if (!refreshResp?.ok) {
      throw new Error(refreshResp?.error || "当前视频上下文加载失败");
    }
    contextResp = await sendMessageToTab(tab.id, { type: "sidepanel-get-context" });
  }

  if (!contextResp?.ok || !contextResp?.payload) {
    throw new Error("当前页面上下文读取失败");
  }

  let hotComments = [];
  try {
    const commentsResp = await sendMessageToTab(tab.id, { type: "sidepanel-get-hot-comments" });
    if (commentsResp?.ok && Array.isArray(commentsResp.comments)) {
      hotComments = commentsResp.comments;
    }
  } catch {
    // 评论失败时静默降级，避免阻断主流程
  }

  return {
    ...contextResp.payload,
    hotComments,
    isVideoContext: true
  };
}

async function openAiSidepanelForTab(tabId) {
  if (globalThis.browser?.sidebarAction?.open) {
    await Promise.resolve(globalThis.browser.sidebarAction.open());
    return;
  }

  if (chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ tabId });
    return;
  }

  throw new Error("当前浏览器不支持扩展侧边栏");
}

function buildPlayerAiQuickActionRequest(tabId, prompt) {
  const createdAt = Date.now();
  return {
    id: `player-ai-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    tabId: Number(tabId || 0) || 0,
    prompt: normalizePlayerAiQuickPrompt(prompt),
    createdAt
  };
}

function normalizeAiContextRef(ref) {
  const value = ref && typeof ref === "object" ? ref : {};
  return {
    title: String(value.title || "").trim(),
    url: String(value.url || "").trim(),
    author: String(value.author || "").trim(),
    uploadDate: String(value.uploadDate || "").trim(),
    videoId: String(value.videoId || extractVideoIdFromUrl(value.url) || "").trim(),
    subtitleLang: String(value.subtitleLang || "").trim(),
    selectedSubtitleId: String(value.selectedSubtitleId || "").trim(),
    selectedSubtitleUrl: String(value.selectedSubtitleUrl || "").trim(),
    isVideoContext: value.isVideoContext !== false
  };
}

function extractVideoIdFromUrl(url) {
  const text = String(url || "").trim();
  let match = text.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  match = text.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  match = text.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  match = text.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  return "";
}

function formatLocalDate(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildCanonicalVideoUrl(videoId) {
  const safeId = String(videoId || "").trim();
  if (!safeId) return "";
  return `https://www.youtube.com/watch?v=${safeId}`;
}

function createHeaders(url) {
  const headers = new Headers();
  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchYoutubeVideoMeta(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const payload = await fetchJson(url);
    return {
      videoId,
      title: String(payload.title || "").trim(),
      author: String(payload.author_name || "").trim(),
      uploadDate: "",
      duration: 0
    };
  } catch {
    return {
      videoId,
      title: "",
      author: "",
      uploadDate: "",
      duration: 0
    };
  }
}

function normalizeSubtitleUrl(url) {
  const text = String(url || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("//")) {
    return `https:${text}`;
  }
  return text;
}

function normalizeChapterTime(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

function normalizeChapters(chapters) {
  const normalized = (chapters || [])
    .map((item) => ({
      title: String(item?.title || "").trim(),
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0
    }))
    .filter((item) => item.title && item.from >= 0)
    .sort((a, b) => a.from - b.from);

  const unique = [];
  const seen = new Set();
  normalized.forEach((item) => {
    const key = `${Math.floor(item.from * 10)}|${item.title.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(item);
  });
  return unique;
}

function normalizeSubtitleTracks(subtitles) {
  return [...(subtitles || [])].sort((a, b) => {
    const priorityGap = subtitlePriority(a) - subtitlePriority(b);
    if (priorityGap !== 0) {
      return priorityGap;
    }
    return String(a.subtitleUrl || "").localeCompare(String(b.subtitleUrl || ""));
  });
}

function subtitlePriority(item) {
  const lan = String(item?.lan || "").toLowerCase();
  const label = String(item?.lanDoc || "").toLowerCase();
  if (lan === "zh-cn" || lan === "zh-hans") return 0;
  if (lan === "zh") return 1;
  if (lan.includes("zh")) return 2;
  if (label.includes("中文")) return 3;
  if (lan === "en" || lan === "en-us" || lan === "en-gb") return 10;
  if (lan.includes("en")) return 11;
  if (label.includes("英文") || label.includes("英语") || label.includes("english")) return 12;
  return 50;
}

function normalizeSubtitleUrlForCache(url) {
  const text = String(url || "").trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    const path = parsed.pathname.replace(/[^\w/.-]+/g, "_");
    return `${parsed.hostname}${path}`;
  } catch {
    return text.replace(/[^\w/.-]+/g, "_");
  }
}

function pickPreferredSubtitleTrack(subtitles, { previousId = "", previousUrl = "", previousLang = "" } = {}) {
  const tracks = subtitles || [];
  if (!tracks.length) {
    return null;
  }

  if (previousId) {
    const byId = tracks.find((item) => String(item.id || "") === String(previousId));
    if (byId) {
      return byId;
    }
  }

  const normalizedUrl = normalizeSubtitleUrlForCache(previousUrl);
  if (normalizedUrl) {
    const byUrl = tracks.find((item) => normalizeSubtitleUrlForCache(item.subtitleUrl) === normalizedUrl);
    if (byUrl) {
      return byUrl;
    }
  }

  const normalizedLang = String(previousLang || "").trim().toLowerCase();
  if (normalizedLang) {
    const byLang = tracks.find((item) => String(item.lanDoc || item.lan || "").trim().toLowerCase() === normalizedLang);
    if (byLang) {
      return byLang;
    }
  }

  return tracks[0];
}

function shouldShowHoursInAiNote(meta, body) {
  const subtitleMaxTo = (body || []).reduce((max, item) => Math.max(max, Number(item?.to || 0) || 0), 0);
  const chapterMaxTo = (meta?.chapters || []).reduce((max, item) => Math.max(max, Number(item?.from || 0) || 0, Number(item?.to || 0) || 0), 0);
  const duration = Number(meta?.videoDuration || 0) || 0;
  return Math.max(subtitleMaxTo, chapterMaxTo, duration) >= 3600;
}

function formatCompactTimestamp(seconds, withHours) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  const second = safe % 60;
  if (withHours) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  const totalMinutes = Math.floor(safe / 60);
  return `${String(totalMinutes).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function buildAiSubtitleLine(item, includeTimestampInBody, withHours) {
  const text = String(item?.content || "").trim();
  if (!text) {
    return "";
  }
  if (!includeTimestampInBody) {
    return text;
  }
  return `\`${formatCompactTimestamp(item.from, withHours)}\` ${text}`;
}

function buildAiSubtitleSectionLines(body, chapters, includeTimestampInBody, withHours) {
  const subtitleItems = (body || [])
    .map((item, index) => ({ ...item, _index: index, text: String(item?.content || "").trim() }))
    .filter((item) => item.text);
  if (!subtitleItems.length) {
    return ["（暂无字幕）"];
  }

  if (!Array.isArray(chapters) || !chapters.length) {
    return subtitleItems.map((item) => buildAiSubtitleLine(item, includeTimestampInBody, withHours));
  }

  const lines = [];
  const usedIndexes = new Set();
  chapters.forEach((chapter, idx) => {
    const start = Number(chapter.from || 0) || 0;
    const next = chapters[idx + 1];
    const chapterTo = Number(chapter.to || 0) || 0;
    let end = Infinity;
    if (next && Number(next.from) > start) {
      end = Number(next.from);
    } else if (chapterTo > start) {
      end = chapterTo;
    }
    const sectionItems = subtitleItems.filter((item) => {
      const from = Number(item.from || 0) || 0;
      return from + 0.001 >= start && (end === Infinity ? true : from < end);
    });
    if (!sectionItems.length) {
      return;
    }
    const chapterStamp = includeTimestampInBody ? ` \`${formatCompactTimestamp(start, withHours)}\`` : "";
    lines.push(`### ${chapter.title}${chapterStamp}`, "");
    sectionItems.forEach((item) => {
      usedIndexes.add(item._index);
      lines.push(buildAiSubtitleLine(item, includeTimestampInBody, withHours));
    });
    lines.push("");
  });

  const remaining = subtitleItems.filter((item) => !usedIndexes.has(item._index));
  if (remaining.length) {
    lines.push("### 其他片段", "");
    remaining.forEach((item) => lines.push(buildAiSubtitleLine(item, includeTimestampInBody, withHours)));
  }

  while (lines.length && !lines[lines.length - 1]) {
    lines.pop();
  }
  return lines;
}

function buildAiConversationMarkdown(meta, body, settings) {
  const includeTimestampInBody = settings?.includeTimestampInBody !== false;
  const withHours = shouldShowHoursInAiNote(meta, body);
  const lines = [];
  const chapters = Array.isArray(meta?.chapters) ? meta.chapters : [];
  if (chapters.length) {
    lines.push("## 章节", "");
    chapters.forEach((item) => {
      const stamp = includeTimestampInBody ? `\`${formatCompactTimestamp(item.from, withHours)}\` ` : "";
      lines.push(`- ${stamp}${item.title}`);
    });
    lines.push("");
  }
  lines.push("## 字幕", "", ...buildAiSubtitleSectionLines(body, chapters, includeTimestampInBody, withHours));
  return lines.join("\n");
}

async function resolveAiSidepanelContext(contextRef) {
  const ref = normalizeAiContextRef(contextRef);
  if (!ref.isVideoContext || !ref.videoId) {
    return {
      title: ref.title,
      url: ref.url,
      author: ref.author,
      uploadDate: ref.uploadDate,
      subtitleMarkdown: "",
      subtitleBody: [],
      hotComments: [],
      isVideoContext: false
    };
  }

  let meta = { title: ref.title, author: ref.author, uploadDate: ref.uploadDate };
  try {
    const ytMeta = await fetchYoutubeVideoMeta(ref.videoId);
    if (ytMeta.title && !meta.title) meta.title = ytMeta.title;
    if (ytMeta.author && !meta.author) meta.author = ytMeta.author;
  } catch {}

  return {
    ...meta,
    videoId: ref.videoId,
    url: buildCanonicalVideoUrl(ref.videoId) || ref.url,
    subtitleLang: ref.subtitleLang,
    selectedSubtitleId: ref.selectedSubtitleId,
    selectedSubtitleUrl: ref.selectedSubtitleUrl,
    subtitleBody: [],
    subtitleMarkdown: "",
    subtitleOptions: [],
    hotComments: [],
    isVideoContext: true
  };
}

async function resolveAiSidepanelPageRef(contextRef) {
  const ref = normalizeAiContextRef(contextRef);
  if (!ref.isVideoContext || !ref.videoId) {
    return { url: ref.url, videoId: ref.videoId };
  }
  return {
    url: buildCanonicalVideoUrl(ref.videoId) || ref.url,
    videoId: ref.videoId
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "get-settings") {
    getMergedSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "save-settings") {
    saveSettings(message.settings || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "open-options") {
    chrome.tabs
      .create({ url: chrome.runtime.getURL("options.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "player-ai-quick-action") {
    const tabId = Number(message.tabId || sender?.tab?.id || 0) || 0;
    if (!tabId) {
      sendResponse({ ok: false, error: "找不到当前标签页。" });
      return false;
    }

    const openPromise = openAiSidepanelForTab(tabId);
    getMergedSettings()
      .then(async (settings) => {
        if (!settings.enablePlayerAiQuickAction) {
          throw new Error("AI 按钮未开启");
        }
        await openPromise;
        const request = buildPlayerAiQuickActionRequest(tabId, settings.playerAiQuickPrompt);
        await chrome.storage.local.set({ [PLAYER_AI_QUICK_ACTION_STORAGE_KEY]: request });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || "打开 AI 侧边栏失败" }));
    return true;
  }

  if (message.type === "open-reading-view-tab") {
    const url = String(message.url || "").trim();
    const tabId = Number(message.tabId || 0) || 0;
    if (!url) {
      sendResponse({ ok: false, error: "缺少视频地址" });
      return false;
    }
    if (!tabId) {
      sendResponse({ ok: false, error: "缺少标签页信息" });
      return false;
    }

    let readerUrl = "";
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes("youtube.com") && parsed.hostname !== "youtu.be") {
        throw new Error("当前网页不是 YouTube 视频页");
      }
      parsed.searchParams.set("yoc_reader", "1");
      readerUrl = parsed.toString();
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "阅读视图地址无效" });
      return false;
    }

    ensureReaderContentReady(tabId)
      .then(() => triggerReaderModeInTab(tabId, readerUrl))
      .then((triggered) => {
        if (!triggered) {
          throw new Error("阅读视图触发失败，请刷新浏览器网页重试");
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  // 🎯 核心入口：用 ANDROID client POST /youtubei/v1/player
  // 这是唯一能拿到**不带 exp=xpe 参数**的 timedtext URL 的方式
  // ytInitialPlayerResponse 里的 baseUrl 带 exp=xpe，fetch 会返回空 body
  if (message.type === "get-android-player-data") {
    (async () => {
      const videoId = String(message.videoId || "").trim();
      const apiKey = String(message.apiKey || "").trim();
      if (!videoId) { sendResponse({ ok: false, error: "Missing videoId" }); return; }
      if (!apiKey) { sendResponse({ ok: false, error: "Missing apiKey" }); return; }

      const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
      const body = {
        context: {
          client: { clientName: "ANDROID", clientVersion: "20.10.38" }
        },
        videoId
      };

      try {
        console.log("[YOC BG] POST player API (ANDROID)", { videoId });
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store"
        });
        if (!resp.ok) {
          sendResponse({ ok: false, error: `HTTP ${resp.status}` });
          return;
        }
        const data = await resp.json();
        if (data?.playabilityStatus?.status !== "OK") {
          sendResponse({ ok: false, error: `playability: ${data?.playabilityStatus?.status}` });
          return;
        }

        const d = data.videoDetails || {};
        const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

        console.log("[YOC BG] ANDROID player success", {
          title: d.title,
          tracks: tracks.length,
          urls_have_exp: tracks.map(t => t.baseUrl?.includes("exp=xpe")).join(",")
        });

        sendResponse({
          ok: true,
          data: {
            videoDetails: {
              title: d.title || "",
              author: d.author || "",
              channelId: d.channelId || "",
              lengthSeconds: d.lengthSeconds || "0",
              shortDescription: d.shortDescription || "",
              videoId: d.videoId || videoId,
              isLiveContent: d.isLiveContent || false,
              thumbnailUrl: d.thumbnail?.thumbnails?.slice(-1)[0]?.url || ""
            },
            captionTracks: tracks.map((t) => ({
              vssId: t.vssId || "",
              baseUrl: t.baseUrl || "",
              name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join("") || t.name || "",
              languageCode: t.languageCode || "",
              kind: t.kind || ""
            }))
          }
        });
      } catch (error) {
        console.error("[YOC BG] ANDROID player error:", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  }

  // 统一入口：从 YouTube 页面一站式获取 playerResponse（精简字段）+ 字幕
  if (message.type === "get-youtube-data") {
    (async () => {
      const tabId = Number(sender?.tab?.id || 0) || 0;
      if (!tabId) { sendResponse({ ok: false, error: "Missing tabId" }); return; }
      if (!chrome.scripting) { sendResponse({ ok: false, error: "chrome.scripting not available" }); return; }

      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            // 只提取必要字段，避免 structured clone 大对象（几 MB）静默失败
            // 返回一个纯数据 plain object
            try {
              const r = window.ytInitialPlayerResponse;
              if (!r) return null;
              const d = r.videoDetails || {};
              const tracks =
                r.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
              return {
                videoDetails: {
                  title: d.title || "",
                  author: d.author || "",
                  channelId: d.channelId || "",
                  lengthSeconds: d.lengthSeconds || "0",
                  shortDescription: d.shortDescription || "",
                  videoId: d.videoId || "",
                  isLiveContent: d.isLiveContent || false,
                  thumbnailUrl: d.thumbnail?.thumbnails?.slice(-1)[0]?.url || ""
                },
                captionTracks: tracks.map((t) => ({
                  vssId: t.vssId || "",
                  baseUrl: t.baseUrl || "",
                  name: t.name?.simpleText || t.name || "",
                  languageCode: t.languageCode || "",
                  kind: t.kind || "" // "asr" = 自动字幕
                }))
              };
            } catch (e) {
              return { __error__: String(e?.message || e) };
            }
          }
        });
      } catch (e) {
        console.error("[YOC BG] executeScript failed", e);
        sendResponse({ ok: false, error: "executeScript 失败: " + (e?.message || e) });
        return;
      }

      const extracted = results?.[0]?.result;
      if (!extracted || extracted.__error__) {
        console.warn("[YOC BG] MAIN world 提取失败", extracted);
        sendResponse({ ok: false, error: "无法从页面获取 playerResponse" });
        return;
      }
      const videoDetails = extracted.videoDetails || {};
      const captionTracks = extracted.captionTracks || [];

      // get-youtube-data handler 只返回 tracks 元数据（不带 body），
      // body 由 fetchSubtitleBody 按需通过 fetch-json handler 获取（更灵活）

      console.log("[YOC BG] get-youtube-data success", {
        title: videoDetails.title,
        tracks: captionTracks.length
      });

      sendResponse({
        ok: true,
        data: {
          videoDetails,
          tracks: captionTracks
        }
      });
    })();
    return true;
  }

  if (message.type === "get-youtube-player-response") {
    // 兼容旧调用
    (async () => {
      const tabId = Number(sender?.tab?.id || 0) || 0;
      if (!tabId) { sendResponse({ ok: false, error: "Missing tabId" }); return; }
      if (!chrome.scripting) { sendResponse({ ok: false, error: "chrome.scripting not available" }); return; }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            try {
              const r = window.ytInitialPlayerResponse;
              if (!r) return null;
              const d = r.videoDetails || {};
              const tracks = r.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
              return {
                videoDetails: {
                  title: d.title || "",
                  author: d.author || "",
                  channelId: d.channelId || "",
                  lengthSeconds: d.lengthSeconds || "0",
                  shortDescription: d.shortDescription || "",
                  videoId: d.videoId || "",
                  isLiveContent: d.isLiveContent || false,
                  thumbnailUrl: d.thumbnail?.thumbnails?.slice(-1)[0]?.url || ""
                },
                captionTracks: tracks.map((t) => ({
                  vssId: t.vssId || "",
                  baseUrl: t.baseUrl || "",
                  name: t.name?.simpleText || t.name || "",
                  languageCode: t.languageCode || "",
                  kind: t.kind || ""
                }))
              };
            } catch (e) { return null; }
          }
        });
        const data = results?.[0]?.result || null;
        sendResponse({ ok: Boolean(data), data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (message.type === "fetch-json") {
    const url = typeof message.url === "string" ? message.url : "";
    if (!url) {
      sendResponse({ ok: false, error: "Missing subtitle URL" });
      return false;
    }

    fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, error: `HTTP ${response.status}` });
          return;
        }

        const text = await response.text();
        if (!text || !text.trim()) {
          sendResponse({ ok: false, error: "响应为空" });
          return;
        }
        try {
          const data = JSON.parse(text);
          sendResponse({ ok: true, data, text, isJson: true });
        } catch {
          // 不是 JSON（可能是 XML srv3 格式的字幕），返回原始文本
          sendResponse({ ok: true, data: null, text, isJson: false });
        }
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "write-obsidian-note") {
    const baseUrl = String(message.baseUrl || "").trim();
    const apiKey = String(message.apiKey || "").trim();
    const filepath = String(message.filepath || "").trim();
    const content = typeof message.content === "string" ? message.content : "";

    if (!baseUrl || !apiKey || !filepath) {
      sendResponse({ ok: false, error: "缺少 Local REST API 参数" });
      return false;
    }

    const encodedPath = filepath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const endpoint = `${baseUrl.replace(/\/+$/g, "")}/vault/${encodedPath}`;

    fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "text/markdown; charset=utf-8"
      },
      body: content
    })
      .then(async (response) => {
        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          const detail = bodyText ? ` ${bodyText.slice(0, 200)}` : "";
          sendResponse({ ok: false, error: `HTTP ${response.status}.${detail}` });
          return;
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "obsidian-note-exists") {
    const baseUrl = String(message.baseUrl || "").trim();
    const apiKey = String(message.apiKey || "").trim();
    const filepath = String(message.filepath || "").trim();

    if (!baseUrl || !apiKey || !filepath) {
      sendResponse({ ok: false, error: "缺少 Local REST API 参数" });
      return false;
    }

    const encodedPath = filepath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const endpoint = `${baseUrl.replace(/\/+$/g, "")}/vault/${encodedPath}`;

    fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/markdown, text/plain, application/json, */*"
      },
      cache: "no-store"
    })
      .then(async (response) => {
        if (response.status === 404) {
          sendResponse({ ok: true, exists: false });
          return;
        }
        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          const detail = bodyText ? ` ${bodyText.slice(0, 200)}` : "";
          sendResponse({ ok: false, error: `HTTP ${response.status}.${detail}` });
          return;
        }
        sendResponse({ ok: true, exists: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "test-obsidian-connection") {
    const baseUrl = String(message.baseUrl || "").trim();
    const apiKey = String(message.apiKey || "").trim();

    if (!baseUrl || !apiKey) {
      sendResponse({ ok: false, error: "缺少 Local REST API 参数" });
      return false;
    }

    const endpoint = `${baseUrl.replace(/\/+$/g, "")}/`;
    fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json, text/plain, */*"
      },
      cache: "no-store"
    })
      .then(async (response) => {
        const bodyText = await response.text().catch(() => "");
        let data = null;
        try {
          data = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          data = null;
        }

        if (!response.ok) {
          const detail = bodyText ? ` ${bodyText.slice(0, 200)}` : "";
          sendResponse({ ok: false, error: `HTTP ${response.status}.${detail}` });
          return;
        }

        if (data && data.authenticated === false) {
          sendResponse({ ok: false, error: "API Key 无效或未授权" });
          return;
        }

        sendResponse({
          ok: true,
          service: typeof data?.service === "string" ? data.service : "Obsidian Local REST API"
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: formatConnectionError(error) });
      });

    return true;
  }

  if (message.type === "ai-providers-list") {
    loadAiProviders()
      .then((items) => sendResponse({ ok: true, providers: items }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-providers-save") {
    saveAiProviders(message.providers || [])
      .then((items) => sendResponse({ ok: true, providers: items }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-provider-set-key") {
    saveAiProviderKey(String(message.providerId || ""), String(message.apiKey || ""))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-providers-delete") {
    deleteAiProvider(String(message.providerId || ""))
      .then((items) => sendResponse({ ok: true, providers: items }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-providers-test") {
    const baseUrl = String(message.baseUrl || "").trim();
    const providerId = String(message.providerId || "").trim();
    const model = String(message.model || "").trim();
    if (!baseUrl) {
      sendResponse({ ok: false, error: "请填写 baseUrl" });
      return false;
    }
    Promise.resolve()
      .then(async () => {
        const directApiKey = String(message.apiKey || "").trim();
        if (directApiKey) {
          return directApiKey;
        }
        if (!providerId) {
          return "";
        }
        const keys = await loadAiProviderKeys();
        return String(keys[providerId] || "").trim();
      })
      .then((apiKey) => testAiConnection({ baseUrl, apiKey, model }))
      .then((resp) => sendResponse(resp))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-sidepanel-get-state") {
    const tabId = Number(message.tabId || 0) || 0;
    const forceRefresh = message.forceRefresh === true;
    getAiSidepanelState(tabId, { forceRefresh })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-sidepanel-resolve-context") {
    resolveAiSidepanelContext(message.contextRef || {})
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ai-sidepanel-resolve-page-ref") {
    resolveAiSidepanelPageRef(message.contextRef || {})
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "sidepanel-chat") {
    return;
  }

  let activeAbortController = null;
  let activeAbortMeta = null;
  let firstTokenTimeoutId = 0;

  const clearActiveRequestState = () => {
    if (firstTokenTimeoutId) {
      clearTimeout(firstTokenTimeoutId);
      firstTokenTimeoutId = 0;
    }
    activeAbortController = null;
    activeAbortMeta = null;
  };

  const abortActiveRequest = (meta = null) => {
    activeAbortMeta = meta;
    if (firstTokenTimeoutId) {
      clearTimeout(firstTokenTimeoutId);
      firstTokenTimeoutId = 0;
    }
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
    }
  };

  port.onDisconnect.addListener(() => {
    abortActiveRequest({ type: "silent" });
    clearActiveRequestState();
  });

  port.onMessage.addListener(async (msg) => {
    if (!msg) return;
    if (msg.action === "stop") {
      abortActiveRequest({ type: "stopped", reason: "已停止生成" });
      return;
    }
    if (msg.action !== "chat") return;

    try {
      abortActiveRequest({ type: "silent" });
      clearActiveRequestState();
      activeAbortController = new AbortController();
      firstTokenTimeoutId = setTimeout(() => {
        abortActiveRequest({ type: "timeout", reason: "请求超时（90 秒未返回），已自动中断" });
      }, STREAM_FIRST_TOKEN_TIMEOUT_MS);
      const providers = await loadAiProviders();
      const provider = providers.find((p) => p.id === msg.providerId);
      if (!provider) {
        port.postMessage({ type: "error", error: "未找到选中的平台" });
        clearActiveRequestState();
        return;
      }
      const keys = await loadAiProviderKeys();
      const apiKey = keys[provider.id] || "";
      if (provider.requiresKey !== false && !apiKey) {
        port.postMessage({ type: "error", error: "该平台 API Key 未配置" });
        clearActiveRequestState();
        return;
      }
      await streamChat({
        provider: { ...provider, apiKey },
        context: msg.context || {},
        userPrompt: msg.prompt || "",
        history: Array.isArray(msg.history) ? msg.history : [],
        port,
        signal: activeAbortController.signal,
        getAbortMeta: () => activeAbortMeta,
        onFirstToken: () => {
          if (firstTokenTimeoutId) {
            clearTimeout(firstTokenTimeoutId);
            firstTokenTimeoutId = 0;
          }
        }
      });
    } catch (e) {
      port.postMessage({ type: "error", error: String(e?.message || e) });
    } finally {
      clearActiveRequestState();
    }
  });
});

async function initializeSettingsStorage() {
  const syncCurrent = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  const localCurrent = await chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS);

  await chrome.storage.sync.set({ ...DEFAULT_SYNC_SETTINGS, ...syncCurrent });
  await chrome.storage.local.set({
    obsidianApiKey: normalizeApiKey(localCurrent.obsidianApiKey)
  });

  const legacySyncApiKey = normalizeApiKey(syncCurrent.obsidianApiKey);
  const localApiKey = normalizeApiKey(localCurrent.obsidianApiKey);
  if (!localApiKey && legacySyncApiKey) {
    await chrome.storage.local.set({ obsidianApiKey: legacySyncApiKey });
  }

  if ("obsidianApiKey" in syncCurrent) {
    await chrome.storage.sync.remove("obsidianApiKey");
  }
}

async function getMergedSettings() {
  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);

  const merged = { ...DEFAULT_SYNC_SETTINGS, ...syncSettings };
  merged.downloadFormat = normalizeDownloadFormat(merged.downloadFormat);
  merged.includeHotCommentsInNote = normalizeIncludeHotCommentsInNote(merged.includeHotCommentsInNote);
  merged.enablePlayerAiQuickAction = normalizeEnablePlayerAiQuickAction(merged.enablePlayerAiQuickAction);
  merged.playerAiQuickPrompt = normalizePlayerAiQuickPrompt(merged.playerAiQuickPrompt);
  merged.readerTheme = normalizeReaderTheme(merged.readerTheme);
  merged.readerFontScale = normalizeReaderFontScale(merged.readerFontScale);
  merged.readerLetterSpacing = normalizeReaderLetterSpacing(merged.readerLetterSpacing ?? merged.readerLineHeight);
  merged.readerLineHeight = normalizeReaderLineHeight(merged.readerLineHeight);
  merged.readerContentWidth = normalizeReaderContentWidth(merged.readerContentWidth);
  merged.readerChapterVisibility = normalizeReaderChapterVisibility(merged.readerChapterVisibility);
  merged.readerTranscriptVisible = normalizeReaderTranscriptVisible(merged.readerTranscriptVisible);
  merged.fixedFrontmatterProperties = normalizeFixedFrontmatterProperties(merged.fixedFrontmatterProperties);
  merged.notePlaceholderSections = normalizeNotePlaceholderSections(merged.notePlaceholderSections);
  merged.aiSystemPrompt = normalizeAiSystemPrompt(merged.aiSystemPrompt);
  merged.aiInitialQuickPrompts = normalizeAiInitialQuickPrompts(merged.aiInitialQuickPrompts);
  merged.aiPresetPrompts = normalizeAiPresetPrompts(merged.aiPresetPrompts);
  let apiKey = normalizeApiKey(localSettings.obsidianApiKey);
  const legacySyncApiKey = normalizeApiKey(syncSettings.obsidianApiKey);

  if (!apiKey && legacySyncApiKey) {
    apiKey = legacySyncApiKey;
    await chrome.storage.local.set({ obsidianApiKey: apiKey });
    await chrome.storage.sync.remove("obsidianApiKey");
  }

  return {
    ...merged,
    obsidianApiKey: apiKey
  };
}

async function saveSettings(settings) {
  const payload = settings && typeof settings === "object" ? settings : {};
  const syncPayload = { ...payload };
  delete syncPayload.obsidianApiKey;
  syncPayload.downloadFormat = normalizeDownloadFormat(syncPayload.downloadFormat);
  syncPayload.includeHotCommentsInNote = normalizeIncludeHotCommentsInNote(syncPayload.includeHotCommentsInNote);
  syncPayload.enablePlayerAiQuickAction = normalizeEnablePlayerAiQuickAction(syncPayload.enablePlayerAiQuickAction);
  syncPayload.playerAiQuickPrompt = normalizePlayerAiQuickPrompt(syncPayload.playerAiQuickPrompt);
  syncPayload.readerTheme = normalizeReaderTheme(syncPayload.readerTheme);
  syncPayload.readerFontScale = normalizeReaderFontScale(syncPayload.readerFontScale);
  syncPayload.readerLetterSpacing = normalizeReaderLetterSpacing(
    syncPayload.readerLetterSpacing ?? syncPayload.readerLineHeight
  );
  syncPayload.readerLineHeight = normalizeReaderLineHeight(syncPayload.readerLineHeight);
  syncPayload.readerContentWidth = normalizeReaderContentWidth(syncPayload.readerContentWidth);
  syncPayload.readerChapterVisibility = normalizeReaderChapterVisibility(syncPayload.readerChapterVisibility);
  syncPayload.readerTranscriptVisible = normalizeReaderTranscriptVisible(syncPayload.readerTranscriptVisible);
  syncPayload.fixedFrontmatterProperties = normalizeFixedFrontmatterProperties(syncPayload.fixedFrontmatterProperties);
  syncPayload.notePlaceholderSections = normalizeNotePlaceholderSections(syncPayload.notePlaceholderSections);
  syncPayload.aiSystemPrompt = normalizeAiSystemPrompt(syncPayload.aiSystemPrompt);
  syncPayload.aiInitialQuickPrompts = normalizeAiInitialQuickPrompts(syncPayload.aiInitialQuickPrompts);
  syncPayload.aiPresetPrompts = normalizeAiPresetPrompts(syncPayload.aiPresetPrompts);

  await Promise.all([
    chrome.storage.sync.set(syncPayload),
    chrome.storage.local.set({
      obsidianApiKey: normalizeApiKey(payload.obsidianApiKey)
    })
  ]);
}

function toString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeApiKey(value) {
  return toString(value).trim().replace(/^Bearer\s+/i, "").trim();
}

function normalizeNotePlaceholderSections(items) {
  const allowedPositions = new Set(["before_intro", "before_chapters", "before_subtitle"]);
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const title = toString(item?.title).trim();
      const content = toString(item?.content).trim();
      const position = allowedPositions.has(toString(item?.position).trim())
        ? toString(item?.position).trim()
        : "before_intro";
      return {
        title,
        position,
        content
      };
    })
    .filter((item) => item.title)
    .slice(0, 5);
}

function normalizeDownloadFormat(value) {
  return value === "txt" ? "txt" : "srt";
}

function normalizeIncludeHotCommentsInNote(value) {
  return value === true;
}

function normalizeEnablePlayerAiQuickAction(_value) {
  return false;
}

function normalizePlayerAiQuickPrompt(value) {
  return toString(value).trim();
}

function normalizeReaderTheme(value) {
  return value === "dark" || value === "paper" ? value : "light";
}

function normalizeReaderFontScale(value) {
  return ["xs", "s", "m", "l", "xl"].includes(value) ? value : "m";
}

function normalizeReaderLetterSpacing(value) {
  return ["tighter", "tight", "normal", "relaxed", "loose"].includes(value) ? value : "normal";
}

function normalizeReaderLineHeight(value) {
  return ["compact", "tight", "normal", "relaxed", "loose"].includes(value) ? value : "tight";
}

function normalizeReaderContentWidth(value) {
  return ["compact", "narrow", "medium", "wide", "full"].includes(value) ? value : "medium";
}

function normalizeReaderChapterVisibility(value) {
  return value === "hide" || value === "auto" ? value : "show";
}

function normalizeReaderTranscriptVisible(value) {
  return value !== false;
}

function normalizeFixedFrontmatterProperties(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      key: toString(item?.key).trim(),
      type: normalizeFixedPropertyType(item?.type),
      value: normalizeFixedPropertyValue(item?.type, item?.value)
    }))
    .filter((item) => item.key && !isFixedPropertyRowEffectivelyEmpty(item.type, item.value));
}

function normalizeAiSystemPrompt(value) {
  const normalized = toString(value).trim();
  if (normalized === LEGACY_DEFAULT_AI_SYSTEM_PROMPT) {
    return DEFAULT_AI_SYSTEM_PROMPT;
  }
  return normalized;
}

function normalizeAiPresetPrompts(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toString(item).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeAiInitialQuickPrompts(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_INITIAL_QUICK_PROMPTS.slice();
  }
  return value
    .map((item) => toString(item).trim())
    .slice(0, 4);
}

function normalizeFixedPropertyType(value) {
  const type = toString(value).trim().toLowerCase();
  return type === "number" || type === "checkbox" || type === "list" || type === "date" ? type : "text";
}

function normalizeFixedPropertyValue(type, value) {
  const normalizedType = normalizeFixedPropertyType(type);
  if (normalizedType === "checkbox") {
    return toString(value).trim().toLowerCase();
  }
  return toString(value).trim();
}

function isFixedPropertyRowEffectivelyEmpty(type, value) {
  return !toString(value).trim();
}

function formatConnectionError(error) {
  const message = String(error?.message || "").trim();
  if (!message) {
    return "连接失败：未知错误";
  }
  if (message.includes("Failed to fetch")) {
    return "无法连接 Local REST API。请检查地址、HTTP/HTTPS 模式和证书信任。";
  }
  return message;
}

// ===== AI 模型平台存储 =====

const AI_PROVIDER_KEYS_STORAGE = "aiProviderKeys";

function normalizeAiProvider(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  if (!id) return null;
  return {
    id,
    presetId: String(item.presetId || "custom"),
    name: String(item.name || "自定义").trim() || "自定义",
    baseUrl: String(item.baseUrl || "").trim().replace(/\/+$/, ""),
    model: String(item.model || "").trim(),
    temperature: typeof item.temperature === "number" ? item.temperature : 0.7,
    requiresKey: item.requiresKey !== false,
    enabled: item.enabled !== false
  };
}

async function loadAiProviders() {
  const [syncData, keys] = await Promise.all([
    chrome.storage.sync.get(["aiProviders"]),
    loadAiProviderKeys()
  ]);
  const list = Array.isArray(syncData.aiProviders) ? syncData.aiProviders : [];
  return list
    .map(normalizeAiProvider)
    .filter(Boolean)
    .map((p) => ({ ...p, hasSavedKey: Boolean(keys[p.id]) }));
}

async function saveAiProviders(items) {
  const rawList = Array.isArray(items) ? items : [];
  const keys = await loadAiProviderKeys();
  const nextList = [];
  for (const raw of rawList) {
    const normalized = normalizeAiProvider(raw);
    if (!normalized) continue;
    nextList.push(normalized);
    const incomingKey = String(raw?.apiKey || "").trim();
    if (incomingKey) {
      keys[normalized.id] = incomingKey;
    }
  }
  await Promise.all([
    chrome.storage.sync.set({ aiProviders: nextList }),
    chrome.storage.local.set({ [AI_PROVIDER_KEYS_STORAGE]: keys })
  ]);
  // 返回带 hasSavedKey 的列表，方便前端渲染占位
  return nextList.map((p) => ({ ...p, hasSavedKey: Boolean(keys[p.id]) }));
}

async function deleteAiProvider(providerId) {
  const list = await loadAiProviders();
  const next = list.filter((p) => p.id !== providerId);
  await chrome.storage.sync.set({ aiProviders: next });
  const keys = await loadAiProviderKeys();
  if (keys && providerId in keys) {
    delete keys[providerId];
    await chrome.storage.local.set({ [AI_PROVIDER_KEYS_STORAGE]: keys });
  }
  return next;
}

async function loadAiProviderKeys() {
  const localData = await chrome.storage.local.get([AI_PROVIDER_KEYS_STORAGE]);
  const keys = localData?.[AI_PROVIDER_KEYS_STORAGE];
  return keys && typeof keys === "object" ? keys : {};
}

async function saveAiProviderKey(providerId, apiKey) {
  const keys = await loadAiProviderKeys();
  const trimmed = String(apiKey || "").trim();
  if (trimmed) {
    keys[providerId] = trimmed;
  } else {
    delete keys[providerId];
  }
  await chrome.storage.local.set({ [AI_PROVIDER_KEYS_STORAGE]: keys });
  return keys;
}

// ===== AI 调用（内联实现，避免 service worker 跨文件 import） =====

function buildAiMessages({ context, userPrompt, history, systemPrompt }) {
  const ctx = context || {};
  const hasVideoContext = Boolean(ctx.isVideoContext);
  const sections = hasVideoContext
    ? [
        `你是一个 YouTube 视频助手。当前用户正在看一个视频，标题：「${ctx.title || "未知"}」`,
        `作者：${ctx.author || "未知"} | 上传日期：${ctx.uploadDate || "未知"}`
      ]
    : [
        "你是一个通用 AI 助手。",
        "当前对话没有页面上下文，请仅基于用户消息和历史对话回答。"
      ];

  if (ctx.subtitleMarkdown) {
    sections.push(`以下是视频的字幕全文：\n\n${ctx.subtitleMarkdown}`);
  } else if (hasVideoContext) {
    sections.push("（暂无字幕）");
  }
  if (hasVideoContext && Array.isArray(ctx.hotComments) && ctx.hotComments.length) {
    const block = ctx.hotComments
      .map((c, i) => `${i + 1}. ${c.uname || "匿名"}（赞 ${c.like || 0}）: ${c.message || ""}`)
      .join("\n");
    sections.push(`以下是按热度排序的前 ${ctx.hotComments.length} 条热门评论：\n\n${block}`);
  }
  const customSystemPrompt = normalizeAiSystemPrompt(systemPrompt);
  if (customSystemPrompt) {
    sections.push(`以下是额外系统要求：\n${customSystemPrompt}`);
  }
  return [
    { role: "system", content: sections.join("\n\n") },
    ...(Array.isArray(history) ? history.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : []),
    { role: "user", content: String(userPrompt || "") }
  ];
}

function clipAiSubtitle(markdown) {
  return String(markdown || "");
}

async function* parseOpenAISSE(response) {
  if (!response || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.length ? lines.pop() : "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) yield String(delta);
      } catch {}
    }
  }
}

async function streamChat({ provider, context, userPrompt, history, port, signal, getAbortMeta, onFirstToken }) {
  if (!port) return;
  const baseUrl = String(provider?.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    port.postMessage({ type: "error", error: "baseUrl 未配置" });
    return;
  }
  if (!provider.model) {
    port.postMessage({ type: "error", error: "模型未配置" });
    return;
  }

  const messages = buildAiMessages({
    context: { ...context, subtitleMarkdown: clipAiSubtitle(context?.subtitleMarkdown) },
    userPrompt,
    history,
    systemPrompt: context?.aiSystemPrompt || ""
  });

  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: true,
        temperature: typeof provider.temperature === "number" ? provider.temperature : 0.7
      })
    });
  } catch (e) {
    port.postMessage({ type: "error", error: `网络错误：${e?.message || e}` });
    return;
  }

  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch {}
    port.postMessage({ type: "error", error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` });
    return;
  }

  try {
    let hasSentFirstToken = false;
    for await (const token of parseOpenAISSE(response)) {
      if (!hasSentFirstToken) {
        hasSentFirstToken = true;
        onFirstToken?.();
      }
      port.postMessage({ type: "token", data: token });
    }
    port.postMessage({ type: "done" });
  } catch (e) {
    if (signal?.aborted) {
      const abortMeta = typeof getAbortMeta === "function" ? getAbortMeta() : null;
      if (abortMeta?.type === "stopped") {
        port.postMessage({ type: "stopped", reason: abortMeta.reason || "已停止生成" });
        return;
      }
      if (abortMeta?.type === "timeout") {
        port.postMessage({ type: "error", error: abortMeta.reason || "请求超时，已自动中断" });
        return;
      }
      return;
    }
    port.postMessage({ type: "error", error: String(e?.message || e) });
  }
}

async function testAiConnection({ baseUrl, apiKey, model }) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedModel = String(model || "").trim();
  if (!normalizedBaseUrl) {
    return { ok: false, error: "请填写 baseUrl" };
  }
  if (!normalizedModel) {
    return { ok: false, error: "请填写模型名" };
  }

  const headers = { Accept: "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return probeAiChatCompletion({
    baseUrl: normalizedBaseUrl,
    apiKey,
    model: normalizedModel,
    headers
  });
}

async function probeAiChatCompletion({ baseUrl, apiKey, model, headers }) {
  const requestHeaders = headers || { Accept: "application/json" };
  if (apiKey && !requestHeaders.Authorization) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }
  requestHeaders["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }]
      })
    });
  } catch (error) {
    return { ok: false, error: `无法连接：${error?.message || error}` };
  }

  if (response.ok) {
    return { ok: true };
  }

  let detail = "";
  try {
    detail = (await response.text()).slice(0, 200);
  } catch {}
  return { ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
}
