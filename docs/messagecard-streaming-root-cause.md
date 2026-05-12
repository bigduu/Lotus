# MessageCard / Streaming 前端卡顿 Root Cause 分析

## Executive Summary

- **结论**：你们现在 streaming 期间的明显卡顿，**主因不在普通历史 `MessageCard` 列表级联重渲染**，而在 **streaming 专用渲染链路本身过重**。
- **最主要 root cause** 有两个：
  1. **`StreamingMessageCard` 每次 token 刷新都重新跑整段 `ReactMarkdown` 解析 + 渲染**，内容越长越重，成本随输出长度持续上升。  
  2. **streaming 更新会反复触发自动滚动、ResizeObserver 和虚拟列表/布局测量，形成布局抖动（layout thrash）**。
- **次要 root cause**：当进入工具输出 streaming（`tool_token`）时，会 **每个 chunk 写 Zustand store、重建 `messages` 数组与对应 tool message 对象**，这一条链会把工具卡片渲染也拖重。
- **额外结论**：普通历史文本 `MessageCard` 本身虽然也比较重，但在“回答正文正在 streaming”这一阶段，实际显示的是 `StreamingMessageCard`，所以你现在感知到的主卡顿点不在 `MessageCard/index.tsx` 本体，而在它的 **parallel streaming path**。

---

## 关键代码链路

### 1. 正在生成时，实际渲染的是 `StreamingMessageCard`

- `lotus/src/pages/ChatPage/conversation/ConversationPane.tsx:142`
  - `const isThinking = isBusy;`
- `lotus/src/pages/ChatPage/components/ChatView/ChatMessagesList.tsx:345`
  - `isThinking && currentSessionId && <StreamingMessageCard sessionId={currentSessionId} />`

这意味着：

- assistant 正在流式输出正文时，页面底部展示的是 `StreamingMessageCard`
- 不是把最后一条 assistant message 直接持续喂给普通 `MessageCard`

所以如果用户说的是“streaming 时前端很卡”，**先看 `StreamingMessageCard`** 才是对的。

---

### 2. token 到来时的更新路径

- `lotus/src/hooks/useAgentEventSubscription.ts:686-700`
  - `onToken` 中：
    - `applyAgentEvent(...)`
    - `state.content += tokenContent`
    - `streamingMessageBus.publish(...)`
- `lotus/src/pages/ChatPage/utils/streamingMessageBus.ts:62-71`
  - `publish()` 会把最新内容塞进 `latestContent`
  - 并通过 `requestAnimationFrame(flushPending)` 在下一帧批量通知订阅者
- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:257-273`
  - `subscribeMessage(...)` 后 `setContent / setReasoningContent / setStatusContent`

所以正文 streaming 的热点机制是：

1. SSE token 到来
2. 聚合到内存 draft
3. 每帧通过 bus 推给 `StreamingMessageCard`
4. `StreamingMessageCard` re-render
5. 整段 markdown 重新解析、渲染、布局

虽然这里已经做了 **rAF 合帧**，但**只降低了更新频率，没降低每次更新的渲染成本**。

---

## Root Cause 1：`StreamingMessageCard` 每次 token 都在重渲整段 Markdown，成本随内容增长

### 证据

- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:370-377`

```tsx
{content ? (
  <ReactMarkdown
    remarkPlugins={markdownPlugins}
    rehypePlugins={rehypePlugins}
    components={markdownComponents}
  >
    {content}
  </ReactMarkdown>
) : null}
```

- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:337-357`
  - reasoning 区块也是另一个完整 `ReactMarkdown`

### 为什么这会卡

每次 `content` 增长一点点：

- `ReactMarkdown` 会重新处理**整段字符串**，不是只处理新增 token
- `remark-gfm`、`remark-breaks`、`rehype-sanitize` 都会再次参与整棵 markdown AST 的生成/转换
- 如果内容里有：
  - 大段列表
  - 表格
  - 引用块
  - 多级 markdown 结构
  - 代码块

那么每次刷新都会重新 parse + diff + layout 一次，而且**文本越长越贵**。

这类问题的典型特征就是：

- 开头流畅
- 内容越生成越卡
- 长回答比短回答明显更卡
- 遇到 code block / table / list 更容易掉帧

### 进一步证据：代码块渲染尤其重

- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:118-119`
  - 非 Mermaid 代码块仍然调用 `renderCodeBlock(...)`
- `lotus/src/shared/components/Markdown/MarkdownCodeBlock.tsx:290-296`
  - 最终渲染 `CodeBlockWithCopy`
- `lotus/src/shared/components/Markdown/MarkdownCodeBlock.tsx:56-72`
  - `CodeBlockWithCopy` 使用 `react-syntax-highlighter`

```tsx
<SyntaxHighlighter
  style={getSyntaxTheme()}
  language={isSupported ? normalizedLanguage : "text"}
  ...
>
  {codeString}
</SyntaxHighlighter>
```

也就是说，streaming 内容一旦进入代码块：

- 不只是 markdown 解析重跑
- 还会对整段代码块重新做 syntax highlighting

这会显著放大卡顿。

### 结论

**这是正文 streaming 卡顿的第一主因，也是最核心主因。**

---

## Root Cause 2：streaming 期间自动滚动 + ResizeObserver + 虚拟列表测量形成布局抖动

### 证据 1：每次 streaming 更新都会尝试 scrollToBottom

- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:303-327`

```tsx
return streamingMessageBus.subscribe((update) => {
  if (update.sessionId !== currentSessionId) return;
  ...
  if (!update.content) {
    refreshScrollIndicators();
    return;
  }

  scrollToBottom();
});
```

也就是：**正文 streaming 每次 bus flush 后都会触发 `scrollToBottom()`**。

### 证据 2：`scrollToBottom` 不是一次操作，而是最多连续 6 帧追踪滚动

- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:132-185`

它内部会：

- 读 `scrollHeight / scrollTop / clientHeight`
- 读 `getBoundingClientRect()`
- 调 `scrollIntoView(...)`
- 如果 anchor 继续移动，则下一帧继续滚
- 最多 `SCROLL_BOTTOM_MAX_FRAMES = 6`

这非常像一个“追着底部走”的机制。问题是 streaming 时内容在不断变长，底部 anchor 的位置会不断变化，于是这个逻辑就容易在短时间内频繁运行。

### 证据 3：同一时间还有 `ResizeObserver` 在监听容器变化

- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:371-420`

```tsx
const observer = new ResizeObserver(() => {
  didObserveResize = true;
  scheduleRefresh();
});
```

`scheduleRefresh()` 里又会：

- 判断是否 stickToBottom
- `scrollToBottom({ behavior: "auto" })`
- 否则 `refreshScrollIndicators()`

也就是说 streaming 内容增高时：

- 文本更新导致内容高度变化
- `ResizeObserver` 被触发
- 触发一次 scroll / refresh
- 同时 `streamingMessageBus.subscribe` 那边也在触发 scrollToBottom

两个机制叠加，就很容易造成：

- 多次读写 layout 属性
- 滚动反复修正
- 页面主线程持续忙碌

### 证据 4：消息列表使用了虚拟列表并测量元素

- `lotus/src/pages/ChatPage/components/ChatView/ChatMessagesList.tsx:148-155`
  - `useVirtualizer(...)`
- `lotus/src/pages/ChatPage/components/ChatView/ChatMessagesList.tsx:326-330`

```tsx
<div
  ...
  ref={virtualizer.measureElement}
>
```

这表示消息项高度会被实际测量。

虽然 streaming 卡片本身不在 virtualized items 里，而是在列表底部单独渲染（`ChatMessagesList.tsx:345-357`），但整个消息容器高度变化、底部 anchor 位置变化、content 变化，仍然会让滚动和测量系统频繁参与，增加主线程负担。

### 结论

**第二主因是滚动/布局系统在 streaming 时过于积极，和 markdown 重渲染一起叠加，放大卡顿。**

---

## Root Cause 3：工具输出 streaming 会每个 chunk 写全局 store，导致消息数组和工具卡片持续重建

这个 root cause 主要影响 **tool token streaming**，不一定是你现在反馈的唯一问题，但它确实是另一个明显热点。

### 证据 1：`tool_token` 每个 chunk 都会 `updateMessage`

- `lotus/src/hooks/useAgentEventSubscription.ts:813-866`

```tsx
const updatedToolCalls = msg.toolCalls.map((call) => {
  if (call.toolCallId !== toolCallId) return call;
  const next = (call.streamingOutput || "") + (tokenContent || "");
  return { ...call, streamingOutput: next };
});

updateMessage(sessionId, msg.id, {
  toolCalls: updatedToolCalls,
});
```

### 证据 2：`updateMessage` 会重建整个 `messages` 数组

- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts:1072-1083`

```tsx
const updatedMessages = chat.messages.map((msg) => {
  if (msg.id !== messageId) return msg;
  const updatedMsg = { ...msg };
  ...
  return updatedMsg;
});

get().updateSession(sessionId, { messages: updatedMessages });
```

这意味着每个 tool chunk：

- 创建新的 `messages` 数组
- 创建新的 tool message 对象
- 更新 session
- 触发依赖 `currentChat` / `currentMessages` 的派生逻辑

### 证据 3：`useChatViewMessages` 会基于整个 `currentMessages` 重新构建 renderable entries

- `lotus/src/pages/ChatPage/components/ChatView/useChatViewMessages.ts:339-427`

```tsx
const renderableMessages = useMemo(() => {
  const filtered = currentMessages.filter(...)
  const grouped = groupToolMessages(filtered)
  const entries: RenderableEntry[] = []
  ...
  return entries;
}, [currentChat?.config?.compressionEvents, currentChat?.id, currentMessages, ...])
```

所以工具输出 streaming 时，除了局部卡片更新，还会触发：

- 过滤消息
- `groupToolMessages(...)`
- 重建 renderableMessages
- 消息列表重新 render

### 证据 4：工具卡本身也不轻

- `lotus/src/pages/ChatPage/components/ToolStepsCard/index.tsx:175-378`
  - 会构造 step items、格式化 preview、diff stats 等
- `lotus/src/pages/ChatPage/components/ToolCallCard/index.tsx:204-237`
  - live output 区域使用 `react-syntax-highlighter`

所以当 tool output 很密集时，**这条链也会很卡**。

### 结论

- 对“assistant 正文 streaming”来说，这不是最核心 root cause
- 但对“工具输出 streaming 卡顿”来说，这是明显热点

---

## 为什么我判断“普通 MessageCard 本体不是当前主 root cause”

### 证据 1：正文 streaming 期间压根不走普通 `MessageCard`

- `lotus/src/pages/ChatPage/components/ChatView/ChatMessagesList.tsx:345-357`
  - 直接渲染 `StreamingMessageCard`

### 证据 2：普通 `MessageCard` 已经做了 `memo`

- `lotus/src/pages/ChatPage/components/MessageCard/index.tsx:359-365`

```tsx
const MessageCard = memo(MessageCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.message === nextProps.message &&
    prevProps.messageType === nextProps.messageType &&
    prevProps.onDelete === nextProps.onDelete
  );
});
```

### 证据 3：`ConversationPane` 的 `isThinking` 来源于 `selectIsBusy(sessionId)`，只是布尔值

- `lotus/src/pages/ChatPage/store/selectors/executionSelectors.ts:53-58`

```tsx
export const selectIsBusy =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    return isBusyPhase(entry?.phase);
  };
```

而 `applyAgentEvent(token)` 虽然会更新 execution state，但 phase 一旦进入 `streaming` 后，**不会每个 token 改变这个布尔值**。

因此：

- `ConversationPane` 不太可能因为 `isThinking` 每个 token 变化而重复 re-render
- 历史消息 `MessageCard` 也不太可能因为正文 token streaming 每个 token 都被重新灌 props

### 结论

普通 `MessageCard` 不是当前“assistant 正文 streaming 卡”的主因；真正的热点是：

- `StreamingMessageCard`
- `useChatViewScroll`
- 以及工具 streaming 的 `updateMessage` 分支

---

## 性能问题按优先级排序

### P0：StreamingMessageCard 全量 markdown 重渲染

影响：最高  
证据强度：最高  
症状匹配度：最高

表现：
- 输出越长越卡
- markdown / code block 时更明显

---

### P1：自动滚动 + ResizeObserver + 布局测量叠加

影响：高  
证据强度：高  
症状匹配度：高

表现：
- 页面像“跟着抖”
- 主线程忙于 scroll/layout
- 尤其在 stick to bottom 时明显

---

### P2：tool_token 每 chunk 更新 store + rebuild messages

影响：中到高（取决于工具输出量）  
证据强度：高  
症状匹配度：中

表现：
- 工具执行期间也卡
- 工具 stdout 很长时尤其明显

---

## 最小验证方案

### 验证 1：关闭 `StreamingMessageCard` 的 markdown，只渲染纯文本

把：
- `StreamingMessageCard/index.tsx:370-377`

临时改成：

```tsx
<pre>{content}</pre>
```

如果卡顿显著下降，说明 **主因就是 ReactMarkdown / code block 路径**。

### 验证 2：暂时禁用 streaming 自动滚动

临时屏蔽：
- `useChatViewScroll.ts:303-327` 中 streaming bus 的 `scrollToBottom()`
- 或在 streaming 时仅节流触发

如果卡顿明显缓解，说明 **scroll/layout thrash** 是重要放大器。

### 验证 3：对 tool_token 只更新本地 ref，不写 store

临时让 `onToolToken` 不走 `updateMessage()`，而是走一个单独的 bus/local state。

如果工具执行阶段明显顺滑，说明 **store 写入 + renderableMessages 重建** 是工具卡链路热点。

---

## 建议的修复方向

### 方案 A：Streaming 阶段降级渲染，不要每帧跑完整 Markdown AST

优先级：最高

建议：

1. **streaming 时先渲染纯文本 / 轻量 markdown**
   - 例如只处理换行、行内 code
   - 不处理复杂 block
   - 完成后再切回完整 `ReactMarkdown`

2. **对代码块禁用 streaming 高亮**
   - streaming 阶段代码块只 `<pre><code>`
   - 完成后再做 syntax highlighting

3. **按块增量提交，而不是整段全文重渲**
   - 例如按 paragraph / fenced block 切分
   - 已完成 block 冻结，只有尾部未完成 block 更新

> 这是收益最大的点。

---

### 方案 B：把滚动逻辑从“每次内容更新都追底”改成节流/合并

优先级：高

建议：

1. streaming 时底部跟随滚动节流到 **100~200ms** 一次
2. `ResizeObserver` 不要和 streaming bus 双重驱动同一个 `scrollToBottom`
3. 滚动逻辑改成“已有 pending scroll 就不重复排队”
4. 只在用户确实贴底时才自动滚动

---

### 方案 C：工具 streaming 不要每 chunk 写全局 chat store

优先级：高（针对 tool_token）

建议：

1. `tool_token` 走独立 bus / local ephemeral state
2. tool complete 时再一次性落库 / 写 session message
3. `updateMessage` 尽量避免每 chunk 重建整条 `messages`

---

### 方案 D：进一步降低卡片组件的重算成本

优先级：中

包括：

- 把 `MessageCardContent` / `ToolStepsCard` 中昂贵的 `useMemo` 依赖再收紧
- 避免在 streaming 阶段使用 `Collapse`、复杂 `Card` 嵌套、复杂 preview 格式化
- 避免 hover / shadow / transform 动画参与高频更新节点

---

## 一句话结论

**你们的“MessageCard streaming 卡顿”本质上主要不是历史 `MessageCard` 自身的问题，而是 streaming 专用卡片在每次 token 到来时都重新做整段 Markdown/代码高亮渲染，同时又叠加了激进的自动滚动与布局测量；工具输出链路还会额外因为每 chunk 写 store 而放大卡顿。**

---

## 关键证据文件索引

- `lotus/src/pages/ChatPage/components/ChatView/ChatMessagesList.tsx:345`
- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:257`
- `lotus/src/pages/ChatPage/components/StreamingMessageCard/index.tsx:370`
- `lotus/src/hooks/useAgentEventSubscription.ts:686`
- `lotus/src/pages/ChatPage/utils/streamingMessageBus.ts:62`
- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:132`
- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:303`
- `lotus/src/pages/ChatPage/components/ChatView/useChatViewScroll.ts:371`
- `lotus/src/shared/components/Markdown/MarkdownCodeBlock.tsx:56`
- `lotus/src/hooks/useAgentEventSubscription.ts:813`
- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts:1072`
- `lotus/src/pages/ChatPage/components/ChatView/useChatViewMessages.ts:339`
