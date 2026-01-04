// ============================================================================
// == Situational Awareness Manager (CORE ENGINE)
// == Version: 4.2.0 "Quark+"
// ==
// == This script provides a robust state management system for SillyTavern.
// == It acts as the core engine, processing state-mutating commands from AI
// == messages and managing the checkpointing system.
// ==
// == This version is designed to work with a separate SAM UI extension.
// == UI-driven features like response summarization and event management are
// == now handled by the companion extension, which communicates with this
// == core engine via a secure event protocol.
// ==
// == [ARCH in 4.1.0] Core/UI Separation:
// ==   - This script is now the "Core Engine," handling only AI commands and state persistence.
// ==   - Removed RESPONSE_SUMMARY and EVENT_* commands. These are now managed by the UI extension.
// ==   - Added a robust event-based API for the UI extension to query status and commit state changes.
// ==
// == [UPDATE in 4.1.0] External Function Library:
// ==   - Functions are now loaded dynamically from a World Info entry named
// ==     "__SAM_IDENTIFIER__".
// ==
// == [UPDATE in 4.2.0] Inclusive Commands:
// ==   - Added @.INCSET and @.INCADD commands. These commands function like their
// ==     SELECT_* counterparts but will create the target object if it doesn't exist,
// ==     preventing command failure on non-existent entries.
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
  - command: INCSET
    description: "Inclusive Set." Finds a specific object in a list and sets its property. If the object is not found, it creates a new object with the specified properties and adds it to the list.
    syntax: '@.INCSET("path.to.list", "selector_key", "selector_value", "receiver_key", new_value);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for or create in an object.
      - name: selector_value
        type: any
        description: The value to match or create to identify the correct object.
      - name: receiver_key
        type: string
        description: The property name on the found/created object to update.
      - name: new_value
        type: any
        description: The new value to set.
  - command: INCADD
    description: "Inclusive Add." Finds a specific object in a list and adds to its property. If the object is not found, it creates a new object. The new object's receiver property is initialized with the `value_to_add`.
    syntax: '@.INCADD("path.to.list", "selector_key", "selector_value", "receiver_key", value_to_add);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for or create in an object.
      - name: selector_value
        type: any
        description: The value to match or create to identify the correct object.
      - name: receiver_key
        type: string
        description: The property on the found/created object to add to.
      - name: value_to_add
        type: any
        description: The value to add, append, or initialize with.
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
  - command: SUMMARY
    description: Adds a new Level 1 (L1) summary to the response summary list.
    syntax: '@.SUMMARY("summary_content");'
    parameters:
      - name: summary_content
        type: string
        description: The text content of the summary to be added.
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
    const SCRIPT_NAME = "Situational Awareness Manager (Core)";
    const SCRIPT_VERSION = "4.2.0 'Quark+'";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    // Checkpointing configuration
    const CHECKPOINT_FREQUENCY = 20;
    const ENABLE_AUTO_CHECKPOINT = true;

    // State block formats
    const OLD_START_MARKER = '<!--<|state|>';
    const OLD_END_MARKER = '</|state|>-->';
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_START_MARKER = NEW_START_MARKER;
    const STATE_BLOCK_END_MARKER = NEW_END_MARKER;
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*([\\s\\S]*?)\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*[\\s\\S]*?\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 'sg');

    // MODIFIED: Regex updated to include INCADD and INCSET commands.
    const COMMAND_START_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|CANCEL_SET|EVAL|SUMMARY|INCSET|INCADD)\b\s*\(/gim;

    // IMPORTANT: INITIAL_STATE still contains `events` and `responseSummary` to preserve data integrity,
    // but the commands to modify them from the AI have been removed. The UI extension will manage them.
    const INITIAL_STATE = { static: {}, time: "", volatile: [], responseSummary: { L1: [], L2: [], L3: [] }, func: [], events: [], event_counter: 0, uniquely_identified: false, disable_dtype_mutation: false };
    
    // Performance tuning
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const DELAY_MS = isMobileDevice ? 10 : 5;
    const COMMAND_BATCH_SIZE = isMobileDevice ? 3 : 5;

    // --- STATE & LIFECYCLE MANAGEMENT ---
    let isProcessingState = false;
    let isDispatching = false;
    let isCheckpointing = false;
    let prevState = null;
    const event_queue = [];
    const executionLog = [];
    let generationWatcherId = null;

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };
    var curr_state = STATES.IDLE;
    var this_uid_name = 0;
    const WATCHER_INTERVAL_MS = 3000;
    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";
    const HANDLER_STORAGE_KEY = `__SAM_V4_CORE_EVENT_HANDLER_STORAGE__`;
    

    const logger = {
        info: (...args) => console.log(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args),
    };

    // --- NEW: Event Protocol for Communication with UI Extension ---
    const SAM_EVENTS = {
        CORE_UPDATED: 'SAM_CORE_UPDATED',            // Emitted by Core when state is updated
        EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',        // Emitted by Extension to ask for status
        CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE', // Emitted by Core in response to status ask
        EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',       // Emitted by Extension to save a full state object
        CORE_IDLE: 'SAM_CORE_IDLE', // Emitted by core in response to an ask
        INV:'SAM_INV' // data invalid. must re-fetch data.
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
        eventRemoveListener(SAM_EVENTS.EXT_ASK_STATUS, oldHandlers.handleAskStatus);
        eventRemoveListener(SAM_EVENTS.EXT_COMMIT_STATE, oldHandlers.handleCommitState);
        delete window[HANDLER_STORAGE_KEY];
    };

    // --- HELPER FUNCTIONS ---
    async function loadExternalLibrary(url, globalName) {
        if (window[globalName]) return;
        logger.info(`Downloading external library: ${globalName}...`);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => { logger.info(`Library ${globalName} loaded successfully.`); resolve(); };
            script.onerror = () => { const err = new Error(`Failed to load script: ${url}`); logger.error(err); reject(err); };
            document.head.appendChild(script);
        });
    }

    function extractBalancedParams(text, startIndex) {
        let depth = 1; let inString = false; let quoteChar = ''; let i = startIndex; const len = text.length;
        while (i < len && depth > 0) {
            const c = text[i];
            if (inString) {
                if (c === quoteChar) { let backslashCount = 0; let j = i - 1;
                    while (j >= startIndex && text[j] === '\\') { backslashCount++; j--; }
                    if (backslashCount % 2 === 0) { inString = false; }
                }
            } else { if (c === '"' || c === "'" || c === '`') { inString = true; quoteChar = c; } else if (c === '(') { depth++; } else if (c === ')') { depth--; } }
            i++;
        }
        if (depth === 0) { return { params: text.substring(startIndex, i - 1), endIndex: i }; }
        return null;
    }

    function extractCommandsFromText(messageContent) {
        COMMAND_START_REGEX.lastIndex = 0; let match; const commands = [];
        while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
            const commandType = match[1].toUpperCase();
            const openParenIndex = match.index + match[0].length;
            const extraction = extractBalancedParams(messageContent, openParenIndex);
            if (extraction) {
                commands.push({ type: commandType, params: extraction.params.trim() });
                COMMAND_START_REGEX.lastIndex = extraction.endIndex;
            } else { logger.warn(`Malformed command or unbalanced parentheses for ${commandType} at index ${match.index}. Skipping.`); }
        }
        return commands;
    }

    function stopGenerationWatcher() { if (generationWatcherId) { clearInterval(generationWatcherId); generationWatcherId = null; } }
    
    function startGenerationWatcher() {
        stopGenerationWatcher();
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
                logger.warn('[SAM Watcher] DETECTED DESYNC! Forcing state transition.');
                stopGenerationWatcher(); unifiedEventHandler(FORCE_PROCESS_COMPLETION);
            } else if (curr_state !== STATES.AWAIT_GENERATION) { stopGenerationWatcher(); }
        }, WATCHER_INTERVAL_MS);
    }

    async function getRoundCounter() { return SillyTavern.chat.length - 1; }

    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try { return JSON.parse(match[1].trim()); }
            catch (error) { logger.error("Failed to parse state JSON from message.", error); return null; }
        }
        return null;
    }
    
    async function findLatestState(chatHistory, targetIndex = chatHistory.length - 1) {
        let baseState = _.cloneDeep(INITIAL_STATE); let checkpointIndex = -1;
        for (let i = targetIndex; i >= 0; i--) {
            const message = chatHistory[i]; if (!message || message.is_user) continue;
            const stateFromBlock = parseStateFromMessage(message.mes);
            if (stateFromBlock) { baseState = stateFromBlock; checkpointIndex = i; break; }
        }
        if (checkpointIndex === -1 && targetIndex >= 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) { baseState = _.merge({}, baseState, baseData); }
        }
        const commandsToApply = [];
        const startIndex = checkpointIndex === -1 ? 0 : checkpointIndex + 1;
        for (let i = startIndex; i <= targetIndex; i++) {
            const message = chatHistory[i]; if (!message || message.is_user) continue;
            commandsToApply.push(...extractCommandsFromText(message.mes));
        }
        return await applyCommandsToState(commandsToApply, baseState);
    }

    function findLatestUserMsgIndex() { for (let i = SillyTavern.chat.length - 1; i >= 0; i--) { if (SillyTavern.chat[i].is_user) { return i; } } return -1; }
    
    function goodCopy(state) { if (!state) return _.cloneDeep(INITIAL_STATE); try { return JSON.parse(JSON.stringify(state)); } catch (e) { return _.cloneDeep(state); } }
    
    async function getBaseDataFromWI() {
        const WI_ENTRY_NAME = "__SAM_base_data__";
        try {
            const worldbookNames = await getCharWorldbookNames("current");
            if (!worldbookNames || !worldbookNames.primary) return null;
            const wi = await getWorldbook(worldbookNames.primary);
            if (!wi || !Array.isArray(wi)) return null;
            const baseDataEntry = wi.find(entry => entry.name === WI_ENTRY_NAME);
            if (!baseDataEntry || !baseDataEntry.content) return null;
            return JSON.parse(baseDataEntry.content);
        } catch (error) {
            logger.error(`Base data check: An unexpected error occurred.`, error);
            return null;
        }
    }

    // get user-defined functions from WI
    async function getFuncs(){
        // idea: Go into the character book and read every entry's content
        // we're using the identifier to store the functionlib.
        const sam_functionlib_id = "__SAM_IDENTIFIER__";
        try {
            const worldbookNames = await getCharWorldbookNames("current");
            if (!worldbookNames || !worldbookNames.primary) return null;
            const wi = await getWorldbook(worldbookNames.primary);
            if (!wi || !Array.isArray(wi)) return null;
            const baseDataEntry = wi.find(entry => entry.name === sam_functionlib_id);
            if (!baseDataEntry || !baseDataEntry.content) return null;
            return JSON.parse(baseDataEntry.content);
        } catch (error) {
            logger.error(`function check: An unexpected error occurred.`, error);
            return null;
        }
    }

    async function runSandboxedFunction(funcName, params, state) {
        // [UPDATE] Try to load functions from WI first
        let loadedFuncs = await getFuncs();
        // Fallback to state-embedded functions if WI is missing, for legacy support
        if (!loadedFuncs || !Array.isArray(loadedFuncs)) loadedFuncs = state.func || [];

        const funcDef = loadedFuncs.find(f => f.func_name === funcName);
        if (!funcDef) { logger.warn(`EVAL: Function '${funcName}' not found in WI or state.`); return; }
        
        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const rawParamNames = funcDef.func_params || [];
        let formalParamNames = []; let restParamName = null;
        for (const param of rawParamNames) { if (param.startsWith('...')) { restParamName = param.substring(3); } else { formalParamNames.push(param); } }
        let bodyPrologue = '';
        if (restParamName) { const startIndex = formalParamNames.length; bodyPrologue = `const ${restParamName} = Array.from(arguments).slice(${4 + startIndex});\n`; }
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
        const timeoutPromise = new Promise((_, reject) => { setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout); });
        try { await Promise.race([executionPromise, timeoutPromise]); } catch (error) { logger.error(`EVAL: Error executing function '${funcName}'.`, error); }
    }

    async function chunkedStringify(obj) { return new Promise((resolve) => { setTimeout(() => { resolve(JSON.stringify(obj, null, 2)); }, DELAY_MS); }); }

    // --- CORE LOGIC ---
    async function processVolatileUpdates(state) {
        if (!state.volatile || !state.volatile.length) return [];
        const promotedCommands = []; const remainingVolatiles = []; const currentRound = await getRoundCounter(); const currentTime = state.time ? new Date(state.time) : new Date();
        for (const volatile of state.volatile) {
            const [varName, varValue, isRealTime, targetTime] = volatile;
            let triggered = isRealTime ? (currentTime >= new Date(targetTime)) : (currentRound >= targetTime);
            if (triggered) { promotedCommands.push({ type: 'SET', params: `${JSON.stringify(varName)}, ${JSON.stringify(varValue)}` }); }
            else { remainingVolatiles.push(volatile); }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }

    function buildPathMap(obj, currentPath = '', pathMap = new Map(), collisionSet = new Set()) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
        for (const key of Object.keys(obj)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            if (pathMap.has(key)) { collisionSet.add(key); } else { pathMap.set(key, newPath); }
            buildPathMap(obj[key], newPath, pathMap, collisionSet);
        }
        return { pathMap, collisionSet };
    }

    function isTypeMutationAllowed(oldValue, newValue) {
        if (oldValue === null || typeof oldValue === 'undefined') return true;
        const oldType = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        const newType = Array.isArray(newValue) ? 'array' : typeof newValue;
        return oldType === newType;
    }

    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;
        const currentRound = await getRoundCounter(); let modifiedListPaths = new Set(); let pathMap = null;
        if (state.uniquely_identified) {
            const { pathMap: generatedMap, collisionSet } = buildPathMap(state.static);
            for (const key of collisionSet) { generatedMap.delete(key); }
            pathMap = generatedMap;
        }
        const resolvePath = (path) => pathMap?.get(path) ?? path;

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            if (i > 0 && i % COMMAND_BATCH_SIZE === 0) { await new Promise(resolve => setTimeout(resolve, DELAY_MS)); }
            let params;
            try { params = command.params ? JSON.parse(`[${command.params.trim()}]`) : []; }
            catch (error) {
                logger.warn(`JSON parse failed for ${command.type}. Attempting repair...`);
                try {
                    if (typeof window.jsonrepair !== 'function') { await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair'); }
                    params = JSON.parse(window.jsonrepair(`[${command.params.trim()}]`));
                } catch (repairError) { logger.error(`Fatal: Failed to repair JSON for ${command.type}. Skipping.`, repairError); continue; }
            }

            try {
                const pathCommands = ['SET', 'ADD', 'DEL', 'SELECT_DEL', 'SELECT_ADD', 'SELECT_SET', 'TIMED_SET', 'INCSET', 'INCADD'];
                if (pathCommands.includes(command.type) && params.length > 0 && typeof params[0] === 'string') {
                    params[0] = resolvePath(params[0]);
                }
                
                switch (command.type) {
                    case 'SET': { if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, params[0]), params[1])) { logger.warn(`Blocked illegal type mutation for path "${params[0]}".`); continue; } _.set(state.static, params[0], params[1]); break; }
                    case 'ADD': { const [varName, valueToAdd] = params; const existing = _.get(state.static, varName, 0); if (Array.isArray(existing)) { existing.push(valueToAdd); } else { _.set(state.static, varName, (Number(existing) || 0) + Number(valueToAdd)); } break; }
                    case "TIME": { if (state.time) { state.dtime = new Date(params[0]) - new Date(state.time); } else { state.dtime = 0; } state.time = params[0]; break; }
                    case 'TIMED_SET': { const [varName, varValue, reason, isRealTime, timepoint] = params; if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, varName), varValue)) { logger.warn(`Blocked scheduling of illegal type mutation for path "${varName}".`); continue; } const targetTime = isRealTime ? new Date(timepoint).toISOString() : currentRound + Number(timepoint); if (!state.volatile) state.volatile = []; state.volatile.push([varName, varValue, isRealTime, targetTime, reason]); break; }
                    case 'CANCEL_SET': { const identifier = params[0]; const index = parseInt(identifier, 10); if (!isNaN(index)) { if (state.volatile && index >= 0 && index < state.volatile.length) { state.volatile.splice(index, 1); } } else { state.volatile = state.volatile.filter(entry => entry[4] !== identifier); } break; }
                    case 'DEL': { const [listPath, index] = params; const list = _.get(state.static, listPath); if (Array.isArray(list) && index >= 0 && index < list.length) { list[index] = undefined; modifiedListPaths.add(listPath); } break; }
                    case 'SELECT_DEL': { const [listPath, identifier, targetId] = params; _.update(state.static, listPath, list => _.reject(list, { [identifier]: targetId })); break; }
                    case 'SELECT_ADD': { const [listPath, selProp, selVal, recProp, valToAdd] = params; const list = _.get(state.static, listPath); if (!Array.isArray(list)) break; const targetIndex = _.findIndex(list, { [selProp]: selVal }); if (targetIndex > -1) { const fullPath = `${listPath}[${targetIndex}].${recProp}`; const existing = _.get(state.static, fullPath); if (Array.isArray(existing)) { existing.push(valToAdd); } else { _.set(state.static, fullPath, (Number(existing) || 0) + Number(valToAdd)); } } break; }
                    case 'SELECT_SET': { const [listPath, selProp, selVal, recProp, valToSet] = params; const list = _.get(state.static, listPath); if (!Array.isArray(list)) break; const targetIndex = _.findIndex(list, (item) => _.get(item, selProp) === selVal); if (targetIndex > -1) { const fullPath = `${listPath}[${targetIndex}].${recProp}`; if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, fullPath), valToSet)) { logger.warn(`Blocked illegal type mutation for path "${fullPath}".`); continue; } _.set(state.static, fullPath, valToSet); } break; }
                    case 'INCSET': {
                        const [listPath, selProp, selVal, recProp, valToSet] = params;
                        let list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) { _.set(state.static, listPath, []); list = _.get(state.static, listPath); }
                        const targetIndex = _.findIndex(list, (item) => _.get(item, selProp) === selVal);
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, fullPath), valToSet)) { logger.warn(`Blocked illegal type mutation for path "${fullPath}".`); continue; }
                            _.set(state.static, fullPath, valToSet);
                        } else {
                            const newObj = { [selProp]: selVal };
                            _.set(newObj, recProp, valToSet);
                            list.push(newObj);
                        }
                        break;
                    }
                    case 'INCADD': {
                        const [listPath, selProp, selVal, recProp, valToAdd] = params;
                        let list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) { _.set(state.static, listPath, []); list = _.get(state.static, listPath); }
                        const targetIndex = _.findIndex(list, { [selProp]: selVal });
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            const existing = _.get(state.static, fullPath);
                            if (Array.isArray(existing)) {
                                existing.push(valToAdd);
                            } else {
                                _.set(state.static, fullPath, (Number(existing) || 0) + Number(valToAdd));
                            }
                        } else {
                            const newObj = { [selProp]: selVal, [recProp]: valToAdd };
                            list.push(newObj);
                        }
                        break;
                    }
                    case 'SUMMARY': {
                        const [content] = params;
                        if (typeof state.responseSummary !== 'object' || state.responseSummary === null) {
                            state.responseSummary = { L1: [], L2: [], L3: [] };
                        }
                        if (!Array.isArray(state.responseSummary.L1)) {
                            state.responseSummary.L1 = [];
                        }
                        state.responseSummary.L1.push(content);
                        break;
                    }
                    case 'EVAL': { const [funcName, ...funcParams] = params; await runSandboxedFunction(funcName, funcParams, state); break; }
                }
            } catch (error) { logger.error(`Error processing command: ${JSON.stringify(command)}`, error); }
        }
        for (const path of modifiedListPaths) { _.update(state.static, path, list => _.filter(list, item => item !== undefined)); }
        return state;
    }

    async function executeCommandPipeline(messageCommands, state) {
        // [UPDATE] Load functions from WI to handle periodic/ordered execution
        let loadedFuncs = await getFuncs();
        if (!loadedFuncs || !Array.isArray(loadedFuncs)) loadedFuncs = state.func || [];
        
        const promotedVolatileCommands = await processVolatileUpdates(state);
        const allCommands = [...messageCommands, ...promotedVolatileCommands];
        
        // Use loadedFuncs (from WI) to find periodic functions
        const periodicCommands = loadedFuncs.filter(f => f.periodic === true).map(f => ({ type: 'EVAL', params: `"${f.func_name}"` })) || [];
        const allPotentialCommands = [...allCommands, ...periodicCommands];
        
        const priorityCommands = [], firstEvalItems = [], lastEvalItems = [], normalCommands = [];
        
        // Map loadedFuncs (from WI) for lookup
        const funcDefMap = new Map(loadedFuncs.map(f => [f.func_name, f]) || []);
        
        for (const command of allPotentialCommands) {
            if (command.type === "TIME") { priorityCommands.push(command); continue; }
            if (command.type === 'EVAL') {
                const funcName = (command.params.split(',')[0] || '').trim().replace(/"/g, ''); const funcDef = funcDefMap.get(funcName);
                if (funcDef?.order === 'first') { firstEvalItems.push({ command, funcDef }); } else if (funcDef?.order === 'last') { lastEvalItems.push({ command, funcDef }); } else { normalCommands.push(command); }
            } else { normalCommands.push(command); }
        }
        const sortBySequence = (a, b) => (a.funcDef.sequence || 0) - (b.funcDef.sequence || 0);
        firstEvalItems.sort(sortBySequence); lastEvalItems.sort(sortBySequence);
        await applyCommandsToState(priorityCommands, state);
        await applyCommandsToState(firstEvalItems.map(item => item.command), state);
        await applyCommandsToState(normalCommands, state);
        await applyCommandsToState(lastEvalItems.map(item => item.command), state);
        return state;
    }

    async function processMessageState(index) {
        if (isProcessingState) { logger.warn("Aborting processMessageState: Already processing."); return; }
        isProcessingState = true;
        try {
            if (index === "{{lastMessageId}}") { index = SillyTavern.chat.length - 1; }
            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) { return; }

            let state;
            if (prevState) { state = goodCopy(prevState); }
            else { state = await findLatestState(SillyTavern.chat, index - 1); }

            const newCommands = extractCommandsFromText(lastAIMessage.mes);
            const newState = await executeCommandPipeline(newCommands, state);

            await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newState)); return variables });

            const cleanNarrative = lastAIMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            let finalContent = cleanNarrative;
            const currentRound = await getRoundCounter();
            const shouldCheckpoint = ENABLE_AUTO_CHECKPOINT && CHECKPOINT_FREQUENCY > 0 && (currentRound > 0 && (currentRound % CHECKPOINT_FREQUENCY === 0 || index === 0));

            if (shouldCheckpoint) {
                const newStateBlock = await chunkedStringify(newState);
                finalContent += `\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            }

            await setChatMessage({ message: finalContent }, index, "display_current");
            await eventEmit(SAM_EVENTS.CORE_UPDATED, { source: 'AIGeneration', updatedIndex: index });

        } catch (error) { logger.error(`Error in processMessageState for index ${index}:`, error);
        } finally { isProcessingState = false; }
    }

    async function loadStateToMemory(targetIndex) {
        if (targetIndex === "{{lastMessageId}}") { targetIndex = SillyTavern.chat.length - 1; }
        let state = await findLatestState(SillyTavern.chat, targetIndex);
        if (targetIndex === 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) { state = _.merge({}, state, baseData); }
        }
        await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(state)); return variables });
        return state;
    }

    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) { if (chat[i] && chat[i].is_user === false) return i; }
        return -1;
    }

    async function sync_latest_state() {
        var lastlastAIMessageIdx = await findLastAiMessageAndIndex();
        await loadStateToMemory(lastlastAIMessageIdx);
    }

    async function dispatcher(event, ...event_params) {
        try {
            switch (curr_state) {
                case STATES.IDLE:
                    switch (event) {
                        case tavern_events.MESSAGE_SENT:
                        case tavern_events.GENERATION_STARTED:
                            if (event_params[2]) { return; }
                            if (event_params[0] === "swipe" || event_params[0] === "regenerate") {
                                await loadStateToMemory(findLatestUserMsgIndex());
                                prevState = goodCopy((await getVariables()).SAM_data);
                            } else if (event === tavern_events.MESSAGE_SENT) {
                                const lastAiIndex = await findLastAiMessageAndIndex();
                                prevState = await loadStateToMemory(lastAiIndex);
                            }
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case tavern_events.MESSAGE_SWIPED:
                        case tavern_events.MESSAGE_DELETED:
                        case tavern_events.MESSAGE_EDITED:
                        case tavern_events.CHAT_CHANGED:
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
                            await shoutINV();
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
                            await processMessageState(SillyTavern.chat.length - 1);
                            curr_state = STATES.IDLE;
                            
                            // after processing message, call INV to refresh frontend
                            await shoutINV();

                            prevState = null;
                            break;
                        case tavern_events.CHAT_CHANGED:
                            stopGenerationWatcher();
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
                            curr_state = STATES.IDLE;
                            break;
                    }
                    break;
                case STATES.PROCESSING:
                    logger.warn(`[PROCESSING] Received event ${event} while processing. Ignoring.`);
                    break;
            }
        } catch (e) {
            stopGenerationWatcher(); logger.error(`[Dispatcher] FSM Scheduling failed. Error: ${e}`);
            curr_state = STATES.IDLE; prevState = null;
        }

        // finally, broadcast the new state change
        shoutStatus();
    }

    async function unifiedEventHandler(event, ...args) { event_queue.push({ event_id: event, args: [...args] }); await unified_dispatch_executor(); }
    
    async function unified_dispatch_executor() {
        if (isDispatching) return; isDispatching = true;
        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift();
            try { await dispatcher(event_id, ...args); }
            catch (error) { logger.error(`Unhandled error during dispatch of ${event_id}:`, error); curr_state = STATES.IDLE; prevState = null; }
        }
        isDispatching = false;
        if (event_queue.length > 0) { setTimeout(() => unified_dispatch_executor(), 10); }
    }

    // no. Now we're going to make it a noisy guy.
    async function shoutStatus(){

        logger.info("[SAM] shouting status");
        await eventEmit(SAM_EVENTS.CORE_STATUS_RESPONSE, {
            state:curr_state,
            name: this_uid_name
        })
    }

    async function shoutINV(){
        logger.info("[SAM] shouting INV");
        await eventEmit(SAM_EVENTS.INV);
    }

    const handlers = {
        handleGenerationStarted: async (ev, options, dry_run) => await unifiedEventHandler(tavern_events.GENERATION_STARTED, ev, options, dry_run),
        handleGenerationEnded: async () => await unifiedEventHandler(tavern_events.GENERATION_ENDED),
        handleMessageSwiped: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_SWIPED), 0),
        handleMessageDeleted: (message) => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_DELETED, message), 0),
        handleMessageEdited: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_EDITED), 0),
        handleChatChanged: () => {

            setTimeout(async () => await unifiedEventHandler(tavern_events.CHAT_CHANGED), 10)

        },
        handleMessageSent: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_SENT), 0),
        handleGenerationStopped: () => setTimeout(async () => await unifiedEventHandler(tavern_events.GENERATION_STOPPED), 0),
        
        handleAskStatus: async () => {
            logger.info("Received status request from extension.");
            await eventEmit(SAM_EVENTS.CORE_STATUS_RESPONSE, {
                state:curr_state,
                name:this_uid_name
            });
        },
        handleCommitState: async (newStateObject) => {
            logger.info("Received a state commit request from extension.");
            if (curr_state !== STATES.IDLE || isProcessingState) {
                logger.warn("Core engine is busy. State commit rejected. Extension should retry.");
                return;
            }
            if (!newStateObject || typeof newStateObject !== 'object') {
                logger.error("State commit failed: Invalid or null state object received.");
                return;
            }
            isProcessingState = true;
            try {
                const lastAiIndex = await findLastAiMessageAndIndex();
                if (lastAiIndex === -1) {
                    logger.error("State commit failed: No AI message found to attach state to.");
                    toastr.error("SAM: Cannot save state, no AI message exists yet.");
                    return;
                }
                await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newStateObject)); return variables });
                const lastAiMessage = SillyTavern.chat[lastAiIndex];
                const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
                const newStateBlock = await chunkedStringify(newStateObject);
                const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
                await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
                await eventEmit(SAM_EVENTS.CORE_UPDATED, { source: 'ExtensionCommit', updatedIndex: lastAiIndex });
                toastr.success("SAM state saved by extension.");
            } catch (error) {
                logger.error("Error during extension state commit:", error);
                toastr.error("SAM: Failed to save state from extension.");
            } finally {
                isProcessingState = false;
            }
        },
    };

    function resetCurrentState() {
        logger.warn("!!! MANUAL STATE RESET TRIGGERED !!!");
        stopGenerationWatcher(); curr_state = STATES.IDLE; isDispatching = false; isProcessingState = false;
        isCheckpointing = false; event_queue.length = 0; prevState = null;
        sync_latest_state().then(() => toastr.success("SAM state has been reset and re-synced."))
                           .catch(err => toastr.error("SAM state reset, but re-sync failed."));
    }

    async function manualCheckpoint() {
        if (isCheckpointing || isProcessingState || curr_state !== STATES.IDLE) { toastr.warning("SAM is busy. Cannot create checkpoint now."); return; }
        isCheckpointing = true;
        try {
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) { toastr.error("Cannot checkpoint: No AI message found."); return; }
            const currentState = (await getVariables()).SAM_data;
            if (!currentState) { toastr.error("Current state is invalid. Cannot checkpoint."); return; }
            const lastAiMessage = SillyTavern.chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(currentState);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
            toastr.success("Checkpoint created successfully!");
        } catch (error) { logger.error("Manual checkpoint failed.", error); toastr.error("Checkpoint failed.");
        } finally { isCheckpointing = false; }
    }

    async function rerunLatestCommands() {
        if (curr_state !== STATES.IDLE) { toastr.error("Cannot rerun commands now. The script is busy."); return; }
        const lastAiIndex = await findLastAiMessageAndIndex();
        if (lastAiIndex === -1) { toastr.info("No AI message found to rerun."); return; }
        isProcessingState = true;
        try {
            toastr.info(`Rerunning commands from message at index ${lastAiIndex}...`);
            const initialState = await findLatestState(SillyTavern.chat, lastAiIndex - 1);
            const messageToRerun = SillyTavern.chat[lastAiIndex];
            const newCommands = extractCommandsFromText(messageToRerun.mes);
            const newState = await executeCommandPipeline(newCommands, initialState);
            await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newState)); return variables; });
            const currentRound = await getRoundCounter();
            const shouldCheckpoint = ENABLE_AUTO_CHECKPOINT && CHECKPOINT_FREQUENCY > 0 && (currentRound > 0 && (currentRound % CHECKPOINT_FREQUENCY === 0 || lastAiIndex === 0));
            const cleanNarrative = messageToRerun.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            let finalContent = cleanNarrative;
            if (shouldCheckpoint) {
                const newStateBlock = await chunkedStringify(newState);
                finalContent += `\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            }
            await setChatMessages([{'message_id':lastAiIndex, 'message':finalContent}]);
            toastr.success("Rerun complete. State saved.");
        } catch (error) { logger.error("Manual rerun failed.", error); toastr.error("Rerun failed.");
        } finally { isProcessingState = false; }
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
        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);
        eventOn(SAM_EVENTS.EXT_ASK_STATUS, handlers.handleAskStatus);
        eventOn(SAM_EVENTS.EXT_COMMIT_STATE, handlers.handleCommitState);
        window[HANDLER_STORAGE_KEY] = handlers;

        try {
            const resetEvent = getButtonEvent("重置内部状态（慎用）");
            const rerunLatestCommandsEvent = getButtonEvent("再次执行（慎用）");
            const displayLogEvent = getButtonEvent("执行日志");
            const checkpointEvent = getButtonEvent("手动检查点");
            if (resetEvent) eventOn(resetEvent, resetCurrentState);
            if (rerunLatestCommandsEvent) eventOn(rerunLatestCommandsEvent, rerunLatestCommands);
            if (displayLogEvent) eventOn(displayLogEvent, displayLogs);
            if (checkpointEvent) eventOn(checkpointEvent, manualCheckpoint);
        } catch (e) {
            logger.warn("Could not find debug buttons. This is normal if they are not defined in the UI.");
        }

        const initializeOrReloadStateForCurrentChat = async () => {
            logger.info("Initializing or reloading state for current chat.");
            const lastAiIndex = await findLastAiMessageAndIndex();
            await loadStateToMemory(lastAiIndex);
            prevState = goodCopy((await getVariables()).SAM_data);
            logger.info("Initialization finalized, prevState primed.");
        };

        try {
            this_uid_name = Date.now();
            logger.info(`V${SCRIPT_VERSION} loaded. GLHF, player. instance uid: ${this_uid_name}`);
            initializeOrReloadStateForCurrentChat();
            shoutINV();
        } catch (error) {
            logger.error("Error during final initialization:", error);
        }
    });

})();