# Agent 开发指引

本仓库是 SillyTavern 中运行的单文件 SAM 脚本，不是独立网页或 Node 服务。修改角色卡协议、世界书标识、变量格式或事件接口前，先完整阅读 [`CHARA_CARD_RULES.md`](CHARA_CARD_RULES.md)；用户说明见 [`README.md`](README.md)。保留中文文本，所有新增文件用 UTF-8。

## 运行依赖

- SillyTavern 的聊天上下文与 World Info：`SillyTavern.getContext()`、`chat`、`variables.local`、`extensionSettings`、`loadWorldInfo`、`registerMacro`、`saveSettingsDebounced`。
- 兼容酒馆助手 / JS-Slash-Runner 的脚本环境：`tavern_events`、`eventOn`、`eventMakeFirst`、`eventRemoveListener`、`eventEmit`、`updateVariablesWith`、`setChatMessages`、`generateRaw`、`getWorldbook`、`replaceWorldbook`、活动世界书查询函数、`getButtonEvent` 等。独立更新还依赖 `ConnectionManagerRequestService.getSupportedProfiles/sendRequest` 及玩家已保存的 Connection Profile。
- 页面依赖：Lodash `_`、jQuery `$`、toastr、浏览器 `window`/`document`/`fetch`、`structuredClone`。JSON 修复库从 jsDelivr 的 `jsonrepair` UMD 地址懒加载；网络失败时仍需保留可用的原生 JSON 解析路径。
- 摘要可以使用 `generateRaw` / 主生成后端，或 SAM 保存的摘要 API 预设。开发时不可把真实 API Key 写入仓库。
- `package.json` 的 ESLint、Prettier 及类型包仅为开发依赖；它们不提供上述运行时全局对象。`.gitmodules` 中的酒馆助手仓库是参考依赖，不能假设开发机已拉取子模块。

参考资料：[MVU](https://github.com/MagicalAstrogy/MagVarUpdate)、[数据库](https://github.com/AlbusKen/shujuku)、[酒馆助手文档](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%85%B3%E4%BA%8E%E9%85%92%E9%A6%86%E5%8A%A9%E6%89%8B/%E4%BB%8B%E7%BB%8D.html)。外部项目的 API 可能变化；修改对接代码时以当前实际接口核对，不要照搬其变量格式。

## 修改约束

1. `sam_state_manager.js` 是运行入口。保持 `SAM_data` 的包装结构、`static` 根路径、旧检查点解析和 `<JSONPatch>` 历史重放兼容；尤其不能破坏 swipe / regenerate 的“先回退、再重放”流程。
2. 更新模式互斥：`merged` 读主回复 Patch；`independent` 只读 `[update_rule]` 条目，用一次独立请求产生权威 Patch 并写入主回复。独立请求失败不得留下主回复原 Patch 供重放。
3. 外部刷新事件名精确为 `REFRESH_SAM_VARIABLES`。事件要走串行处理，忙碌时延后，并在脚本热重载/停止时解除监听；重建只覆盖 `SAM_data`，不能清空其他脚本的本地变量，也不能写入非法楼层 ID。
4. 终极总结是手动功能。保留 `summary_progress` 的分块边界、末尾不足一块的处理、专用总结 system 指令及世界书 `off`/`all`/`selective`（K - X）过滤；不要从普通生成事件被动启动。
5. 事件处理、聊天楼层更新和异步 API 请求可能交错。修改时检查 `IDLE`、`AWAIT_GENERATION`、`PROCESSING`、`SUMMARIZING` 四个状态，避免旧聊天或旧生成结果写回当前聊天。
6. `__SAM_IDENTIFIER__` / `__SAM_base_data__` 用于角色主世界书，`[update_rule]` 用于活动世界书条目，`[important_setting]` 是摘要选择性输入的默认关键词。名称与内容的职责不可互换。
7. 函数库使用 `new Function`，不是真正安全沙箱。不要将不可信世界书代码或模型文本扩展为可执行脚本；函数变更仍需可被历史重放。

## 验证

- 至少运行 `node --check sam_state_manager.js`、`npm test`、`git diff --check`。若本地已安装开发依赖，可运行 `npm run lint` 与 `npm run format:check`；不要为了执行检查而无意改写整份大脚本。
- 在 SillyTavern / 酒馆助手环境中验证：首次进入无 AI 楼层、合并/独立两模式、swipe、regenerate、聊天切换、检查点回放、与数据库脚本同时启动、手动总结及其世界书筛选。
- 对刷新广播另验：空聊天使用基础数据；修改最新或较早楼层 Patch 后发送 `eventEmit('REFRESH_SAM_VARIABLES')` 能重建；生成或总结时广播会延后；脚本热重载后只保留一个监听器。
