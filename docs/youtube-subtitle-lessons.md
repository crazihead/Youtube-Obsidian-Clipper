# YouTube 字幕抓取踩坑经验总结

> 2026-09-30 从 Bilibili 改到 YouTube 的完整踩坑记录，下次做 YouTube 字幕抓取必看。

---

## 🎯 核心问题：timedtext API 返回空 body

### 现象
```
fetch("https://www.youtube.com/api/timedtext?v=xxx&...")
→ HTTP 200, content-length: 0, 空 body
```
无论用 credentials、headers（Referer/Origin）、XMLHttpRequest、no-cors 模式——**全部空**。

### 根因
**YouTube Web 端 (`ytInitialPlayerResponse`) 返回的 `captionTracks[].baseUrl` 带 `exp=xpe` 参数**，服务端看到 `exp=xpe` 就返回空 body。

对比：
| 来源 | baseUrl 有没有 exp=xpe | fetch 结果 |
|------|----------------------|-----------|
| `ytInitialPlayerResponse`（DOM/playerResponse） | ✅ 有 | ❌ 空 body |
| Web 端 `/youtubei/v1/player`（WEB client） | ✅ 有 | ❌ 空 body |
| **ANDROID client `/youtubei/v1/player`** | ❌ **没有** | ✅ 48KB XML |

### 解决方案（唯一有效）
用 **ANDROID client context** POST `/youtubei/v1/player`：

```javascript
const body = {
  context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
  videoId
};
fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
// → 返回不带 exp=xpe 的 baseUrl → fetch 100% 成功
```

### INNERTUBE_API_KEY 怎么拿
从页面 HTML 里正则提取：
```javascript
const html = document.documentElement.innerHTML;
const m = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
const apiKey = m?.[1] || "";
```

### 参考实现
Python 库 `youtube-transcript-api` 就是这么干的：
- `youtube_transcript_api/_transcripts.py` 里 `INNERTUBE_CONTEXT = { client: { clientName: "ANDROID", clientVersion: "20.10.38" } }`
- 它也成功拿到了 259 个 segments

---

## 🚫 踩过的坑全记录

### 坑 1：从 DOM script 提取 ytInitialPlayerResponse（可行但带 exp=xpe）
- **不能直接访问**：`window.ytInitialPlayerResponse` 在 content script isolated world 里是 null
- **从 `<script>` 标签提取**：页面有 4+ 个 script 包含 `ytInitialPlayerResponse` 字符串，但只有 1 个是真正的 JSON 赋值（`ytInitialPlayerResponse = {`）
- **正则会截断**：`/var ytInitialPlayerResponse = (\{.+?\});/` 会在嵌套 `}` 处截断 → 用**平衡括号算法**（从 `{` 开始，嵌套计数到 0 停止）
- **结果**：虽然能提取到 `captionTracks`，但 baseUrl 带 `exp=xpe`，fetch 字幕必然空 body
- **结论**：**DOM 提取只能拿 metadata（title/author），不能拿可用的字幕 URL**

### 坑 2：background script fetch（跟 content script 结果一样空）
- background service worker fetch timedtext → 也是空 body
- 不是 CORS 问题，因为 ANDROID API 拿到的 URL 就能 fetch
- **结论**：fetch 通道本身没问题，是 **URL 参数**的问题

### 坑 3：/youtubei/v1/player（Web client）也不行
```javascript
// 不行 ❌
const body = { context: { client: { clientName: "WEB", clientVersion: "2.2026..." } }, videoId };
fetch(`https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`, { ... });
// → baseUrl 还是带 exp=xpe
```
- **结论**：**clientName 必须是 "ANDROID"**（或 ANDROID_MUSIC、ANDROID_CREATOR 等），不能是 WEB

### 坑 4：PoT（Proof of Token）是干扰项
- 一开始怀疑需要 PoT 参数（`potc`, `pot`, `xorb`, `xobt` 等）
- 验证：ANDROID API 返回的 URL **不带任何 PoT 参数，直接 fetch 成功**
- **结论**：**跟 PoT 无关**，纯粹是 `exp=xpe` 的问题

### 坑 5：fmt 参数在 ANDROID URL 上不生效
- 以为加 `&fmt=json3` 能拿到 JSON 格式
- 实测：ANDROID API 返回的 URL **加任何 fmt 参数**（json3/srv3/vtt/srv1/srv2）都返回 **srv3 XML**
- **结论**：**不要加 fmt 参数**，直接 fetch baseUrl，然后解析 srv3 XML

### 坑 6：srv3 XML 结构不是简单的 `<p>` 标签
- srv3 格式：`<p t="开始ms" d="持续ms"><s>word1</s><s t="200">word2</s>...</p>`
- `<s>` 带 `t` 属性（相对于 `<p>` 开始的偏移），但实际抓取字幕不需要这个
- `<s>` 之间可能有空格也可能没有（ASR 自动生成的字幕没有空格！）
- **结论**：正则匹配 `<p>` 块 → 提取内部所有 `<s>` 文本 → 拼接

### 坑 7：DOMParser 在 MV3 content script 里被 TrustedHTML 阻止
- `new DOMParser().parseFromString(xml, "text/xml")` 可能触发 TrustedHTML 限制
- **解决方案**：用**正则解析 srv3 XML**（纯文本匹配，不经过 DOM）
- 正则：`/<p\s+t="([^"]*)"\s+d="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g`

### 坑 8：content script → background 消息通信（不必要）
- 一开始把 ANDROID player API 调用放在 background handler 里
- content script → background → fetch → 回传 → 多一层开销
- **简化**：content script **直接 fetch** ANDROID player API，跳过 background
- 同样，字幕 body 也直接 fetch，不走 background

### 坑 9：chrome.scripting.executeScript 返回 undefined
- background 里用 `chrome.scripting.executeScript({ func })` 提取 playerResponse
- func 返回的对象太大（MB 级），structured clone 会失败
- **解决方案**：func 里只返回精简字段（title, captionTracks 等小对象）

### 坑 10：CSP 阻止 document.createElement('script')
- 之前的 B站 方案用 `document.createElement('script')` 注入代码
- YouTube 有严格 CSP，content script 也被限制
- **解决方案**：**读取 DOM 里已有的 `<script>` 标签的 textContent**（这不受 CSP 限制）

---

## ✅ 正确的完整流程（最终方案）

```
1. 提取 videoId  →  location.href.match(/[?&]v=([^&]+)/)
2. 提取 API Key  →  HTML 正则 /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/
3. ANDROID player API → fetch POST /youtubei/v1/player
   body: { context: { client: "ANDROID", version: "20.10.38" }, videoId }
   → 返回 captionTracks[].baseUrl（不带 exp=xpe ✅）
4. 字幕 body fetch → fetch(baseUrl)  // 不要加 fmt 参数
   → 返回 srv3 XML（48KB 左右）
5. 解析 srv3 XML → 正则 <p t="..." d="..."> 块 + 内部 <s> 文本
   → 259 个 segments（跟 Python youtube-transcript-api 一致 ✅）
```

---

## 📋 YouTube 字幕相关技术参数速查

| 项 | 值 |
|----|---|
| Player API URL | `https://www.youtube.com/youtubei/v1/player?key={INNERTUBE_API_KEY}` |
| ANDROID clientName | `"ANDROID"` |
| ANDROID clientVersion | `"20.10.38"`（最新稳定版，从 youtube-transcript-api 抄的） |
| INNERTUBE_API_KEY 来源 | 页面 HTML 里的 `"INNERTUBE_API_KEY":"AIzaSy..."` |
| timedtext URL 参数 | 不要加 `fmt`，直接 fetch baseUrl |
| srv3 XML `<p>` 结构 | `t=开始ms, d=持续ms`，内部多个 `<s>` 含文本 |
| ASR vs 手动字幕 | `captionTrack.kind === "asr"` 是自动生成 |
| 字幕 languageCode | 如 `"en"`, `"zh-Hans-CN"` |
| Chrome 扩展 manifest_version | 3 |
| host_permissions 需要 | `https://www.youtube.com/*`, `https://*.youtube.com/*` |

---

## 🔍 调试命令速查

### 浏览器 Console 里快速验证 ANDROID API
```javascript
const v='K063gZvP5JU',k=document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/)[1];
fetch(`https://www.youtube.com/youtubei/v1/player?key=${k}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:{client:{clientName:'ANDROID',clientVersion:'20.10.38'}},videoId:v})}).then(r=>r.json()).then(j=>{const t=j.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];console.log('tracks:',t.length,'exp:',t.map(x=>x.baseUrl.includes('exp=xpe')).join(','));fetch(t[0].baseUrl).then(r=>r.text()).then(x=>console.log('size:',x.length,'preview:',x.slice(0,100)));});
```

### 验证 ytInitialPlayerResponse（会带 exp=xpe）
```javascript
fetch(location.href).then(r=>r.text()).then(html=>{
  const m=html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
  const p=JSON.parse(m[1]);
  const t=p.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
  console.log('DOM tracks:',t.length,'has exp:',t.map(x=>x.baseUrl.includes('exp=xpe')).join(','));
});
```

---

## 🗂️ 文件结构（最终）

```
extension/
├── manifest.json        → version: "1.0.0", manifest_version: 3
├── background.js        → 精简：ANDROID handler + fetch-json + Obsidian 写入
├── content.js           → 核心：ANDROID player fetch + srv3 XML 正则解析
├── content.css          → YouTube DOM 选择器
├── popup.js / popup.html → UI
├── options.js / options.html → 设置
├── sidepanel.js          → AI 侧边栏
└── icons/
```

---

## 💡 下次做类似需求的 Checklist

- [ ] 有没有 ANDROID client API？（YouTube、TikTok 等 App 都有）
- [ ] Web 端返回的 URL 参数里有没有奇怪的 flag（`exp=xpe`、`sig=` 等）？
- [ ] fetch 返回空 body？先验证 **URL 是否有 exp/po 等标记性参数**，换 client 试试
- [ ] Content script 能不能直接 fetch？先试直接 fetch，再考虑 background relay
- [ ] XML/HTML 解析遇到 TrustedHTML？换正则
- [ ] CSP 阻止脚本注入？改读取 DOM 里已有的 script 标签 textContent
- [ ] 大对象跨消息通道？只传精简字段
