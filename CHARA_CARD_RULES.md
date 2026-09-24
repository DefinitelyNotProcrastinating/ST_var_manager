# SAM 角色卡与世界书规则

本文是角色卡作者和其他脚本对接 SAM 的约定。运行实现以 [`sam_state_manager.js`](sam_state_manager.js) 为准；不要把完整 `SAM_data` 当作每轮模型输出。所有文件、世界书 JSON 与脚本文本均使用 UTF-8。

## 启用与世界书标识

| 世界书条目名称 / `comment` | 内容 | 作用 |
| --- | --- | --- |
| `__SAM_IDENTIFIER__` | 函数定义 JSON 数组；不用函数时填 `[]` | 角色主世界书中的传统 SAM 激活标识及函数库。读取时要求 `comment` 精确相等；为兼容函数编辑器，名称也设为相同值。 |
| `__SAM_base_data__` | 初始 `static` 对象的 JSON | 可选基础数据。没有检查点时从这里开始重放。仅从角色主世界书读取，`comment` 精确相等。 |
| 名称包含 `[update_rule]` | 自由文本更新规则 | 独立变量更新的规则来源。读取当前活动的全局、角色、聊天世界书；不包含此短语的条目不进入独立更新请求。 |
| 名称包含 `[important_setting]` | 设定文本 | 终极总结“选择性输入世界书”的默认包含条件；可在 UI 更改包含/排除关键词。 |

角色主世界书中有 `__SAM_IDENTIFIER__`，或活动世界书中有 `[update_rule]`，SAM 数据功能才会激活。基础数据标识本身不负责激活。世界书条目的启用/触发条件不会取代上述名称筛选：SAM 按活动世界书读取条目，而非只读取当前被提示词触发的条目。

基础数据示例（内容是 `static`，不是完整 `SAM_data`）：

```json
{
  "主角": {
    "金币": 100,
    "地点": "城门",
    "背包": [],
    "_等级": 1
  }
}
```

## 变量结构与公开接口

本地变量键为 `SAM_data`，初始结构为：

```json
{
  "static": {},
  "time": "",
  "dtime": 0,
  "volatile": [],
  "responseSummary": { "L1": [], "L2": [], "L3": [] },
  "summary_progress": 0,
  "summary_failed_progress": -1,
  "func": [],
  "events": [],
  "event_counter": 0
}
```

`static` 是角色卡业务变量；模型的路径均以它为根，**不要**写 `/static` 前缀。`time`/`dtime` 由 `time` 操作维护。`responseSummary`、`summary_progress` 是总结状态；L1 保留兼容，当前自动生成的是 L2/L3。其余字段保留为历史兼容结构。世界书或提示词可使用 `{{SAM_serialized_db}}`（格式化 `static`）及 `{{SAM_serialized_memory}}`（按顺序的 L2/L3 摘要）。

## 两种互斥变量更新模式

在浮窗“变量更新”页选择一种模式；设置保存在 SillyTavern 的 `extensionSettings.sam_extension`。

1. **合并更新**：主模型回复中含一个 `<JSONPatch>` 块，SAM 在生成结束后提取并应用。
2. **独立更新**：主回复无需提供变量块。SAM 在主回复结束后，用玩家选定的已保存 Connection Profile 单独发出一次请求，读取名称包含 `[update_rule]` 的世界书条目，并把返回的操作写入/替换该主回复的 `<JSONPatch>`。已有的主回复变量块不会作为第二套更新再应用。Connection Profile、最大回复 token 数和独立更新提示词均在 UI 保存。

独立提示词可用 `{{update_rules}}`、`{{current_state}}`、`{{chat_history}}`、`{{latest_message}}`；其中 `current_state` 是更新前的 `static`。独立更新器应只输出一个 JSON 数组格式的 `<JSONPatch>`；无变化时输出 `<JSONPatch>\n[]\n</JSONPatch>`。若请求失败，SAM 会清除主回复中原有的变量块，避免后续历史重放误用它。

合并模式的最小输出示例：

```xml
角色穿过城门，捡起一枚徽章。

<JSONPatch>
[
  { "op": "replace", "path": "/主角/地点", "value": "旧城区" },
  { "op": "inc", "path": "/主角/金币", "value": -5 },
  { "op": "addToSet", "path": "/主角/背包", "value": "徽章" }
]
</JSONPatch>
```

## JSONPatch 操作与路径

块内可有多个操作，按顺序执行。路径是 JSON Pointer，以 `/` 开始；路径片段中的 `~` 写成 `~0`、`/` 写成 `~1`。叶子键以 `_` 开头时，普通路径操作会被跳过，只有 `forced_set` 可以写入；这是防止模型改动派生值的约定，不是权限隔离。

| `op` | 字段 | 行为 |
| --- | --- | --- |
| `replace`, `forced_set`, `insert` | `path`, `value` | 设置值；`insert` 的 `/-` 路径向数组尾部追加。 |
| `remove` | `path` | 删除值。 |
| `inc`, `delta` | `path`, `value` | 加上数值；非数值旧值按 0 处理。 |
| `mul` | `path`, `value` | 数值相乘；非数值旧值按 0 处理。 |
| `min`, `max` | `path`, `value` | 在新值更小/更大时写入。 |
| `push` | `path`, `value` | 数组追加；`value: {"$each": [...]}` 可追加多个。 |
| `addToSet` | `path`, `value` | 深度相等值不重复追加；也支持 `$each`。 |
| `pull` | `path`, `value` | 从数组删除等值或匹配对象。 |
| `pop` | `path`, `value` | `1` 删除末项，`-1` 删除首项。 |
| `move` | `path` 或 `from`, `to` | 移动值至目标路径。 |
| `time` | `value` | 保存字符串时间，计算与旧时间的差 `dtime`（毫秒）。 |
| `func` | `func_name`, 可选 `params` | 调用世界书函数库中的函数。 |

这些是 SAM 的扩展操作，不是严格的 RFC 6902 JSON Patch；尤其 `replace`/`insert` 可创建路径，`remove` 缺失路径也不会终止整批处理。对无效操作，SAM 记录错误并继续其余操作。解析器尝试修复有缺陷的 JSON，但角色卡仍应要求模型输出标准 JSON。

## 函数库与额外更新

`__SAM_IDENTIFIER__` 的内容是函数数组，例如：

```json
[
  {
    "func_name": "tick_hunger",
    "func_params": [],
    "func_body": "state.static.主角.饥饿度 += 1;",
    "periodic": true,
    "timeout": 2000,
    "network_access": false
  }
]
```

`func` 操作显式调用；`periodic: true` 的函数在处理每次 AI 主回复时自动调用。函数得到 `state`、Lodash `_`、`fetch`、`XMLHttpRequest`（传入 `null`）与声明的参数，可直接修改 `state.static`。实时执行的函数变更被转成操作写回主回复，使 swipe / regenerate 后的历史重放可以复原。函数体通过 `new Function` 执行，**不是安全沙箱**；`network_access: false` 和 Promise 超时也不能完全隔离恶意代码，只使用可信条目。

## 检查点、重建与广播

SAM 从目标 AI 楼层向前找最近的完整检查点，然后按顺序重放后续 AI 楼层的 `<JSONPatch>`；无检查点时从 `__SAM_base_data__`（如有）开始。支持当前的 `$$$$$$data_block$$$$$$` / `$$$$$$data_block_end$$$$$$` 以及旧 `<SAMCheckpoint>`。手动检查点、直接编辑状态、摘要保存可在最新 AI 楼层写入完整状态。swipe、regenerate、消息编辑/删除、聊天切换和启动时均会触发相应的状态同步。无 AI 楼层时也可从基础数据初始化，且不会尝试刷新 `-1` 消息楼层。

任何在同一酒馆助手事件环境中的 UI/JS 部件，都可请求一次重建：

```js
eventEmit('REFRESH_SAM_VARIABLES');
```

该广播没有参数。SAM 会走其事件队列，从当前聊天最新检查点重放到最新 AI 楼层，更新内存与本地变量 `SAM_data`，不发送模型请求、不改写聊天消息。如果正在生成或手动总结，会在回到空闲后处理；同一忙碌周期的多个刷新请求会合并。广播是请求信号，`eventEmit` 返回不代表异步重建已完成；依赖结果的部件应在后续读取 `SAM_data`。SAM 处理主回复完成时另行发出 `SAM_RESPONSE_PROCESSING_COMPLETED`。

## 终极总结

终极总结只由浮窗“手动运行终极总结”启动，不随普通生成自动运行。从 `summary_progress` 到聊天末尾按 L2 频率分块，最后不足一块的消息也会总结；达到 L3 频率后把多个 L2 压缩成 L3。总结输入会剔除检查点、JSONPatch 以及用户配置的清理正则。专用 system 指令要求只总结而不续写剧情，也不输出变量更新。可查看下一次提示词、编辑或重写 L2/L3 内容。总结 API 可使用当前主后端或保存的摘要 API 预设。

世界书输入有三档：`off` 不输入、`all` 输入全部活动世界书条目、`selective` 按条目名称执行 `K - X`。在选择性模式中，K 为命中任一包含关键词的条目，X 为命中任一排除关键词的条目，排除优先。关键词用英文或中文逗号分隔、去首尾空白、不区分大小写；默认包含关键词是 `[important_setting]`。L2 提示词可用 `{{db_content}}`、`{{worldbook_content}}`、`{{chat_content}}`；L3 可用 `{{summary_content}}`。

## 浮窗与设置

浮窗提供变量更新模式、手动总结/摘要查看、状态 JSON 直接编辑、摘要 API 预设、函数库编辑、总结清理正则、全局启用开关、设置导入导出、手动检查点与内部状态重置。设置导入导出不含 API 预设。修改状态或历史消息后，可发送上述刷新广播校正缓存；若直接编辑 `SAM_data` 而不写检查点或 `<JSONPatch>`，下一次重建会从历史恢复并覆盖该临时改动。
