# 态势感知管理器 (Situational Awareness Manager - SAM) v3.0.1

**一个为 SillyTavern 设计的强大、可靠的状态管理扩展。**

这个脚本为您的角色扮演会话提供了一个极其稳健的变量管理系统。通过使用基于事件队列的有限状态机模型，它能有效防止竞争条件（race conditions），确保即使在快速连续的操作（如快速滑动或停止生成）下，状态也能保持绝对的正确和一致。**大技霸也说很Waaagh！**

## 核心功能

*   **有限状态机 (FSM) 驱动**：采用 `IDLE`（空闲）、`AWAIT_GENERATION`（等待生成）、`PROCESSING`（处理中）的状态机逻辑，并结合事件队列，确保所有操作按正确顺序处理，从根本上杜绝了因异步操作导致的混乱。
*   **健壮的容错机制**：内置的“生成看守”(Generation Watcher) 机制能主动监测并纠正因 SillyTavern 事件丢失导致的状态不同步问题，确保插件长期稳定运行。
*   **精确的状态追踪**：能够智能地在消息**滑动 (Swipe)**、**重新生成 (Regenerate)**、**编辑 (Edit)** 和**删除 (Delete)** 时加载正确的历史状态，确保您的世界观和角色状态不会错乱。
*   **手动状态编辑**：玩家可以直接在AI回复中编辑 `<!--<|state|>...-->` 数据块来手动修正或调整任何变量，提供了极高的灵活性和纠错能力。
*   **命令驱动的状态更新**：AI 可以在其回复中嵌入简单的命令（如 `<SET::...>`）来动态修改状态，例如更新任务进度、改变 NPC 好感度或管理玩家库存。
*   **复杂的嵌套数据结构**：支持完整的 JSON 对象作为状态，您可以轻松管理如 `player.inventory.items` 或 `quests.main_quest.step` 这样的复杂数据。
*   **定时事件系统**：使用 `<TIMED_SET::...>` 命令可以安排在未来的某个回合或某个游戏中时间点自动更新状态。
*   【实验性】**沙盒化的函数执行 (`EVAL`)**：一个为高级用户准备的强大功能。您可以在状态中定义自己的 JavaScript 函数，并让 AI 通过 `<EVAL::...>` 命令来执行它们，同时脚本会限制其运行时间并可选地阻止网络访问，确保安全。

## 依赖插件

**必需**: 您必须安装并启用由 **n0vi028** 开发的 `JS-slash-runner` 插件（酒馆助手）。SAM 依赖此插件来运行。

## 安装

1.  确保您已经安装并启用了 `JS-slash-runner` 插件。
2.  进入插件的脚本面板，创建一个新脚本。将 SAM 的所有内容复制粘贴进去，或者使用下方的 import URL 从 jsdelivr 导入。
    ```
    https://cdn.jsdelivr.net/gh/DefinitelyNotProcrastinating/ST_var_manager@main/sam_state_manager.js
    ```
3.  启动该脚本。

## 工作原理

SAM 的核心思想是将“状态”作为一个持久化的数据块，附加在每一条 AI 的回复中。

1.  **加载状态**：当轮到 AI 生成回复时，SAM 会自动找到上一条 AI 回复中隐藏的状态数据块，并将其加载到 `{{SAM_data}}` 变量中。
2.  **生成回复**：AI 根据您的提示词（其中可能包含了对 `{{SAM_data}}` 的引用）来生成回复。在回复中，AI 会根据剧情需要，嵌入用于修改状态的命令（例如 `<SET::player.health::90>`）。
3.  **处理并保存**：当 AI 回复生成完毕后，SAM 会解析回复中的所有命令。它将这些命令应用到刚刚加载的状态上，计算出“新状态”。
4.  **写入新状态**：最后，SAM 会将这个“新状态”序列化为一个 JSON 字符串，并以一种能匹配正则的方式（`<!--<|state|>...-->` 块）写入到 AI 的当前回复中。
    *   **注意**：为了避免这个数据块被发送给 AI，您应该在 SillyTavern 的“格式化设置” -> “发送时去除的正则表达式”中添加一行，内容为 `<!--<\|state\|>[\s\S]*?<\/\|state\|>-->`。

这个循环确保了每一轮对话都有一个明确、连续且准确的状态记录。

## 快速入门指南

### 第 1 步：在开场白中初始化状态

您需要在角色的**开场白 (First Message)** 中定义初始状态。这是 SAM 运行的起点。

将以下结构复制到您角色开场白的末尾。您可以根据需要自定义其中的 `static` 对象。

```json
<!--<|state|>
{
  "static": {
    "player": {
      "name": "{{user}}",
      "health": 100,
      "inventory": [],
      "quests": []
    },
    "world": {
      "time_of_day": "Morning",
      "weather": "Sunny"
    },
    "npc": {
      "elara": {
        "relationship": "Neutral",
        "favorability": 50
      }
    }
  },
  "time": "2200-01-01T08:00:00Z",
  "volatile": [],
  "responseSummary": [],
  "func": []
}
</|state|>-->
```

**状态结构解释**:
*   `static`: 存储核心、长期存在的数据。这是您最常使用的部分，比如角色属性、任务状态、NPC关系等。
*   `time`: 存储游戏内时间（建议使用 UTC 格式字符串）。
*   `volatile`: 用于存储临时或计划中的事件，主要由 `<TIMED_SET>` 命令管理。
*   `responseSummary`: 存储 AI 对自己回复的总结，由 `<RESPONSE_SUMMARY>` 命令填充。
*   `func`: 存储用户定义的函数，供 `<EVAL>` 命令调用。

### 第 2 步：在提示词中访问状态

一旦初始化，整个状态对象都可以通过 `{{SAM_data}}` 变量在您的提示词（例如，主提示、作者注等）中访问。

**示例**:
*   获取玩家血量: `{{SAM_data.static.player.health}}`
*   获取世界天气: `{{SAM_data.static.world.weather}}`
*   获取 NPC 好感度: `{{SAM_data.static.npc.elara.favorability}}`

您可以像这样构建一个动态的状态面板：
```
[当前状态：玩家HP: {{SAM_data.static.player.health}}/100 | 天气: {{SAM_data.static.world.weather}} | Elara好感度: {{SAM_data.static.npc.elara.favorability}}]
```

### 第 3 步：指导 AI 修改状态

您需要在角色的**指令 (Prompt)** 中告诉它如何使用 SAM 的命令。这样，AI 才能在适当的时候自主更新状态。

**示例指令**:
> 你必须在你的回复中遵循以下规则来维护世界状态。将所有命令都放在你的叙述或对话之后。
> *   要改变一个变量，使用 `<SET :: 变量路径 :: 新值>`。示例：`<SET :: player.health :: 85>`。
> *   要给一个数值增加，或向列表添加项目，使用 `<ADD :: 变量路径 :: 值>`。示例：`<ADD :: player.health :: -10>` 或 `<ADD :: player.inventory :: "治疗药水">`。
> *   要从列表中按位置删除项目，使用 `<DEL :: 列表路径 :: 索引>`。索引从0开始。示例：`<DEL :: player.inventory :: 0>`。
> *   要更新游戏时间，使用 `<TIME :: 新的UTC时间字符串>`。示例：`<TIME :: 2200-01-01T09:30:00Z>`。
> *   要更新复杂列表中的项目（例如任务），使用 `SELECT_SET`。示例：要将 ID 为 "main_quest" 的任务步骤更新为 3，使用 `<SELECT_SET :: player.quests :: id :: "main_quest" :: step :: 3>`。

## 命令参考

所有命令都使用格式 `<命令 :: 参数1 :: 参数2 :: ...>`。路径均以 `static` 对象为起点。

*   **SET**
    *   功能：设置或创建一个变量。
    *   格式：`<SET :: 变量路径 :: 值>`
    *   示例：`<SET :: world.time_of_day :: "Night">`

*   **ADD**
    *   功能：为一个数值变量增加一个数字，或向一个数组变量添加一个元素。
    *   格式：`<ADD :: 变量路径 :: 值>`
    *   示例 (数值)：`<ADD :: player.gold :: 50>`
    *   示例 (数组)：`<ADD :: player.inventory :: "一把生锈的钥匙">`

*   **DEL**
    *   功能：根据**索引**（位置）从数组中删除一个元素。索引从 0 开始。
    *   格式：`<DEL :: 数组路径 :: 索引>`
    *   示例：要删除 `player.inventory` 中的第一个物品，使用 `<DEL :: player.inventory :: 0>`。

*   **SELECT_SET**
    *   功能：在对象数组中，找到一个其‘选择器属性’等于‘选择器值’的对象，并设置该对象的‘接收器属性’为‘新值’。
    *   格式：`<SELECT_SET :: 数组路径 :: 选择器属性 :: 选择器值 :: 接收器属性 :: 新值>`
    *   示例：假设 `player.quests` 是 `[{id: "quest1", status: "active"}, ...]`, 要更新 `quest1` 的状态，使用 `<SELECT_SET :: player.quests :: id :: "quest1" :: status :: "completed">`。

*   **SELECT_ADD**
    *   功能：在对象数组中，找到一个目标对象，并对其内部的数值或数组进行 `ADD` 操作。
    *   格式：`<SELECT_ADD :: 数组路径 :: 选择器属性 :: 选择器值 :: 接收器属性 :: 要增加的值>`
    *   示例：假设 `npc.elara` 在一个NPC列表里，要增加她的好感度，使用 `<SELECT_ADD :: npcs :: name :: "elara" :: favorability :: 10>`。

*   **SELECT_DEL**
    *   功能：从一个对象数组中，删除所有其某个属性与目标值匹配的元素。
    *   格式：`<SELECT_DEL :: 数组路径 :: 属性名 :: 目标值>`
    *   示例：假设 `player.quests` 是 `[{id: "quest1", ...}, {id: "quest2", ...}]`，要移除 ID 为 `quest1` 的任务，使用 `<SELECT_DEL :: player.quests :: id :: "quest1">`。

*   **TIME**
    *   功能：将顶层的 `time` 字符串更新至最新。
    *   格式：`<TIME :: 时间字符串>`
    *   示例：`<TIME :: 2200-01-01T11:52:12Z>`

*   **TIMED_SET**
    *   功能：安排一个在未来发生的 `SET` 命令。
    *   格式：`<TIMED_SET :: 变量路径 :: 新值 :: 理由(唯一标识) :: 是否真实时间 :: 时间点/回合数>`
    *   `是否真实时间`: `true` 表示使用游戏内的时间（UTC格式），`false` 表示使用游戏回合数。
    *   示例 (回合)：`<TIMED_SET :: player.effects.poison :: false :: "中毒结束" :: false :: 3>` (3个回合后，将 `player.effects.poison` 设为 `false`)。
    *   示例 (真实时间)：`<TIMED_SET :: world.market.isOpen :: false :: "午夜关门" :: true :: "2200-01-02T00:00:00Z">` (在指定UTC时间将市场设为关闭)。

*   **CANCEL_SET**
    *   功能：取消一个之前安排的 `TIMED_SET`。
    *   格式：`<CANCEL_SET :: 索引或理由>`
    *   示例：`<CANCEL_SET :: "中毒结束">` (取消理由为“中毒结束”的定时事件)。

*   **RESPONSE_SUMMARY**
    *   功能：向 `responseSummary` 数组添加一段对当前回复的简短总结。
    *   格式：`<RESPONSE_SUMMARY :: 总结文本>`
    *   示例：`<RESPONSE_SUMMARY :: 玩家接受了寻找神器的任务>`

*   **EVAL**
    *   功能：**（高级功能，请谨慎使用）** 执行一个在 `state.func` 中定义的自定义函数。
    *   格式：`<EVAL :: 函数名 :: 参数1 :: 参数2 :: ...>`

## 高级用法: `EVAL` 命令

`EVAL` 允许您扩展 SAM 的能力，执行复杂的逻辑，而无需修改脚本本身。

**⚠️ 警告：** 此功能会执行任意 JavaScript 代码。尽管它运行在沙盒中，有超时和网络访问限制，但仍然存在风险。请确保您完全理解您在 `state.func` 中编写的代码。**对于因使用此功能造成的任何问题，脚本作者概不负责。**

### 1. 在状态中定义函数

在您的初始状态中，向 `func` 数组添加一个函数定义对象。

```json
{
  "static": { ... },
  "time": "...",
  "volatile": [],
  "responseSummary": [],
  "func": [
    {
      "func_name": "calculateDamage",
      "func_params": ["baseDamage", "armor"],
      "func_body": "const finalDamage = Math.max(0, baseDamage - armor); _.set(state.static.player, 'health', state.static.player.health - finalDamage); console.log(`玩家受到了 ${finalDamage} 点伤害。`);",
      "timeout": 1000,
      "network_access": false
    }
  ]
}
```

*   `func_name`: 函数的调用名称。
*   `func_params`: 参数名列表，AI 调用时需要按顺序提供。支持剩余参数（如 `"param1", "...rest_of_params"`）。
*   `func_body`: 函数的 JavaScript 代码体。您可以使用 `state` 访问和修改整个状态对象，也可以使用 `_` (Lodash.js 库)。
*   `timeout`: 超时时间（毫秒）。
*   `network_access`: 是否允许函数进行网络请求 (`fetch`, `XMLHttpRequest`)。默认为 `false`。**强烈建议保持为 `false`。**

### 2. 让 AI 调用函数

现在，您可以指导 AI 在适当的时候调用这个函数。

**AI 回复示例**:
> 哥布林挥舞着它的木棒，狠狠地砸在了你的身上！
> `<EVAL :: calculateDamage :: 15 :: 5>`

当 SAM 处理这条消息时，它会：
1.  找到名为 `calculateDamage` 的函数。
2.  将 `15` 作为 `baseDamage`，`5` 作为 `armor` 传入。
3.  执行函数体中的代码，计算出 10 点伤害，并用 `_.set` 将 `state.static.player.health` 更新为新值。
4.  将更新后的状态写入消息中。
