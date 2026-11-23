# 会话标题历史开发说明

Host 通过 Connection 的认证通道按需读取一个会话。`sessionQuery.observeSession` 也能读取归档日志。
接口只返回 `session/title` 的序号、时间、标题、来源及继承标记；日志原样保留。
按事件顺序推导旧标题，之后按序号倒序显示。
文本相同的写入也保留，以反映来源变化和手动固定。

客户端向 `contextMenus` 注册原生会话菜单项，排在「复制会话 ID」上一项，并通过 `contextMenu.icon` 提供原生时钟图标。
标题历史与复制会话 ID 共用组首分隔线。
`0.2.2-rc.5` 的注册接口只允许贡献方设置自己的分隔线，因此样式在这两个原生菜单行相邻时隐藏复制项原来的分隔线。
弹窗由 `shell.overlay` 挂载，复用宿主提供的 `Modal`、来源 `Tag` 和重试 `Button`。
历史列表保留标题前后对照及时间线布局，颜色跟随 DSH 主题。
停用时清理由插件注册的菜单、弹层与读取接口。分叉只呈现实际继承的前缀。
DSH 客户端的分叉命名也走原生重命名接口，日志将其记为 `user`。
界面按这个来源标注。未写入或已丢失的历史无法恢复。

## 构建与验证

```sh
npm ci
npm run build
npm run check
npm pack --dry-run
```

从工作区根目录运行 `node tools/new-dsh-plugin/cli.mjs --check plugins/dsh-session-title-history`。
升级 DSH 后重新核对会话日志字段、菜单入口、弹窗、分叉标记和独立开关。
