# 态势感知管理器 (Situational Awareness Manager - SAM) v3.3.0 "Foundations"

**一个为 SillyTavern 设计的强大、可靠的状态管理扩展。**

这个脚本为您的角色扮演会话提供了一个极其稳健的变量管理系统。通过使用基于事件队列的有限状态机模型，它能有效防止竞争条件（race conditions），确保即使在快速连续的操作（如快速滑动或停止生成）下，状态也能保持绝对的正确和一致。**大技霸也说很Waaagh！**

## 核心功能

*   **有限状态机 (FSM) 驱动**：采用 `IDLE`（空闲）、`AWAIT_GENERATION`（等待生成）、`PROCESSING`（处理中）的状态机逻辑，并结合事件队列，确保所有操作按正确顺序处理，从根本上杜绝了因异步操作导致的混乱。
*   **健壮的容错机制**：内置的“生成看守”(Generation Watcher) 机制能主动监测并纠正因 SillyTavern 事件丢失导致的状态不同步问题，确保插件长期稳定运行。
*   **精确的状态追踪**：能够智能地在消息**滑动 (Swipe)**、**重新生成 (Regenerate)**、**编辑 (Edit)** 和**删除 (Delete)** 时加载正确的历史状态，确保您的世界观和角色状态不会错乱。
*   **手动状态编辑**：玩家可以直接在AI回复中编辑 `<!--<|state|>...-->` 数据块来手动修正或调整任何变量，提供了极高的灵活性和纠错能力。
*   **命令驱动的状态更新**：AI 可以在其回复中嵌入格式化的命令（如 **`@.SET(...);`**）来动态修改状态，例如更新任务进度、改变 NPC 好感度或管理玩家库存。
*   **复杂的嵌套数据结构**：支持完整的 JSON 对象作为状态，您可以轻松管理如 `player.inventory.items` 或 `quests.main_quest.step` 这样的复杂数据。
*   **定时事件系统**：使用 **`@.TIMED_SET(...);`** 命令可以安排在未来的某个回合或某个游戏中时间点自动更新状态。
*   **沙盒化的函数执行 (`EVAL`)**：一个为高级用户准备的强大功能。您可以在状态中定义自己的 JavaScript 函数，并让 AI 通过 **`@.EVAL(...);`** 命令来执行它们。现在更进一步，**支持周期性自动执行和精确的执行顺序控制（先于或后于其他命令）**，同时脚本会限制其运行时间并可选地阻止网络访问，确保逻辑的严密与安全。
*   **<font color="gold">新功能</font> 模块化的基础状态 (Base Data) 系统**：新增支持 `__SAM_base_data__` 世界信息条目。允许您创建一个可复用的“基础状态”模板（例如，包含通用规则函数或初始世界设定），并在新聊天开始时自动与角色的初始状态合并，极大地提高了角色卡的模块化和可维护性。

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
2.  **生成回复**：AI 根据您的提示词（其中可能包含了对 `{{SAM_data}}` 的引用）来生成回复。在回复中，AI 会根据剧情需要，嵌入用于修改状态的命令（例如 **`@.SET("player.health", 90);`**）。
3.  **处理并保存**：当 AI 回复生成完毕后，SAM 会解析回复中的所有命令。它将这些命令应用到刚刚加载的状态上，计算出“新状态”。
4.  **写入新状态**：最后，SAM 会将这个“新状态”序列化为一个 JSON 字符串，并以一种能匹配正则的方式（`<!--<|state|>...-->` 块）写入到 AI 的当前回复中。
    *   **注意**：为了避免这个数据块被发送给 AI，您应该在 SillyTavern 的“格式化设置” -> “发送时去除的正则表达式”中添加一行，内容为 `<!--<\|state\|>[\s\S]*?<\/\|state\|>-->`。(这里的 `\|` 是为了转义在正则表达式中有特殊含义的 `|` 字符。)

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
*   `volatile`: 用于存储临时或计划中的事件，主要由 `@.TIMED_SET(...);` 命令管理。
*   `responseSummary`: 存储 AI 对自己回复的总结，由 `@.RESPONSE_SUMMARY(...);` 命令填充。
*   `func`: 存储用户定义的函数，供 `@.EVAL(...);` 命令调用。

### 第 2 步：在提示词中访问状态

一旦初始化，整个状态对象都可以通过 `{{SAM_data}}` 变量在您的提示词（例如，主提示、作者注等）中访问。

**示例**:
*   获取玩家血量: `{{SAM_data.static.player.health}}`
*   获取世界天气: `{{SAM_data.static.world.weather}}`
*   获取 NPC 好感度: `{{SAM_data.static.npc.elara.favorability}}`

### 第 3 步：指导 AI 修改状态

您需要在角色的**指令 (Prompt)** 中告诉它如何使用 SAM 的命令。这样，AI 才能在适当的时候自主更新状态。

**示例指令**:
> 你必须在你的回复中遵循以下规则来维护世界状态。将所有命令都放在你的叙述或对话之后，每个命令必须以分号`;`结尾。
> *   要改变一个变量，使用 **`@.SET("变量路径", 新值);`**。示例：**`@.SET("player.health", 85);`**。
> *   要给一个数值增加，或向列表添加项目，使用 **`@.ADD("变量路径", 值);`**。示例：**`@.ADD("player.health", -10);`** 或 **`@.ADD("player.inventory", "治疗药水");`**。

## 新功能 (v3.3.0): 模块化与基础数据 (`__SAM_base_data__`)

"Foundations" 版本引入了一个强大的新功能，允许您在**世界信息 (World Info)** 中定义一个可复用的“基础状态”。

**工作原理**：在开始一个新聊天时，SAM 会在处理第一条 AI 回复时，自动查找当前角色所使用的世界信息中是否存在一个名为 `__SAM_base_data__` 的条目。如果找到，它会将其内容作为“基础”，然后将角色开场白中的“初始状态”**覆盖**在它之上。

这意味着，**角色卡中的状态会覆盖并优先于世界信息中的同名状态**，允许您进行精细的定制。

**核心用途**:
*   **创建可复用的规则集**：在一个 WI 条目中定义一套通用的、周期性执行的 `EVAL` 函数（例如清理库存、数据校验、状态衰减等），然后让多个角色共享这套规则，无需在每个角色卡里重复定义。
*   **构建世界观模板**：定义一个包含基础派系声望、世界地点、通用物品数据库等信息的基础状态，所有设定在该世界观下的角色都可以继承它。
*   **制作职业/能力模板**：创建一个“法师”模板，其中包含基础的法力值属性和几个法术 `EVAL` 函数，任何法师角色都可以基于此进行扩展。

### 如何使用

1.  在您的世界信息 (World Info) 中，创建一个新条目。
2.  将该条目的名称**精确地**设置为 `__SAM_base_data__`。
3.  在该条目的内容中，粘贴一个完整的、合法的 SAM 状态 JSON 结构。

#### 示例：创建一个包含“安全函数”的基础数据

这个例子定义了三个周期性函数，它们会在每回合自动运行，以保持数据的清洁和有效性。

```json
{
  "static": {},
  "time": "",
  "volatile": [],
  "responseSummary": [],
  "func": [
    {
      "func_name": "clean_stargazers",
      "func_body": "if (!state.static.mc || !Array.isArray(state.static.mc.stargazers)) return; state.static.mc.stargazers = state.static.mc.stargazers.filter(sg => sg.model_id && sg.static_profile && sg.static_profile.description);",
      "periodic": true,
      "order": "last",
      "sequence": 10
    },
    {
      "func_name": "clean_inventory",
      "func_body": "if (!state.static.mc || !Array.isArray(state.static.mc.flagship_inventory)) return; state.static.mc.flagship_inventory = state.static.mc.flagship_inventory.filter(item => item.quantity > 0);",
      "periodic": true,
      "order": "last",
      "sequence": 20
    },
    {
      "func_name": "normalize_lust",
      "func_body": "if (!state.static.mc || !Array.isArray(state.static.mc.stargazers)) return; state.static.mc.stargazers.forEach(sg => { if (typeof sg.lust === 'number' && sg.lust < 0) { sg.lust = 0; } });",
      "periodic": true,
      "order": "last",
      "sequence": 30
    }
  ]
}
```
当一个角色使用包含此条目的世界信息开始新聊天时，即使他自己的 `func` 数组是空的，这三个函数也会被自动并入状态中，并从第一回合开始生效。

## 命令参考

所有命令都使用格式 **`@.COMMAND(参数1, 参数2, ...);`**。字符串参数必须用双引号`""`括起来。路径均以 `static` 对象为起点。

*   **SET**: `@.SET("变量路径", 值);`
*   **ADD**: `@.ADD("变量路径", 值);`
*   **DEL**: `@.DEL("数组路径", 索引);`
*   **SELECT_SET**: `@.SELECT_SET("数组路径", "选择器属性", "选择器值", "接收器属性", 新值);`
*   **SELECT_ADD**: `@.SELECT_ADD("数组路径", "选择器属性", "选择器值", "接收器属性", 要增加的值);`
*   **SELECT_DEL**: `@.SELECT_DEL("数组路径", "属性名", "目标值");`
*   **TIME**: `@.TIME("时间字符串");`
*   **TIMED_SET**: `@.TIMED_SET("变量路径", 新值, "理由(唯一标识)", 是否真实时间, "时间点/回合数");`
*   **CANCEL_SET**: `@.CANCEL_SET("索引或理由");`
*   **RESPONSE_SUMMARY**: `@.RESPONSE_SUMMARY("总结文本");`
*   **EVAL**: `@.EVAL("函数名", 参数1, ...);`

*(为简洁起见，详细命令解释请参考上方脚本注释或历史版本 README)*

## 高级用法: `EVAL` 命令

`EVAL` 允许您扩展 SAM 的能力，执行复杂的逻辑，而无需修改脚本本身。

**⚠️ 警告：** 此功能会执行任意 JavaScript 代码。尽管它运行在沙盒中，有超时和网络访问限制，但仍然存在风险。请确保您完全理解您在 `state.func` 中编写的代码。**对于因使用此功能造成的任何问题，脚本作者概不负责。**

### 1. 在状态中定义函数

在您的初始状态或 `__SAM_base_data__` 中，向 `func` 数组添加一个函数定义对象。一个函数定义对象包含以下属性：

*   `func_name`: (字符串, 必需) 函数的调用名称。
*   `func_body`: (字符串, 必需) 函数的 JavaScript 代码体。您可以使用 `state` 访问和修改整个状态对象，也可以使用 `_` (Lodash.js 库)。
*   `func_params`: (数组, 可选) 参数名列表。
*   `timeout`: (数字, 可选) 超时时间（毫秒），默认为 `2000`。
*   `network_access`: (布尔值, 可选) 是否允许网络请求。默认为 `false`。**强烈建议保持为 `false`。**
*   **`periodic`**: (布尔值, 可选) 若设为 `true`，此函数将在**每次AI回复后自动执行**。
*   **`order`**: (字符串, 可选) 控制执行时机，可设为 `'first'` 或 `'last'`。
*   **`sequence`**: (数字, 可选) 为同一 `order` 组内的函数排序，数字越小越先执行。

### 2. 调用函数的方式

#### 方式一：AI 显式调用

对于没有设置 `periodic: true` 的函数，你需要指导 AI 在适当的时候通过 **`@.EVAL(...);`** 命令来调用它。

**AI 回复示例**:
> 哥布林挥舞着它的木棒，狠狠地砸在了你的身上！
> `@.EVAL("calculateDamage", 15, 5);`

#### 方式二：周期性自动执行

对于设置了 `periodic: true` 的函数，你**无需做任何事**。SAM 会在每次 AI 回复生成后，根据其 `order` 和 `sequence` 设置，在合适的时机自动执行它。这对于实现自动化游戏机制至关重要。
