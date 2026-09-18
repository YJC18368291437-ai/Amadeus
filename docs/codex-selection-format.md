# Codex Desktop 选中文字的模型上下文

核实于本机 Codex Desktop `26.911.7940.0` 的 `app.asar`：`.vite/build/main-CkwLGrvo.js` 中 `bCe` 负责消息上下文组装。官方文档页面访问返回 HTTP 403；以下结论来自安装包里的实际序列化逻辑，不是对官方文档的转述。

对话回答批注使用以下格式：

```text
# Response annotations:
Each item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position (for example, `:codex-annotation{index="1"}`). Do not use unstructured annotation labels.
<response-annotations>
[{"text":"所选原文","annotation":"用户批注","source":{}}]
</response-annotations>
```

代码确认只序列化 `text`、`annotation`、`source` 三个字段；`source` 对象随上游传入，不能据此断言每种选区都包含相同定位字段。

普通文件选区另有 `# Selected text:`、`## Selection N: 路径 (line N / lines N-M)` 结构。PDF 批注的组装函数会添加 `PDF path: 原路径` 和 `PDF page: 页码/总页数`。因此，Codex 并不是所有来源都使用同一个提示词模板。

Amadeus 保留三字段结构和逐条回答语义，并扩展 source：`kind=file` 包含原文件 path、format、pageStart/pageEnd/pageCount；文本文件只有 path/format；`kind=conversation` 包含 sessionId、可识别的消息/节点定位及选区周边原文。页码从 1 开始，PPT 一张幻灯片对应一页，Word 页码以服务器转换后的阅读版本为准。

dsh 不支持 Codex 专用 inline directive，Amadeus 提示模型使用 `[注释 N]`。这是有意的适配，不声称逐字复制 Codex 的完整内部提示词。JSON 中转义尖括号，以避免所选资料意外结束上下文标签。
