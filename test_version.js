// ============================================================================
// == Situational Awareness Manager
// == Version: 3.7.0 "Antifragile"
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It correctly handles state during swipes and regenerations by using
// == the GENERATION_STARTED event to prepare the state, fixing race conditions.
// == It also includes a sandboxed EVAL command for user-defined functions,
// == now with support for execution ordering and periodic execution.
// == It now features a comprehensive logging system and recovery tools.
// == [NEW in 3.7.0] Adds AUTO-REPAIR for broken JSON arguments.
// == If the AI writes invalid JSON, the script dynamically imports a repair
// == library (jsonrepair), fixes the syntax, and executes the command.
// == [NEW in 3.6.1] Adds native support for MULTILINE commands. 
// == Arguments can now span multiple lines or contain newlines.
// == [NEW in 3.6.0] Adds a new, more robust state block format `$$$$$$data_block...`
// == [NEW in 3.6.0] Adds `uniquely_identified` flag to allow abbreviated paths in commands.
// == [NEW in 3.6.0] Adds `disable_dtype_mutation` flag to prevent AI from changing variable types.
// == [NEW in 3.5.0] Major performance overhaul: Asynchronous, non-blocking
// == processing to eliminate UI stuttering on low-power devices.
// == [NEW in 3.4.0] Adds a structured, stateful event tracking system to manage
// == multi-turn narrative arcs with commands like EVENT_BEGIN and EVENT_END.
// == [NEW in 3.3.0] Adds support for a __SAM_base_data__ World Info entry,
// == allowing a base state to be loaded and merged on the first turn.
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

// Plug and play command reference, paste into prompt:
/*
command_syntax:
  - command: TIME
    description: Updates the time progression.
    syntax: '@.TIME("new_datetime_string");'
    parameters:
      - name: new_datetime_string
        type: string
        description: A string that can be parsed as a Date (e.g., "2024-07-29T10:30:00Z").
  - command: SET
    description: Sets a variable at a specified path to a given value.
    syntax: '@.SET("path.to.var", value);'
    parameters:
      - name: path.to.var
        type: string
        description: The dot-notation path to the variable in the state object.
      - name: value
        type: any
        description: The new value to assign. Can be a string, number, boolean, null, or a JSON object/array.
  - command: ADD
    description: Adds a value. If the target is a number, it performs numeric addition. If the target is a list (array), it appends the value.
    syntax: '@.ADD("path.to.var", value_to_add);'
    parameters:
      - name: path.to.var
        type: string
        description: The path to the numeric variable or list.
      - name: value_to_add
        type: number | any
        description: The number to add or the item to append to the list.
  - command: DEL
    description: Deletes an item from a list by its numerical index. The item is removed, and the list is compacted.
    syntax: '@.DEL("path.to.list", index);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list.
      - name: index
        type: integer
        description: The zero-based index of the item to delete.
  - command: SELECT_SET
    description: Finds a specific object within a list and sets a property on that object to a new value.
    syntax: '@.SELECT_SET("path.to.list", "selector_key", "selector_value", "receiver_key", new_value);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to find the correct object.
      - name: receiver_key
        type: string
        description: The property name on the found object to update.
      - name: new_value
        type: any
        description: The new value to set.
  - command: SELECT_ADD
    description: Finds a specific object within a list and adds a value to one of its properties.
    syntax: '@.SELECT_ADD("path.to.list", "selector_key", "selector_value", "receiver_key", value_to_add);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to find the correct object.
      - name: receiver_key
        type: string
        description: The property on the found object to add to (must be a number or a list).
      - name: value_to_add
        type: any
        description: The value to add or append.
  - command: SELECT_DEL
    description: Finds and completely deletes an object from a list based on a key-value match.
    syntax: '@.SELECT_DEL("path.to.list", "selector_key", "selector_value");'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to identify the object for deletion.
  - command: TIMED_SET
    description: Schedules a variable to be set to a new value in the future, either based on real-world time or in-game rounds.
    syntax: '@.TIMED_SET("path.to.var", new_value, "reason", is_real_time, timepoint);'
    parameters:
      - name: path.to.var
        type: string
        description: The dot-notation path to the variable to set.
      - name: new_value
        type: any
        description: The value to set the variable to when the time comes.
      - name: reason
        type: string
        description: A unique identifier for this scheduled event, used for cancellation.
      - name: is_real_time
        type: boolean
        description: If true, `timepoint` is a date string. If false, `timepoint` is a number of rounds from now.
      - name: timepoint
        type: string | integer
        description: The target time. A date string like "2024-10-26T10:00:00Z" if `is_real_time` is true, or a number of rounds (e.g., 5) if false.
  - command: CANCEL_SET
    description: Cancels a previously scheduled TIMED_SET command.
    syntax: '@.CANCEL_SET("identifier");'
    parameters:
      - name: identifier
        type: string | integer
        description: The `reason` string or the numerical index of the scheduled event in the `state.volatile` array to cancel.
  - command: RESPONSE_SUMMARY
    description: Adds a text summary of the current response to the special `state.responseSummary` list.
    syntax: '@.RESPONSE_SUMMARY("summary_text");'
    parameters:
      - name: summary_text
        type: string
        description: A concise summary of the AI's response.
  - command: EVENT_BEGIN
    description: Starts a new narrative event. Fails if another event is already active.
    syntax: '@.EVENT_BEGIN("name", "objective", "optional_first_step", ...);'
    parameters:
      - name: name
        type: string
        description: The name of the event (e.g., "The Council of Elrond").
      - name: objective
        type: string
        description: The goal of the event (e.g., "Decide the fate of the One Ring").
      - name: '...'
        type: string
        description: Optional. One or more strings to add as the first procedural step(s) of the event.
  - command: EVENT_END
    description: Concludes the currently active event, setting its status and end time.
    syntax: '@.EVENT_END(exitCode, "optional_summary");'
    parameters:
      - name: exitCode
        type: integer
        description: The status code for the event's conclusion (1=success, -1=aborted/failed, other numbers for custom states).
      - name: optional_summary
        type: string
        description: Optional. A final summary of the event's outcome.
  - command: EVENT_ADD_PROC
    description: Adds one or more procedural steps to the active event's log.
    syntax: '@.EVENT_ADD_PROC("step_description_1", "step_description_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: One or more strings detailing what just happened in the event.
  - command: EVENT_ADD_DEFN
    description: Adds a temporary, event-specific definition (like a new item or concept) to the active event.
    syntax: '@.EVENT_ADD_DEFN("item_name", "item_description");'
    parameters:
      - name: item_name
        type: string
        description: The name of the new concept (e.g., "Shard of Narsil").
      - name: item_description
        type: string
        description: A brief description of the concept.
  - command: EVENT_ADD_MEMBER
    description: Adds one or more members to the list of participants in the active event.
    syntax: '@.EVENT_ADD_MEMBER("name_1", "name_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: The names of the characters or entities involved in the event.
  - command: EVENT_SUMMARY
    description: Sets or updates the summary for the active event. This can be done before the event ends.
    syntax: '@.EVENT_SUMMARY("summary_text");'
    parameters:
      - name: summary_text
        type: string
        description: The summary content.
  - command: EVAL
    description: Executes a user-defined function stored in `state.func`. DANGEROUS - use with caution.
    syntax: '@.EVAL("function_name", param1, param2, ...);'
    parameters:
      - name: function_name
        type: string
        description: The `func_name` of the function object to execute from the `state.func` array.
      - name: '...'
        type: any
        description: Optional, comma-separated parameters to pass to the function.
*/

// ------------------------------------------------------------------------------------------- 

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    // NEW: Define both old and new state block formats for robust parsing
    const OLD_START_MARKER = '<!--<|state|>';
    const OLD_END_MARKER = '</|state|>-->';
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';

    // NEW: Use the new, more robust format for writing state blocks
    const STATE_BLOCK_START_MARKER = NEW_START_MARKER;
    const STATE_BLOCK_END_MARKER = NEW_END_MARKER;

    // NEW: Regexes now match EITHER format for parsing and removing
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*([\\s\\S]*?)\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*[\\s\\S]*?\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 'sg');

    // V3.6.1: Modified regex to only detect the START of a command. We handle the rest with a stateful parser to support multiline.
    const COMMAND_START_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVENT_BEGIN|EVENT_END|EVENT_ADD_PROC|EVENT_ADD_DEFN|EVENT_ADD_MEMBER|EVENT_SUMMARY|EVAL)\b\s*\(/gim;
    const INITIAL_STATE = { static: {}, time: "", volatile: [], responseSummary: [], func: [], events: [], event_counter: 0, uniquely_identified: false, disable_dtype_mutation: false };

    // 🔧 手机端性能优化：检测设备类型并自动调整参数
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const DELAY_MS = isMobileDevice ? 10 : 5; // 手机端使用更长延迟
    const COMMAND_BATCH_SIZE = isMobileDevice ? 3 : 5; // 手机端使用更小批次
    const REGEX_MATCH_INTERVAL = isMobileDevice ? 2 : 3; // 手机端更频繁释放主线程

    // --- STATE & LIFECYCLE MANAGEMENT ---
    let isProcessingState = false;
    let isDispatching = false;
    const event_queue = [];
    const executionLog = [];
    let generationWatcherId = null;

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };
    var curr_state = STATES.IDLE;
    const WATCHER_INTERVAL_MS = 3000;
    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";
    const HANDLER_STORAGE_KEY = `__SAM_V3_EVENT_HANDLER_STORAGE__`;
    const SESSION_STORAGE_KEY = "__SAM_ID__";
    var session_id = "";

    const logger = {
        info: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'INFO', timestamp: new Date().toISOString(), message });
            console.log(`[${SCRIPT_NAME}]`, ...args);
        },
        warn: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'WARN', timestamp: new Date().toISOString(), message });
            console.warn(`[${SCRIPT_NAME}]`, ...args);
        },
        error: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'ERROR', timestamp: new Date().toISOString(), message });
            console.error(`[${SCRIPT_NAME}]`, ...args);
        }
    };

    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) { logger.info("No previous instance found. Starting fresh."); return; }
        logger.info("Found a previous instance. Removing its event listeners to prevent duplicates.");
        eventRemoveListener(tavern_events.GENERATION_STARTED, oldHandlers.handleGenerationStarted);
        eventRemoveListener(tavern_events.GENERATION_ENDED, oldHandlers.handleGenerationEnded);
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, oldHandlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, oldHandlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, oldHandlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, oldHandlers.handleChatChanged);
        eventRemoveListener(tavern_events.MESSAGE_SENT, oldHandlers.handleMessageSent);
        eventRemoveListener(tavern_events.GENERATION_STOPPED, oldHandlers.handleGenerationStopped);
        delete window[HANDLER_STORAGE_KEY];
    };

    // --- HELPER FUNCTIONS ---
    // V3.7.0: Dynamic Loader for Repair Library
    async function loadExternalLibrary(url, globalName) {
        if (window[globalName]) return;
        logger.info(`[SAM] Downloading external library: ${globalName}...`);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                logger.info(`[SAM] Library ${globalName} loaded successfully.`);
                resolve();
            };
            script.onerror = () => {
                const err = new Error(`Failed to load script: ${url}`);
                logger.error(err);
                reject(err);
            };
            document.head.appendChild(script);
        });
    }

    // V3.6.1: Multiline-safe parser helper
    function extractBalancedParams(text, startIndex) {
        let depth = 1;
        let inString = false;
        let quoteChar = '';
        let i = startIndex;
        const len = text.length;
        
        while (i < len && depth > 0) {
            const c = text[i];
            
            if (inString) {
                if (c === quoteChar) {
                    let backslashCount = 0;
                    let j = i - 1;
                    while (j >= startIndex && text[j] === '\\') {
                        backslashCount++;
                        j--;
                    }
                    if (backslashCount % 2 === 0) {
                        inString = false;
                    }
                }
            } else {
                if (c === '"' || c === "'" || c === '`') {
                    inString = true;
                    quoteChar = c;
                } else if (c === '(') {
                    depth++;
                } else if (c === ')') {
                    depth--;
                }
            }
            i++;
        }
        
        if (depth === 0) {
            return {
                params: text.substring(startIndex, i - 1),
                endIndex: i
            };
        }
        return null;
    }

    function stopGenerationWatcher() {
        if (generationWatcherId) {
            logger.info('[SAM Watcher] Stopping generation watcher.');
            clearInterval(generationWatcherId);
            generationWatcherId = null;
        }
    }
    function startGenerationWatcher() {
        stopGenerationWatcher();
        logger.info(`[SAM] [Await watcher] Starting generation watcher. Will check UI every ${WATCHER_INTERVAL_MS / 1000}s.`);
        
        // 🔧 添加超时保护
        const GENERATION_TIMEOUT_MS = 300000; // 5分钟
        const watcherStartTime = Date.now();
        
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
            const elapsedTime = Date.now() - watcherStartTime;
            
            // 🔧 超时检测
            if (elapsedTime > GENERATION_TIMEOUT_MS) {
                logger.error('[SAM Watcher] Generation timeout! Forcing completion.');
                stopGenerationWatcher();
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);
                return;
            }
            
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
                logger.warn('[SAM] [Await watcher] DETECTED DESYNC! FSM is in AWAIT_GENERATION, but ST is not generating. Forcing state transition.');
                stopGenerationWatcher();
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);
            } else if (curr_state !== STATES.AWAIT_GENERATION) {
                logger.info('[SAM Watcher] FSM is no longer awaiting generation. Shutting down watcher.');
                stopGenerationWatcher();
            }
        }, WATCHER_INTERVAL_MS);
    }
    async function getRoundCounter() { return SillyTavern.chat.length - 1; }
    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                // NEW: Ensure new flags are present, defaulting to false.
                return { 
                    static: parsed.static ?? {}, 
                    time: parsed.time ?? "", 
                    volatile: parsed.volatile ?? [], 
                    responseSummary: parsed.responseSummary ?? [], 
                    func: parsed.func ?? [], 
                    events: parsed.events ?? [], 
                    event_counter: parsed.event_counter ?? 0,
                    uniquely_identified: parsed.uniquely_identified ?? false,
                    disable_dtype_mutation: parsed.disable_dtype_mutation ?? false
                };
            } catch (error) {
                logger.error("Failed to parse state JSON.", error);
                return _.cloneDeep(INITIAL_STATE);
            }
        }
        return null;
    }
    async function findLatestState(chatHistory, lastIndex = chatHistory.length - 1) {
        logger.info(`finding latest state down from ${lastIndex}`);
        for (let i = lastIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;
            const state = parseStateFromMessage(message.mes);
            if (state) {
                logger.info(`State loaded from message at index ${i}.`);
                return _.cloneDeep(state);
            }
        }
        logger.info("No previous state found. Using initial state.");
        return _.cloneDeep(INITIAL_STATE);
    }
    function findLatestUserMsgIndex() {
        for (let i = SillyTavern.chat.length - 1; i >= 0; i--) {
            if (SillyTavern.chat[i].is_user) { return i; }
        }
        return -1;
    }
    // 🔧 使用更快的拷贝方法，避免 _.cloneDeep 的性能问题
    function goodCopy(state) { 
        if (!state) return _.cloneDeep(INITIAL_STATE);
        
        // 🔧 对于简单对象，使用 JSON 序列化比 _.cloneDeep 更快
        try {
            return JSON.parse(JSON.stringify(state));
        } catch (error) {
            // 🔧 如果 JSON 方法失败（例如循环引用），回退到 _.cloneDeep
            logger.warn('goodCopy: JSON method failed, falling back to _.cloneDeep');
            return _.cloneDeep(state);
        }
    }

    function getActiveEvent(state) {
        if (!state.events || state.events.length === 0) return null;
        for (let i = state.events.length - 1; i >= 0; i--) {
            if (state.events[i].status === 0) {
                return state.events[i];
            }
        }
        return null;
    }

    async function getBaseDataFromWI() {
        const WI_ENTRY_NAME = "__SAM_base_data__";
        try {
            const worldbookNames = await getCharWorldbookNames("current");
            if (!worldbookNames || !worldbookNames.primary) {
                logger.info(`Base data check: No primary worldbook assigned.`);
                return null;
            }
            const wi = await getWorldbook(worldbookNames.primary);
            if (!wi || !Array.isArray(wi)) {
                logger.warn(`Base data check: Could not retrieve entries for worldbook "${worldbookNames.primary}".`);
                return null;
            }
            const baseDataEntry = wi.find(entry => entry.name === WI_ENTRY_NAME);
            if (!baseDataEntry) {
                logger.info(`Base data check: No entry named "${WI_ENTRY_NAME}" found in worldbook "${worldbookNames.primary}".`);
                return null;
            }
            if (!baseDataEntry.content) {
                logger.warn(`Base data check: Entry "${WI_ENTRY_NAME}" found, but its content is empty.`);
                return null;
            }
            try {
                const parsedData = JSON.parse(baseDataEntry.content);
                logger.info(`Successfully parsed base data from "${WI_ENTRY_NAME}".`);
                return parsedData;
            } catch (jsonError) {
                logger.error(`Base data check: Failed to parse JSON from entry "${WI_ENTRY_NAME}".`, jsonError);
                return null;
            }
        } catch (error) {
            logger.error(`Base data check: An unexpected error occurred while fetching world info.`, error);
            return null;
        }
    }
    
    async function runSandboxedFunction(funcName, params, state) {
        const funcDef = state.func?.find(f => f.func_name === funcName);
        if (!funcDef) { logger.warn(`EVAL: Function '${funcName}' not found.`); return; }
        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const rawParamNames = funcDef.func_params || [];
        let formalParamNames = [];
        let restParamName = null;
        for (const param of rawParamNames) {
            if (param.startsWith('...')) { restParamName = param.substring(3); }
            else { formalParamNames.push(param); }
        }
        let bodyPrologue = '';
        if (restParamName) {
            const startIndex = formalParamNames.length;
            bodyPrologue = `const ${restParamName} = Array.from(arguments).slice(${4 + startIndex});\n`;
        }
        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;
                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...formalParamNames];
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];
                const functionBody = `'use strict';\n${bodyPrologue}${funcDef.func_body}`;
                const userFunction = new Function(...argNames, functionBody);
                const result = await userFunction.apply(null, argValues);
                resolve(result);
            } catch (error) { reject(error); }
        });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout);
        });
        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            logger.info(`EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            logger.error(`EVAL: Error executing function '${funcName}'.`, error);
        }
    }

    // --- CORE LOGIC ---
    async function processVolatileUpdates(state) {
        if (!state.volatile || !state.volatile.length) return [];
        const promotedCommands = [];
        const remainingVolatiles = [];
        const currentRound = await getRoundCounter();
        const currentTime = state.time ? new Date(state.time) : new Date();
        for (const volatile of state.volatile) {
            const [varName, varValue, isRealTime, targetTime] = volatile;
            let triggered = isRealTime ? (currentTime >= new Date(targetTime)) : (currentRound >= targetTime);
            if (triggered) {
                const params = `${JSON.stringify(varName)}, ${JSON.stringify(varValue)}`;
                promotedCommands.push({ type: 'SET', params: params });
            } else {
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }

    // NEW: Helper function to build a map of unique keys to full paths
    function buildPathMap(obj, currentPath = '', pathMap = new Map(), collisionSet = new Set()) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;

        for (const key of Object.keys(obj)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            if (pathMap.has(key)) {
                collisionSet.add(key);
            } else {
                pathMap.set(key, newPath);
            }
            buildPathMap(obj[key], newPath, pathMap, collisionSet);
        }
        return { pathMap, collisionSet };
    }
    
    // NEW: Helper function to check for illegal data type mutations
    function isTypeMutationAllowed(oldValue, newValue) {
        if (oldValue === null || typeof oldValue === 'undefined') {
            return true; // Always allow setting a value if it's currently null or undefined
        }
        const oldType = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        const newType = Array.isArray(newValue) ? 'array' : typeof newValue;
        return oldType === newType;
    }

    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;
        const currentRound = await getRoundCounter();
        let modifiedListPaths = new Set();
        
        // NEW: Abbreviation mapping logic
        let pathMap = null;
        if (state.uniquely_identified) {
            const { pathMap: generatedMap, collisionSet } = buildPathMap(state.static);
            for (const key of collisionSet) {
                generatedMap.delete(key);
            }
            pathMap = generatedMap;
            if (collisionSet.size > 0) {
                logger.warn(`[SAM] Abbreviation mapping disabled for colliding keys: ${[...collisionSet].join(', ')}`);
                toastr.warning(`SAM: Abbreviation mapping disabled for non-unique keys: ${[...collisionSet].join(', ')}`);
            } else {
                logger.info("[SAM] Abbreviation mapping enabled for all unique keys.");
            }
        }
        
        // Helper to resolve abbreviated paths
        const resolvePath = (path) => pathMap?.get(path) ?? path;

        // 🔧 使用动态批次大小，自动适配设备性能
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            
            // 🔧 根据设备类型动态调整释放频率
            if (i > 0 && i % COMMAND_BATCH_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
            
            let params;
            // V3.7.0: Updated Parameter Parsing with Auto-Recovery
            const paramsString = command.params.trim();
            const wrappedString = `[${paramsString}]`;

            try {
                // Try standard parse first
                params = paramsString ? JSON.parse(wrappedString) : [];
            } catch (error) {
                logger.warn(`[SAM] JSON parse failed for command ${command.type}. Attempting repair via jsonrepair...`);
                try {
                    // Check if library is loaded, if not, load it
                    if (typeof window.jsonrepair !== 'function') {
                        await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                    }
                    
                    // Attempt to repair the wrapped array string
                    const fixed = window.jsonrepair(wrappedString);
                    params = JSON.parse(fixed);
                    
                    logger.info(`[SAM] JSON repaired successfully.`);
                    if(paramsString.length > 50) {
                        logger.info(`[SAM] Repaired Content: ${fixed}`);
                    }
                } catch (repairError) {
                    logger.error(`[SAM] Fatal: Failed to repair JSON for command ${command.type}. Skipping.`, repairError);
                    toastr.error(`SAM: Failed to parse/repair command ${command.type}.`);
                    continue; // Skip this command
                }
            }

            try {
                // NEW: Resolve path for commands that use it as the first parameter
                const pathCommands = ['SET', 'ADD', 'DEL', 'SELECT_DEL', 'SELECT_ADD', 'SELECT_SET', 'TIMED_SET'];
                if (pathCommands.includes(command.type) && params.length > 0 && typeof params[0] === 'string') {
                    const originalPath = params[0];
                    params[0] = resolvePath(originalPath);
                    if (originalPath !== params[0]) {
                        logger.info(`[SAM] Abbreviation resolved: '${originalPath}' -> '${params[0]}'`);
                    }
                }

                switch (command.type) {
                    case 'SET': { 
                        // NEW: Type mutation check
                        if (state.disable_dtype_mutation) {
                            const oldValue = _.get(state.static, params[0]);
                            if (!isTypeMutationAllowed(oldValue, params[1])) {
                                logger.warn(`[SAM] Blocked illegal type mutation for path "${params[0]}".`);
                                toastr.warning(`SAM: Blocked illegal type mutation on "${params[0]}".`);
                                continue;
                            }
                        }
                        _.set(state.static, params[0], params[1]); 
                        break; 
                    }
                    case 'ADD': {
                        const [varName, valueToAdd] = params;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) { existing.push(valueToAdd); }
                        else { _.set(state.static, varName, (Number(existing) || 0) + Number(valueToAdd)); }
                        break;
                    }
                    case 'RESPONSE_SUMMARY': {
                        if (!Array.isArray(state.responseSummary)) { state.responseSummary = []; }
                        if (params[0] && !state.responseSummary.includes(params[0])) { state.responseSummary.push(params[0]); }
                        break;
                    }
                    case "TIME": {
                        if (state.time) { state.dtime = new Date(params[0]) - new Date(state.time); }
                        else { state.dtime = 0; }
                        state.time = params[0];
                        break;
                    }
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isRealTime, timepoint] = params;
                         // NEW: Type mutation check
                        if (state.disable_dtype_mutation) {
                            const oldValue = _.get(state.static, varName);
                            if (!isTypeMutationAllowed(oldValue, varValue)) {
                                logger.warn(`[SAM] Blocked scheduling of illegal type mutation for path "${varName}".`);
                                toastr.warning(`SAM: Blocked timed set due to illegal type mutation on "${varName}".`);
                                continue;
                            }
                        }
                        const targetTime = isRealTime ? new Date(timepoint).toISOString() : currentRound + Number(timepoint);
                        if (!state.volatile) state.volatile = [];
                        state.volatile.push([varName, varValue, isRealTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        const identifier = params[0];
                        const index = parseInt(identifier, 10);
                        if (!isNaN(index)) { state.volatile.splice(index, 1); }
                        else { state.volatile = state.volatile.filter(entry => entry[0] !== identifier && entry[4] !== identifier); }
                        break;
                    }
                    case 'DEL': {
                        const [listPath, index] = params;
                        const list = _.get(state.static, listPath);
                        if (Array.isArray(list) && index >= 0 && index < list.length) {
                            list[index] = undefined;
                            modifiedListPaths.add(listPath);
                        }
                        break;
                    }
                    case 'SELECT_DEL': {
                        const [listPath, identifier, targetId] = params;
                        _.update(state.static, listPath, list => _.reject(list, { [identifier]: targetId }));
                        break;
                    }
                    case 'SELECT_ADD': {
                        const [listPath, selProp, selVal, recProp, valToAdd] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            logger.warn(`[SAM] SELECT_ADD failed: Path "${listPath}" is not a list.`);
                            toastr.warning(`SAM SELECT_ADD: Path "${listPath}" is not a list.`);
                            break;
                        }
                        const targetIndex = _.findIndex(list, { [selProp]: selVal });
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            const existing = _.get(state.static, fullPath);
                            if (Array.isArray(existing)) {
                                existing.push(valToAdd);
                            } else {
                                const newValue = (Number(existing) || 0) + Number(valToAdd);
                                _.set(state.static, fullPath, newValue);
                            }
                        } else {
                            logger.warn(`[SAM] SELECT_ADD failed: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                            toastr.warning(`SAM SELECT_ADD: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'SELECT_SET': {
                        const [listPath, selProp, selVal, recProp, valToSet] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            logger.warn(`[SAM] SELECT_SET failed: Path "${listPath}" is not a list.`);
                            toastr.warning(`SAM SELECT_SET: Path "${listPath}" is not a list.`);
                            break;
                        }
                        const targetIndex = _.findIndex(list, (item) => _.get(item, selProp) === selVal);

                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                             // NEW: Type mutation check
                            if (state.disable_dtype_mutation) {
                                const oldValue = _.get(state.static, fullPath);
                                if (!isTypeMutationAllowed(oldValue, valToSet)) {
                                    logger.warn(`[SAM] Blocked illegal type mutation for path "${fullPath}".`);
                                    toastr.warning(`SAM: Blocked illegal type mutation on "${fullPath}".`);
                                    continue;
                                }
                            }
                            _.set(state.static, fullPath, valToSet);
                            
                        } else {
                            toastr.warning(`SAM SELECT_SET: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                            logger.warn(`[SAM] SELECT_SET failed to find object: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'EVENT_BEGIN': {
                        if (getActiveEvent(state)) {
                            logger.error(`EVENT_BEGIN failed: An event is already active. Use EVENT_END first.`);
                            break;
                        }
                        const [name, objective, ...initialProcs] = params;
                        if (!name || !objective) {
                            logger.error("EVENT_BEGIN failed: 'name' and 'objective' are required.");
                            break;
                        }
                        state.event_counter = (state.event_counter || 0) + 1;
                        const newEvent = {
                            name: name,
                            evID: state.event_counter,
                            start_time: state.time || new Date().toISOString(),
                            end_time: null,
                            objective: objective,
                            members: [],
                            procedural: initialProcs || [],
                            new_defines: [],
                            status: 0, // 0 = in-progress
                            summary: null
                        };
                        if (!state.events) state.events = [];
                        state.events.push(newEvent);
                        logger.info(`Started new event '${name}' (ID: ${newEvent.evID}).`);
                        break;
                    }
                    case 'EVENT_END': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) {
                            logger.warn("EVENT_END called but no active event was found.");
                            break;
                        }
                        const exitCode = params[0] ?? 1; // Default to 1 (success)
                        const summary = params[1] || null;

                        activeEvent.status = exitCode;
                        activeEvent.end_time = state.time || new Date().toISOString();
                        if (summary) {
                            activeEvent.summary = summary;
                        }
                        logger.info(`Event '${activeEvent.name}' (ID: ${activeEvent.evID}) ended with status ${exitCode}.`);
                        break;
                    }
                    case 'EVENT_ADD_PROC': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) { logger.warn("EVENT_ADD_PROC called but no active event was found."); break; }
                        params.forEach(proc => activeEvent.procedural.push(proc));
                        break;
                    }
                    case 'EVENT_ADD_DEFN': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) { logger.warn("EVENT_ADD_DEFN called but no active event was found."); break; }
                        if (params.length < 2) { logger.warn("EVENT_ADD_DEFN requires a name and a description."); break; }
                        activeEvent.new_defines.push({ name: params[0], desc: params[1] });
                        break;
                    }
                    case 'EVENT_ADD_MEMBER': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) { logger.warn("EVENT_ADD_MEMBER called but no active event was found."); break; }
                        params.forEach(member => {
                            if (!activeEvent.members.includes(member)) {
                                activeEvent.members.push(member);
                            }
                        });
                        break;
                    }
                    case 'EVENT_SUMMARY': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) { logger.warn("EVENT_SUMMARY called but no active event was found."); break; }
                        activeEvent.summary = params[0] || null;
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = params;
                        await runSandboxedFunction(funcName, funcParams, state);
                        break;
                    }
                }
            } catch (error) {
                logger.error(`Error processing command: ${JSON.stringify(command)}`, error);
            }
        }
        for (const path of modifiedListPaths) {
            _.update(state.static, path, list => _.filter(list, item => item !== undefined));
        }
        return state;
    }
    async function executeCommandPipeline(messageCommands, state) {
        const periodicCommands = state.func?.filter(f => f.periodic === true).map(f => ({ type: 'EVAL', params: `"${f.func_name}"` })) || [];
        const allPotentialCommands = [...messageCommands, ...periodicCommands];
        const priorityCommands = [], firstEvalItems = [], lastEvalItems = [], normalCommands = [];
        const funcDefMap = new Map(state.func?.map(f => [f.func_name, f]) || []);

        for (const command of allPotentialCommands) {
            if (command.type === "TIME") { priorityCommands.push(command); continue; }
            if (command.type === 'EVAL') {
                const funcName = (command.params.split(',')[0] || '').trim().replace(/"/g, '');
                const funcDef = funcDefMap.get(funcName);
                if (funcDef?.order === 'first') { firstEvalItems.push({ command, funcDef }); }
                else if (funcDef?.order === 'last') { lastEvalItems.push({ command, funcDef }); }
                else { normalCommands.push(command); }
            } else { normalCommands.push(command); }
        }

        const sortBySequence = (a, b) => (a.funcDef.sequence || 0) - (b.funcDef.sequence || 0);
        firstEvalItems.sort(sortBySequence); lastEvalItems.sort(sortBySequence);
        const firstCommands = firstEvalItems.map(item => item.command);
        const lastCommands = lastEvalItems.map(item => item.command);

        logger.info(`Executing ${priorityCommands.length} priority commands.`);
        await applyCommandsToState(priorityCommands, state);
        logger.info(`Executing ${firstCommands.length} 'first' order commands.`);
        await applyCommandsToState(firstCommands, state);
        logger.info(`Executing ${normalCommands.length} normal order commands.`);
        await applyCommandsToState(normalCommands, state);
        logger.info(`Executing ${lastCommands.length} 'last' order commands.`);
        await applyCommandsToState(lastCommands, state);
        return state;
    }

    // 🔧 分片 JSON.stringify，避免阻塞主线程
    async function chunkedStringify(obj) {
        return new Promise((resolve) => {
            // 🔧 使用动态延迟，自动适配设备性能
            setTimeout(() => {
                try {
                    const result = JSON.stringify(obj, null, 2);
                    resolve(result);
                } catch (error) {
                    logger.error('JSON stringify failed:', error);
                    resolve('{}'); // 失败时返回空对象
                }
            }, DELAY_MS);
        });
    }

    async function processMessageState(index) {
        logger.info(`processing message state at ${index}`);
        if (isProcessingState) { logger.warn("Aborting processMessageState: Already processing."); return; }
        isProcessingState = true;
        try {
            if (index === "{{lastMessageId}}") { index = SillyTavern.chat.length - 1; }
            
            var state = (await getVariables()).SAM_data;

            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) return;

            // 🔧 手机端优化：更频繁的主线程释放
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

            const promotedCommands = await processVolatileUpdates(state);
            
            // 🔧 释放主线程
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            const messageContent = lastAIMessage.mes;
            
            // 🔧 释放主线程后再进行正则匹配
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            COMMAND_START_REGEX.lastIndex = 0;
            let match;
            const newCommands = [];
            
            // 🔧 手机端优化：分批处理正则匹配，避免长文本卡死
            let matchCount = 0;
            
            // V3.6.1: New Parsing Loop for Multiline Support
            while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
                const commandType = match[1].toUpperCase();
                // match[0] contains "@.CMD("
                // The parameters start immediately after match[0]
                const openParenIndex = match.index + match[0].length;
                
                // Use the parser to find the balancing closing paren
                const extraction = extractBalancedParams(messageContent, openParenIndex);
                
                if (extraction) {
                    newCommands.push({ type: commandType, params: extraction.params.trim() });
                    
                    // Manually advance the regex index to the end of this command block
                    // to prevent spurious matches inside string arguments.
                    COMMAND_START_REGEX.lastIndex = extraction.endIndex;
                } else {
                    logger.warn(`[SAM] Malformed command or unbalanced parentheses for ${commandType} at index ${match.index}. Skipping.`);
                }

                matchCount++;
                // 🔧 根据设备类型动态调整释放频率
                if (matchCount % REGEX_MATCH_INTERVAL === 0) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                }
            }
            
            const allMessageCommands = [...promotedCommands, ...newCommands];
            logger.info(`---- Found ${allMessageCommands.length} command(s) to process (incl. volatile) ----`);
            
            // 🔧 释放主线程
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            // 🔧 分批执行命令，每批后释放主线程
            const newState = await executeCommandPipeline(allMessageCommands, state);
            
            // 🔧 释放主线程后再深拷贝
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            // 🔧 异步更新变量，避免阻塞
            await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newState)); return variables });
            
            // 🔧 释放主线程
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            
            // 🔧 分片序列化大对象，避免阻塞主线程
            const newStateBlock = await chunkedStringify(newState);
            
            // 🔧 释放主线程
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            
            await setChatMessage({ message: finalContent }, index, "display_current");
        } catch (error) {
            logger.error(`Error in processMessageState for index ${index}:`, error);
        } finally {
            logger.info("update finished");
            isProcessingState = false; // 🔧 确保总是释放锁
        }
    }

    async function loadStateFromMessage(index) {
        if (index === "{{lastMessageId}}") { index = SillyTavern.chat.length - 1; }

        var state;
        try {
            const message = SillyTavern.chat[index];
            if (!message) return;
            state = parseStateFromMessage(message.mes);
            if (state) {
                logger.info(`replacing variables with found state at index ${index}`);
            } else {
                logger.info("did not find valid state at index, replacing with latest state");
                state = await findLatestState(SillyTavern.chat, index);
            }
        } catch (e) {
            logger.error(`Load state from message failed for index ${index}:`, e);
        }

        try {
            if (index === 0) { 
                logger.info("[SAM] First AI response detected. Checking for __SAM_base_data__ in World Info.");
                const baseData = await getBaseDataFromWI();
                if (baseData) {
                   logger.info("[SAM] Base data found. Merging it into the current state (current state takes precedence).");
                   // Deep merge: current state's values overwrite baseData's
                   state = _.merge({}, baseData, state); 
                } else {
                   logger.info("[SAM] No valid base data found. Proceeding with initial state.");
                }
            }
        } catch (error) {
            logger.error(`[SAM] Error loading base data for index ${index}:`, error);
        }

        await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(state)); return variables });
    }
    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user === false) return i;
        }
        return -1;
    }
    async function sync_latest_state() {
        var lastlastAIMessageIdx = await findLastAiMessageAndIndex();
        await loadStateFromMessage(lastlastAIMessageIdx);
    }
    async function checkStuckState() {
        const lastMessage = SillyTavern.chat[SillyTavern.chat.length - 1];
        if (!lastMessage || lastMessage.is_user) return; // Not an AI message, nothing to check
        const match = lastMessage.mes.match(STATE_BLOCK_PARSE_REGEX);
        if (!match) {
            const warningMsg = "Stuck State Detected: The last AI message is missing its state block. The next turn will use the previous state. This may cause inconsistencies. Consider using the 'Reset State' or 'Rerun Commands' debug buttons if issues persist.";
            logger.error(`STUCK STATE DETECTED! Message at index ${SillyTavern.chat.length - 1} did not contain a state block after processing. please RESET the current state and MANUALLY update the variables.`);
            toastr.error(warningMsg);
        }
    }
    async function dispatcher(event, ...event_params) {
        logger.info(`[FSM Dispatcher] Event: ${event}, State: ${curr_state}`);
        
        // 🔧 首次运行时输出设备信息
        if (!dispatcher.deviceLogged) {
            logger.info(`[SAM] Device Type: ${isMobileDevice ? 'Mobile' : 'Desktop'}`);
            logger.info(`[SAM] Performance Settings - Delay: ${DELAY_MS}ms, Batch: ${COMMAND_BATCH_SIZE}, RegEx Interval: ${REGEX_MATCH_INTERVAL}`);
            dispatcher.deviceLogged = true;
        }
        
        try {
            switch (curr_state) {
                case STATES.IDLE:
                    switch (event) {
                        case tavern_events.GENERATION_STARTED:
                            if (event_params[2]) { logger.info("[IDLE] Dry run detected, ignoring."); return; }
                            if (event_params[0] === "swipe" || event_params[0] === "regenerate") {
                                logger.info(`[IDLE] ${event_params[0]} detected. Loading from before latest user msg.`);
                                await loadStateFromMessage(findLatestUserMsgIndex());
                            }
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case tavern_events.MESSAGE_SENT:
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher(); // 🔧 添加 watcher 启动
                            break;
                        case tavern_events.MESSAGE_SWIPED:
                            await sync_latest_state();
                            break;
                        default:
                            await sync_latest_state();
                            break;
                    }
                    break;
                case STATES.AWAIT_GENERATION:
                    switch (event) {
                        case tavern_events.GENERATION_STOPPED:
                        case FORCE_PROCESS_COMPLETION:
                        case tavern_events.GENERATION_ENDED:
                            stopGenerationWatcher();
                            curr_state = STATES.PROCESSING;
                            logger.info("[AWAIT] Processing latest message.");
                            const index = SillyTavern.chat.length - 1;
                            await processMessageState(index);
                            await checkStuckState();
                            logger.info('[AWAIT] Processing complete. Transitioning to IDLE.');
                            curr_state = STATES.IDLE;
                            break;
                        case tavern_events.CHAT_CHANGED:
                            stopGenerationWatcher();
                            logger.info('[AWAIT] Chat changed during generation. Aborting and returning to IDLE.');
                            await sync_latest_state();
                            curr_state = STATES.IDLE;
                            break;
                    }
                    break;
                case STATES.PROCESSING:
                    logger.warn(`[PROCESSING] Received event ${event} while processing. Ignoring.`);
                    break;
            }
        } catch (e) {
            stopGenerationWatcher();
            logger.error(`[Dispatcher] FSM Scheduling failed. Error: ${e}`);
            curr_state = STATES.IDLE; // Failsafe
        }
    }
    async function unifiedEventHandler(event, ...args) {
        // 🔧 队列保护：防止无限增长
        if (event_queue.length > 100) {
            logger.error(`[UEH] Event queue overflow! Current size: ${event_queue.length}. Clearing old events.`);
            event_queue.splice(0, 50); // 清除前50个事件
        }
        
        event_queue.push({ event_id: event, args: [...args] });
        await unified_dispatch_executor();
    }
    async function unified_dispatch_executor() {
        if (isDispatching) { return; }
        isDispatching = true;
        
        // 🔧 防止无限循环：限制单次处理事件数量
        const MAX_EVENTS_PER_BATCH = 20;
        let processedCount = 0;
        
        while (event_queue.length > 0 && processedCount < MAX_EVENTS_PER_BATCH) {
            const { event_id, args } = event_queue.shift();
            logger.info(`[UDE] Dequeuing and dispatching event: ${event_id}`);
            try { 
                await dispatcher(event_id, ...args); 
                processedCount++;
            }
            catch (error) {
                logger.error(`[UDE] Unhandled error during dispatch of ${event_id}:`, error);
                curr_state = STATES.IDLE;
            }
        }
        
        isDispatching = false;
        
        // 🔧 如果还有事件，异步继续处理（避免阻塞主线程）
        if (event_queue.length > 0) {
            logger.warn(`[UDE] Event queue still has ${event_queue.length} events. Scheduling next batch...`);
            setTimeout(() => unified_dispatch_executor(), 10);
        }
    }

    const handlers = {
		handleGenerationStarted: async (ev, options, dry_run) => {
			await unifiedEventHandler(
				tavern_events.GENERATION_STARTED,
				ev,
				options,
				dry_run,
			);
		},
		handleGenerationEnded: async () => {
			await unifiedEventHandler(tavern_events.GENERATION_ENDED);
		},
		handleMessageSwiped: () => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.MESSAGE_SWIPED);
			}, 0);
		},
		handleMessageDeleted: (message) => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.MESSAGE_DELETED, message);
			}, 0);
		},
		handleMessageEdited: () => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.MESSAGE_EDITED);
			}, 0);
		},
		handleChatChanged: () => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.CHAT_CHANGED);
			}, 10);
		},
		handleMessageSent: () => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.MESSAGE_SENT);
			}, 0);
		},
		handleGenerationStopped: () => {
			setTimeout(async () => {
				await unifiedEventHandler(tavern_events.GENERATION_STOPPED);
			}, 0);
		},
	};

    function resetCurrentState() {
        logger.warn("!!! MANUAL STATE RESET TRIGGERED !!!");
        stopGenerationWatcher();
        curr_state = STATES.IDLE;
        isDispatching = false; // Forcefully unlock the dispatcher
        event_queue.length = 0; // Clear any pending events that might be causing a loop
        logger.info("FSM forced to IDLE. Event queue cleared. Attempting to re-sync with the latest valid state.");
        sync_latest_state().then(() => {
            toastr.success("SAM state has been reset and re-synced.");
            logger.info("Re-sync successful.");
        }).catch(err => {
            toastr.error("SAM state reset, but re-sync failed. Check console.");
            logger.error("Re-sync failed after manual reset.", err);
        });
    }

    async function rerunLatestCommands() {
        logger.info("--- MANUAL RERUN TRIGGERED ---");
        if (curr_state !== STATES.IDLE) {
            const msg = "Cannot rerun commands now. The script is busy. Please wait for it to be idle or use the Reset button first.";
            logger.warn(msg);
            toastr.error(msg);
            return;
        }

        const lastAiIndex = await findLastAiMessageAndIndex();
        if (lastAiIndex === -1) {
            toastr.info("No AI message found to rerun.");
            return;
        }

        isProcessingState = true; // Lock to prevent race conditions
        try {
            toastr.info(`Rerunning commands from message at index ${lastAiIndex}...`);
            const previousAiIndex = await findLastAiMessageAndIndex(lastAiIndex);
            const initialState = await findLatestState(SillyTavern.chat, previousAiIndex);
            logger.info(`Rerun initial state loaded from index ${previousAiIndex}.`);

            const messageToRerun = SillyTavern.chat[lastAiIndex];
            const messageContent = messageToRerun.mes;
            
            // V3.6.1: Updated Manual Rerun to use new parser
            COMMAND_START_REGEX.lastIndex = 0;
            let match;
            const newCommands = [];
            while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
                const commandType = match[1].toUpperCase();
                const openParenIndex = match.index + match[0].length;
                const extraction = extractBalancedParams(messageContent, openParenIndex);
                
                if (extraction) {
                    newCommands.push({ type: commandType, params: extraction.params.trim() });
                    COMMAND_START_REGEX.lastIndex = extraction.endIndex;
                }
            }

            logger.info(`Found ${newCommands.length} command(s) in message ${lastAiIndex} to rerun.`);
            const newState = await executeCommandPipeline(newCommands, initialState);
            await updateVariablesWith(variables => {
                _.set(variables, "SAM_data", goodCopy(newState));
                return variables;
            });
            logger.info("Live variables updated with rerun state.");
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
            const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;
            setChatMessages([{'message_id':lastAiIndex, 'message':finalContent}]);
            logger.info(`Message at index ${lastAiIndex} permanently updated in chat history.`);
            toastr.success("Rerun complete. State saved.");
        } catch (error) {
            logger.error("Manual rerun failed.", error);
            toastr.error("Rerun failed. Check console for errors.");
        } finally {
            isProcessingState = false; // Release the lock
        }
    }

    function displayLogs() {
        logger.info("--- LOG DISPLAY TRIGGERED ---");
        if (executionLog.length === 0) {
            toastr.info("Execution log is empty.");
            return;
        }
        const logText = executionLog.map(entry => `[${entry.timestamp}] [${entry.level}] ${entry.message}`).join('\n');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SAM_Execution_Log_${new Date().toISOString()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastr.success("Log file download initiated.");
    }

    $(() => {
        cleanupPreviousInstance();
        const initializeOrReloadStateForCurrentChat = async () => {
            logger.info("Initializing or reloading state for current chat.");
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) {
                logger.info("No AI messages found. Initializing with default state.");
                await updateVariablesWith(variables => { _.set(variables, "SAM_data", _.cloneDeep(INITIAL_STATE)); return variables });
            } else {
                await loadStateFromMessage(lastAiIndex);
            }
            logger.info("Initialization finalized");
        };

        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);
        window[HANDLER_STORAGE_KEY] = handlers;

        try {
            const resetEvent = getButtonEvent("重置内部状态（慎用）");
            const rerunLatestCommandsEvent = getButtonEvent("再次执行（慎用）");
            const displayLogEvent = getButtonEvent("执行日志");
            if (resetEvent) eventOn(resetEvent, resetCurrentState);
            if (rerunLatestCommandsEvent) eventOn(rerunLatestCommandsEvent, rerunLatestCommands);
            if (displayLogEvent) eventOn(displayLogEvent, displayLogs);
        } catch (e) {
            logger.warn("Could not find debug buttons. This is normal if they are not defined in the UI.", e);
        }

        try{
            const checkGenerationStatusEvent = getButtonEvent("确认运行")
            if (checkGenerationStatusEvent) eventOn(
                () => {
                    alert(`Stuck state resolver visibility (is-generating) status == ${$('#mes_stop').is(':visible')}`);
                }
            );
        }catch(e){}

        try {
            logger.info(`V3.7.0 "Antifragile" loaded. GLHF, player.`);
            initializeOrReloadStateForCurrentChat();
            session_id = JSON.stringify(new Date());
            sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);
            logger.info(`Assigned new session ID: ${session_id}`);
        } catch (error) {
            logger.error("Error during final initialization:", error);
        }
    });

})()
