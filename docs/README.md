# 会话标题历史开发说明

宿主通过 Connection 为 profile 所有者读写标题历史。
`sessionQuery.observeSession` 也能读取归档日志。
读取接口返回 `session/title` 的序号、时间、标题、来源、继承标记和已保存的文字修订。
列表按日志里的原始标题分组，再按序号倒序显示。连续同名的写入保留各自的来源和时间。
编辑根据会话和旧标题组的首条事件定位，修订持久化到 `session_title_history` 存储领域。
分叉中对继承标题的编辑仅作用于该分叉。
保存回原文字时移除修订，原始会话日志可继续用于回放。

客户端向 `contextMenus` 注册原生会话菜单项，排在「复制会话 ID」上一项，并通过 `contextMenu.icon` 提供原生时钟图标。
标题历史与复制会话 ID 共用组首分隔线。
`0.2.2-rc.5` 的注册接口只允许贡献方设置自己的分隔线，因此样式在这两个原生菜单行相邻时隐藏复制项原来的分隔线。
弹窗由 `shell.overlay` 挂载，复用宿主的 `Modal`、`Button`、`Input` 和 `Tooltip`。
历史列表默认折叠组内的同名写入。标题旁的原生 `Tag` 标出折叠条数，点击标题展开或收起。
悬停、聚焦或点按「自动生成」可查看标题提供方及模型。
旧标题旁的铅笔打开行内输入。保存或取消后焦点回到铅笔，保存失败时保留草稿并显示原因。
文字不同于当前标题的旧标题提供右上箭头。
点击后通过 `sessions.using` 和 `SessionFace.rename` 把显示的文字重新设为当前标题。
引用来源标签 `dsh-session-title-history` 登记在 `SessionReferenceSourceMap`。
两种按钮都使用原生「重命名」菜单项的权限判定 `useSessionAccess(sessionId, 'session/rename')`。
一键设回后重新读取历史，焦点移到下一条更早的可设回标题。
失败时焦点回到原按钮。触屏设备提供 36 px 方形点击区域。

## Agent 工具

宿主向 `tools` 注册 `session_title_history`。
省略 `sessionId` 时作用于发起调用的会话。

- `list` 返回弹窗里的标题文字（最新在前，最多 50 组，其余计入 `omitted`）。
- `edit` 用 `list` 返回的 `seq` 和新文字 `title` 修改一条旧标题，与弹窗共用宿主保存逻辑。
- `restore` 根据显示文字定位过去标题，调用 `sessionController.rename` 后写入一条手动命名事件。

失败结果带 `reason`，取消交给执行器处理。停用插件时清理菜单、弹层、接口和工具，关闭存储领域。
分叉只呈现实际继承的前缀。DSH 客户端的分叉命名也走原生重命名接口，日志将其记为 `user`。
界面按这个来源标注。未写入或已丢失的历史无法恢复。

## 构建与验证

```sh
npm ci
npm run build
npm run check
npm pack --dry-run
```

从工作区根目录运行 `node tools/new-dsh-plugin/cli.mts --check plugins/dsh-session-title-history`。
升级 DSH 后重新核对会话日志字段、菜单入口、弹窗、分叉标记、独立开关、重命名接口与 `session/rename` 权限判定。
