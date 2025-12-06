***

# 态势感知管理器 (Situational Awareness Manager - SAM) v4.0.0 "Lepton"

**为 SillyTavern 打造的轻量级、高性能、革命性的状态管理系统。**

"Lepton" (轻子) 版本代表了 SAM 的一次重大架构重构。我们抛弃了过去那种“在每条回复中携带整个世界”的笨重做法，转而采用**检查点 (Checkpointing)** 和 **实时重构 (On-the-fly Reconstruction)** 技术。这极大地减少了聊天记录的体积，解决了上下文膨胀问题，同时保持了坚如磐石的状态一致性。

> **"更轻，更快，依然 Waaagh!"**

## 🌟 v4.0.0 "Lepton" 的核心进化

*   **🚀 革命性的检查点系统**: SAM 不再将巨大的 JSON 数据块写入每一次 AI 回复。现在，它仅根据设定的频率（如每 20 轮）或在您手动要求时保存完整的“检查点”。在检查点之间，AI 仅输出轻量级的变更命令。
*   **⚡ 极致的性能优化**: 引入了异步、非阻塞的处理流程。针对**手机端**和低性能设备进行了专门优化，消除了 UI 卡顿。
*   **🧠 智能状态重构**: 当加载聊天时，脚本会自动找到最近的检查点，并按顺序重放之后的所有命令，瞬间在内存中重建当前状态。
*   **🛡️ JSON 自动修复**: AI 写错了 JSON 格式？没问题。v4.0 集成了自动修复库，能智能纠正丢失的括号、错误的引号等常见语法错误，让流程不再中断。
*   **📝 原生多行命令支持**: 命令现在可以跨行书写，不再受单行限制，让复杂的逻辑表达更清晰。
*   **🔒 类型安全变异锁**: 新增 `disable_dtype_mutation` 标志。开启后，如果 AI 试图将一个数字变量改成字符串（反之亦然），操作将被阻止，防止数据类型污染。
*   **🆔 智能路径缩写**: 新增 `uniquely_identified` 标志。如果你的变量名是唯一的（如 `health`），你可以直接写 `@.SET("health", 100)` 而不需要写全路径 `@.SET("player.stats.health", 100)`。

## 📦 依赖插件

**必需**: 您必须安装并启用由 **n0vi028** 开发的 `JS-slash-runner` 插件（酒馆助手）。SAM 依赖此插件来运行 JavaScript 代码。

## 📥 安装

1.  确保您已经安装并启用了 `JS-slash-runner` 插件。
2.  进入插件的脚本面板 (Quick Replacer / Script Manager)，创建一个新脚本。
3.  将 `sam_state_manager.js` 的所有内容复制粘贴进去。
4.  **配置（可选）**: 在脚本顶部的 `CONFIGURATION` 区域，您可以调整：
    *   `CHECKPOINT_FREQUENCY`: 自动保存完整状态的频率（默认为 20 轮）。
    *   `ENABLE_AUTO_CHECKPOINT`: 是否开启自动检查点。

## ⚙️ 工作原理 (架构变更)

在旧版本中，每一条消息都包含完整的状态数据。这导致聊天记录迅速膨胀，消耗大量 Token。

**在 v4.0 "Lepton" 中：**

1.  **检查点 (Checkpoint)**: 脚本仅在特定的回合（例如第 1、20、40 轮）将完整的 `$$$$$$data_block...` 写入消息。
2.  **增量更新 (Delta Updates)**: 在检查点之间的回合，AI 仅需输出命令（如 `@.SET(...)`）。这些命令被视为“增量”。
3.  **状态回溯 (Reconstruction)**: 当需要获取当前状态时，SAM 会：
    *   向后扫描找到最近的一个**检查点**。
    *   以此为基准，向前顺序执行所有后续消息中的**命令**。
    *   在毫秒级内计算出当前的最终状态。

## 🚀 快速入门

### 第 1 步：初始化状态

在角色的 **开场白 (First Message)** 或 **世界信息 (World Info)** 的 `__SAM_base_data__` 条目中定义初始状态。

v4.0 引入了更稳健的数据块标记 `$$$$$$data_block`（但也兼容旧版格式）。

```javascript
$$$$$$data_block$$$$$$
{
  "static": {
    "player": {
      "name": "{{user}}",
      "gold": 100,
      "inventory": []
    },
    "world": {
      "weather": "Sunny"
    }
  },
  "time": "2024-01-01T12:00:00Z",
  "volatile": [],
  "func": [],
  "uniquely_identified": true,
  "disable_dtype_mutation": true
}
$$$$$$data_block_end$$$$$$
```

**新标志说明**:
*   `uniquely_identified`: 设为 `true` 时，如果变量名在整个对象中是唯一的，可以直接使用变量名作为路径。
*   `disable_dtype_mutation`: 设为 `true` 时，禁止改变变量的数据类型（例如不能把数字 `100` 改成字符串 `"many"`）。

### 第 2 步：在提示词中访问

像往常一样使用 `{{SAM_data}}` 宏。

*   `{{SAM_data.static.player.gold}}` -> 输出 `100`

### 第 3 步：AI 指令

告诉 AI 如何操作。由于支持了缩写（如果开启），指令可以更简洁：

> 若要修改状态，请在回复末尾使用命令：
> *   `@.SET("gold", 50);` (设置金币为50)
> *   `@.ADD("inventory", "Sword");` (添加物品)
> *   `@.TIMED_SET("weather", "Rainy", "weather_change", false, 5);` (5回合后下雨)

## 🎮 UI 交互

v4.0 在酒馆界面增加了新的功能按钮（通常位于输入框上方或扩展栏中）：

*   **手动检查点 (Manual Checkpoint)**: 强制将当前的完整状态写入上一条 AI 回复中。当你觉得“这里是一个重要的剧情节点”时使用。
*   **再次执行 (Rerun Latest)**: 如果你手动修改了上一条回复中的命令，点击此按钮可以让 SAM 重新扫描并执行该消息中的命令。
*   **重置状态 (Reset State)**: 紧急按钮。强制重置内部状态机并重新同步。

## 📖 命令参考表

所有命令支持多行书写，参数更加宽容。

| 命令 | 语法示例 | 描述 |
| :--- | :--- | :--- |
| **SET** | `@.SET("path", val);` | 设置变量值。 |
| **ADD** | `@.ADD("path", val);` | 数值相加或数组追加。 |
| **DEL** | `@.DEL("list", index);` | 按索引删除数组元素。 |
| **SELECT_SET** | `@.SELECT_SET("list", "id", "val", "prop", new);` | 在对象数组中查找并修改属性。 |
| **SELECT_ADD** | `@.SELECT_ADD("list", "id", "val", "prop", add);` | 在对象数组中查找并增加数值/追加列表。 |
| **SELECT_DEL** | `@.SELECT_DEL("list", "prop", "val");` | 删除符合条件的对象。 |
| **TIMED_SET** | `@.TIMED_SET("path", val, "reason", isRealTime, time);` | 定时任务（支持回合数或真实时间）。 |
| **CANCEL_SET** | `@.CANCEL_SET("reason");` | 取消定时任务。 |
| **EVENT_BEGIN** | `@.EVENT_BEGIN("name", "objective");` | 开始一个叙事事件。 |
| **EVENT_END** | `@.EVENT_END(exitCode, "summary");` | 结束当前事件。 |
| **EVAL** | `@.EVAL("funcName", args...);` | 执行沙盒 JS 函数。 |

## 🧩 高级功能：基础数据与 EVAL

### 基础数据 (`__SAM_base_data__`)
在世界信息 (WI) 中创建一个名为 `__SAM_base_data__` 的条目，其中的 JSON 将作为所有新聊天的“底板”。这非常适合定义通用的游戏规则函数。

### EVAL 与周期函数
在 `func` 数组中定义的函数现在支持更细粒度的控制：
*   `periodic: true`: 每次 AI 回复后自动运行。
*   `order`: `"first"` (在所有命令前执行) 或 `"last"` (在所有命令后执行)。
*   `sequence`: 数字，决定同类函数的执行顺序。

**示例：自动每回合扣除饥饿值**
```javascript
{
  "func_name": "hunger_decay",
  "func_body": "if(state.static.hunger > 0) state.static.hunger -= 1;",
  "periodic": true,
  "order": "last"
}
```

## ⚠️ 常见问题

**Q: 聊天记录里看不到那个巨大的 JSON 块了？**
A: 这是正常的！这是 Lepton 版本的特性。完整状态块只会在检查点（默认每 20 轮）出现。普通回复只包含命令。你可以随时点击“手动检查点”来生成一个。

**Q: 我手动修改了 AI 回复里的命令，但变量没变？**
A: 修改后，请点击 **“再次执行 (Rerun Latest)”** 按钮，或者刷新页面，SAM 会重新计算该回复的命令。

**Q: 升级到 v4.0 会破坏旧的聊天记录吗？**
A: 不会。v4.0 完全向后兼容。它可以读取旧版的 XML 风格数据块，但在写入新检查点时会使用新的 `$$$$$$` 格式。

---
