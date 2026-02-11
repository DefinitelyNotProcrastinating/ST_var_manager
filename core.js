// ============================================================================
// == Situational Awareness Manager (CORE ENGINE)
// == Version: 5.1.1 "Iron Mongo" (Patched)
// ==
// == [REFACTOR OVERVIEW]
// == This version enhances the MongoDB protocol to support complex key names
// == (The "Iron Man Problem") and adds more operators.
// ==
// == [PATCH NOTES]
// == Fixed a critical issue where the JSON repair library caused a crash if
// == not loaded correctly, preventing state persistence.
// == Re-implemented the robust parsing logic from V4.
// ==
// == [ESCAPING DOTS]
// == To use a dot inside a key name without triggering a path traversal,
// == escape it with a double backslash: \\.
// == Ex: "suits.MK\\.50.status" -> updates state.suits["MK.50"].status
// ==
// == [NEW COMMANDS]
// == $move (or $rename): Moves a variable from one path to another.
// == $addToSet: Adds to a list only if it doesn't exist.
// == $mul: Multiplies a numeric value.
// == $min / $max: Updates value based on comparison.
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

// Plug and play command reference, paste into prompt:
/*
[STATE MANAGER INSTRUCTIONS]
You maintain the world state using specific commands.
Only use the following commands. Do not use markdown for commands.

1. UPDATE STATE: @.DB({ ...update_query... });
   - Perform database-style updates on variables using MongoDB operators.
   - Root object is 'state'. Access properties via dot notation.
   - IMPORTANT: If a key name contains a dot (e.g., "MK.50"), escape it: "suits.MK\\.50.power".
   
   Operators supported:
   - $set: { "path.to.var": value } -> Sets a variable.
   - $unset: { "path.to.var": "" } -> Deletes a variable.
   - $move: { "old.path": "new.path" } -> Moves/Renames a variable.
   - $inc: { "stats.gold": 10 } -> Adds to a number.
   - $mul: { "stats.exp_rate": 1.5 } -> Multiplies a number.
   - $push: { "inventory": "apple" } -> Adds to a list.
   - $addToSet: { "known_locations": "Town" } -> Adds to list only if unique.
   - $pull: { "inventory": "apple" } -> Removes value from list.
   - $pop: { "inventory": 1 } -> Removes last item (use -1 for first).

2. UPDATE TIME: @.TIME("ISO_DATE_STRING");
   - Update the current datetime.

3. EXECUTE: @.EVAL("function_name", args...);
   - Run a registered external function.

[EXAMPLES]
User: "I engage the MK.50 armor protocol."
Assistant: I suit up.
@.DB({
  "$set": { "suits.MK\\.50.active": true },
  "$move": { "equipment.held": "equipment.stowed" }
});
*/

// -------------------------------------------------------------------------------------------

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager (Core)";
    const SCRIPT_VERSION = "5.1.1 'Iron Mongo'";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    // Checkpointing configuration
    const CHECKPOINT_FREQUENCY = 20;
    const ENABLE_AUTO_CHECKPOINT = true;

    // State block formats
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${NEW_START_MARKER.replace(/\$/g, '\\$')}\\s*([\\s\\S]*?)\\s*${NEW_END_MARKER.replace(/\$/g, '\\$')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${NEW_START_MARKER.replace(/\$/g, '\\$')}[\\s\\S]*?${NEW_END_MARKER.replace(/\$/g, '\\$')}`, 'sg');

    const COMMAND_START_REGEX = /@\.(DB|TIME|EVAL)\b\s*\(/gim;
    // Regex to split by dot, but ignore dots preceded by backslash (The Iron Man Solver)
    const PATH_SPLIT_REGEX = /(?<!\\)\./;

    const INITIAL_STATE = { static: {}, time: "", volatile: [], responseSummary: { L1: [], L2: [], L3: [] }, func: [], events: [], event_counter: 0 };
    
    // Performance tuning
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const DELAY_MS = isMobileDevice ? 10 : 5;

    // --- STATE & LIFECYCLE MANAGEMENT ---
    let isProcessingState = false;
    let isDispatching = false;
    let isCheckpointing = false;
    let prevState = null;
    const event_queue = [];
    let generationWatcherId = null;

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };
    var curr_state = STATES.IDLE;
    var this_uid_name = 0;
    const WATCHER_INTERVAL_MS = 3000;
    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";
    const HANDLER_STORAGE_KEY = `__SAM_V5_CORE_EVENT_HANDLER_STORAGE__`;
    
    const logger = {
        info: (...args) => console.log(`[${SCRIPT_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME}]`, ...args),
    };

    const SAM_EVENTS = {
        CORE_UPDATED: 'SAM_CORE_UPDATED',
        EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',
        CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE',
        EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',
        CORE_IDLE: 'SAM_CORE_IDLE',
        INV:'SAM_INV'
    };

    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) { return; }
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
    const _loadingLibraries = {};
    async function loadExternalLibrary(url, globalName) {
        if (window[globalName]) return;
        if (_loadingLibraries[url]) return _loadingLibraries[url];
        
        logger.info(`Downloading external library: ${globalName}...`);
        _loadingLibraries[url] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => { 
                logger.info(`Library ${globalName} loaded successfully.`); 
                delete _loadingLibraries[url];
                resolve(); 
            };
            script.onerror = () => { 
                const err = new Error(`Failed to load script: ${url}`); 
                logger.error(err); 
                delete _loadingLibraries[url];
                reject(err); 
            };
            document.head.appendChild(script);
        });
        return _loadingLibraries[url];
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
        return depth === 0 ? { params: text.substring(startIndex, i - 1), endIndex: i } : { params: text.substring(startIndex), endIndex: len };
    }

    function extractCommandsFromText(messageContent) {
        COMMAND_START_REGEX.lastIndex = 0; let match; const commands = [];
        while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
            const commandType = match[1].toUpperCase();
            const openParenIndex = match.index + match[0].length;
            const extraction = extractBalancedParams(messageContent, openParenIndex);
            commands.push({ type: commandType, params: extraction.params.trim() });
            COMMAND_START_REGEX.lastIndex = extraction.endIndex;
        }
        return commands;
    }

    function stopGenerationWatcher() { if (generationWatcherId) { clearInterval(generationWatcherId); generationWatcherId = null; } }
    
    function startGenerationWatcher() {
        stopGenerationWatcher();
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
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
            catch (error) { return null; }
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
        } catch (error) { return null; }
    }

    async function getFuncs(){
        const sam_functionlib_id = "__SAM_IDENTIFIER__";
        try {
            const worldbookNames = await getCharWorldbookNames("current");
            if (!worldbookNames || !worldbookNames.primary) return null;
            const wi = await getWorldbook(worldbookNames.primary);
            if (!wi || !Array.isArray(wi)) return null;
            const baseDataEntry = wi.find(entry => entry.name === sam_functionlib_id);
            if (!baseDataEntry || !baseDataEntry.content) return null;
            return JSON.parse(baseDataEntry.content);
        } catch (error) { return null; }
    }

    async function runSandboxedFunction(funcName, params, state) {
        let loadedFuncs = await getFuncs();
        if (!loadedFuncs || !Array.isArray(loadedFuncs)) loadedFuncs = state.func || [];
        const funcDef = loadedFuncs.find(f => f.func_name === funcName);
        if (!funcDef) { logger.warn(`EVAL: Function '${funcName}' not found.`); return; }
        
        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const rawParamNames = funcDef.func_params || [];
        let formalParamNames = []; let restParamName = null;
        for (const param of rawParamNames) { if (param.startsWith('...')) { restParamName = param.substring(3); } else { formalParamNames.push(param); } }
        let bodyPrologue = '';
        if (restParamName) { const startIndex = formalParamNames.length; bodyPrologue = `const ${restParamName} = Array.from(arguments).slice(${4 + startIndex});\n`; }
        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled.'); };
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
        const timeoutPromise = new Promise((_, reject) => { setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out.`)), timeout); });
        try { await Promise.race([executionPromise, timeoutPromise]); } catch (error) { logger.error(`EVAL Error '${funcName}':`, error); }
    }

    async function chunkedStringify(obj) { return new Promise((resolve) => { setTimeout(() => { resolve(JSON.stringify(obj, null, 2)); }, DELAY_MS); }); }

    // --- MONGODB UPDATE ENGINE (ADVANCED + IRON MAN SOLVER) ---

    function parseSafePath(pathStr) {
        if (!pathStr || typeof pathStr !== 'string') return [pathStr];
        
        // 1. 将被转义的点 "\." 替换为一个不会冲突的占位符
        // 这样我们就可以安全地使用普通点 "." 进行分割
        const placeholder = "%%_SAM_ESCAPED_DOT_%%"; 
        const protectedPath = pathStr.replace(/\\\./g, placeholder);
        
        // 2. 使用普通点分割
        const segments = protectedPath.split('.');
        
        // 3. 将各段中的占位符还原为普通的点 "."
        return segments.map(s => s.replace(new RegExp(placeholder, 'g'), '.'));
    }

    function applyMongoUpdate(target, update) {
        if (!update || typeof update !== 'object') return;

        // $set: Sets the value of a field
        if (update.$set) {
            for (const [path, value] of Object.entries(update.$set)) {
                _.set(target, parseSafePath(path), value);
            }
        }

        // $unset: Removes the specified field
        if (update.$unset) {
            for (const [path, val] of Object.entries(update.$unset)) {
                _.unset(target, parseSafePath(path));
            }
        }

        // $rename or $move: Moves a field
        const moves = update.$rename || update.$move;
        if (moves) {
            for (const [oldPath, newPath] of Object.entries(moves)) {
                const oldPathArr = parseSafePath(oldPath);
                const val = _.get(target, oldPathArr);
                if (val !== undefined) {
                    _.set(target, parseSafePath(newPath), val);
                    _.unset(target, oldPathArr);
                }
            }
        }

        // $inc: Increments the value
        if (update.$inc) {
            for (const [path, amount] of Object.entries(update.$inc)) {
                const safePath = parseSafePath(path);
                const current = _.get(target, safePath);
                const numCurrent = typeof current === 'number' ? current : 0;
                _.set(target, safePath, numCurrent + (Number(amount) || 0));
            }
        }

        // $mul: Multiplies the value
        if (update.$mul) {
            for (const [path, factor] of Object.entries(update.$mul)) {
                const safePath = parseSafePath(path);
                const current = _.get(target, safePath);
                const numCurrent = typeof current === 'number' ? current : 0;
                _.set(target, safePath, numCurrent * (Number(factor) || 1));
            }
        }

        // $min: Updates if new value is less
        if (update.$min) {
            for (const [path, val] of Object.entries(update.$min)) {
                const safePath = parseSafePath(path);
                const current = _.get(target, safePath);
                if (typeof current !== 'number' || val < current) {
                    _.set(target, safePath, val);
                }
            }
        }

        // $max: Updates if new value is greater
        if (update.$max) {
            for (const [path, val] of Object.entries(update.$max)) {
                const safePath = parseSafePath(path);
                const current = _.get(target, safePath);
                if (typeof current !== 'number' || val > current) {
                    _.set(target, safePath, val);
                }
            }
        }

        // $push: Appends to array
        if (update.$push) {
            for (const [path, payload] of Object.entries(update.$push)) {
                const safePath = parseSafePath(path);
                let array = _.get(target, safePath);
                if (!Array.isArray(array)) { array = []; _.set(target, safePath, array); }
                
                if (payload && typeof payload === 'object' && payload.$each && Array.isArray(payload.$each)) {
                    array.push(...payload.$each);
                } else {
                    array.push(payload);
                }
            }
        }

        // $addToSet: Appends only if unique
        if (update.$addToSet) {
            for (const [path, payload] of Object.entries(update.$addToSet)) {
                const safePath = parseSafePath(path);
                let array = _.get(target, safePath);
                if (!Array.isArray(array)) { array = []; _.set(target, safePath, array); }

                const itemsToAdd = (payload && typeof payload === 'object' && payload.$each && Array.isArray(payload.$each)) 
                    ? payload.$each 
                    : [payload];

                itemsToAdd.forEach(item => {
                    const exists = array.some(existing => _.isEqual(existing, item));
                    if (!exists) array.push(item);
                });
            }
        }

        // $pop: Removes first/last
        if (update.$pop) {
             for (const [path, direction] of Object.entries(update.$pop)) {
                const safePath = parseSafePath(path);
                let array = _.get(target, safePath);
                if (Array.isArray(array) && array.length > 0) {
                    if (direction === 1) array.pop();
                    else if (direction === -1) array.shift();
                }
            }
        }

        // $pull: Removes matching items
        if (update.$pull) {
            for (const [path, criteria] of Object.entries(update.$pull)) {
                const safePath = parseSafePath(path);
                let array = _.get(target, safePath);
                if (Array.isArray(array)) {
                    _.remove(array, (item) => {
                        if (typeof criteria === 'object' && criteria !== null) {
                            return _.isMatch(item, criteria) || _.isEqual(item, criteria);
                        } else {
                            return item === criteria;
                        }
                    });
                }
            }
        }
    }

    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;

        for (const command of commands) {
            let parsedParams = null;
            
            try {
                if (command.type === 'DB') {
                    // Try standard parse first
                    try {
                        parsedParams = JSON.parse(command.params);
                    } catch (e) {
                        // Fallback to jsonrepair
                        if (typeof window.jsonrepair !== 'function') await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                        const repaired = window.jsonrepair(command.params);
                        parsedParams = JSON.parse(repaired);
                    }
                } else if (command.type === 'EVAL') {
                    // EVAL params usually come as "func", arg1, arg2
                    // We wrap in [] to parse as array
                    const arrayWrapped = `[${command.params}]`;
                    try {
                        parsedParams = JSON.parse(arrayWrapped);
                    } catch (e) {
                         if (typeof window.jsonrepair !== 'function') await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                         parsedParams = JSON.parse(window.jsonrepair(arrayWrapped));
                    }
                } else if (command.type === 'TIME') {
                    if (command.params.startsWith('"') || command.params.startsWith("'")) {
                        parsedParams = [ command.params.slice(1, -1) ];
                    } else { parsedParams = [ command.params ]; }
                }
            } catch (e) {
                logger.warn(`Failed to parse params for ${command.type}.`, e);
                continue;
            }

            try {
                switch (command.type) {
                    case 'DB': {
                        applyMongoUpdate(state.static, parsedParams);
                        break;
                    }
                    case 'TIME': {
                        const newTime = parsedParams[0];
                        if (state.time) { state.dtime = new Date(newTime) - new Date(state.time); } 
                        else { state.dtime = 0; } 
                        state.time = newTime; 
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = parsedParams; 
                        await runSandboxedFunction(funcName, funcParams, state); 
                        break; 
                    }
                }
            } catch (error) { logger.error(`Error executing ${command.type}:`, error); }
        }
        return state;
    }

    async function executeCommandPipeline(messageCommands, state) {
        let loadedFuncs = await getFuncs();
        const periodicCommands = (loadedFuncs || [])
            .filter(f => f.periodic === true)
            .map(f => ({ type: 'EVAL', params: `"${f.func_name}"` }));
        const allCommands = [...messageCommands, ...periodicCommands];
        await applyCommandsToState(allCommands, state);
        return state;
    }

    async function processMessageState(index) {
        if (isProcessingState) { return; }
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
                finalContent += `\n\n${NEW_START_MARKER}\n${newStateBlock}\n${NEW_END_MARKER}`;
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
            }
        } catch (e) {
            stopGenerationWatcher(); logger.error(`[Dispatcher] Error: ${e}`);
            curr_state = STATES.IDLE; prevState = null;
        }
        shoutStatus();
    }

    async function unifiedEventHandler(event, ...args) { event_queue.push({ event_id: event, args: [...args] }); await unified_dispatch_executor(); }
    
    async function unified_dispatch_executor() {
        if (isDispatching) return; isDispatching = true;
        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift();
            try { await dispatcher(event_id, ...args); }
            catch (error) { logger.error(`Unhandled error during dispatch:`, error); curr_state = STATES.IDLE; prevState = null; }
        }
        isDispatching = false;
        if (event_queue.length > 0) { setTimeout(() => unified_dispatch_executor(), 10); }
    }

    async function shoutStatus(){ await eventEmit(SAM_EVENTS.CORE_STATUS_RESPONSE, { state:curr_state, name: this_uid_name }); }
    async function shoutINV(){ await eventEmit(SAM_EVENTS.INV); }

    const handlers = {
        handleGenerationStarted: async (ev, options, dry_run) => await unifiedEventHandler(tavern_events.GENERATION_STARTED, ev, options, dry_run),
        handleGenerationEnded: async () => await unifiedEventHandler(tavern_events.GENERATION_ENDED),
        handleMessageSwiped: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_SWIPED), 0),
        handleMessageDeleted: (message) => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_DELETED, message), 0),
        handleMessageEdited: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_EDITED), 0),
        handleChatChanged: () => { setTimeout(async () => await unifiedEventHandler(tavern_events.CHAT_CHANGED), 10) },
        handleMessageSent: () => setTimeout(async () => await unifiedEventHandler(tavern_events.MESSAGE_SENT), 0),
        handleGenerationStopped: () => setTimeout(async () => await unifiedEventHandler(tavern_events.GENERATION_STOPPED), 0),
        handleAskStatus: async () => { await eventEmit(SAM_EVENTS.CORE_STATUS_RESPONSE, { state:curr_state, name:this_uid_name }); },
        handleCommitState: async (newStateObject) => {
            if (curr_state !== STATES.IDLE || isProcessingState) return;
            isProcessingState = true;
            try {
                const lastAiIndex = await findLastAiMessageAndIndex();
                if (lastAiIndex === -1) return;
                await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newStateObject)); return variables });
                const lastAiMessage = SillyTavern.chat[lastAiIndex];
                const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
                const newStateBlock = await chunkedStringify(newStateObject);
                const finalContent = `${cleanNarrative}\n\n${NEW_START_MARKER}\n${newStateBlock}\n${NEW_END_MARKER}`;
                await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
                await eventEmit(SAM_EVENTS.CORE_UPDATED, { source: 'ExtensionCommit', updatedIndex: lastAiIndex });
                toastr.success("SAM state saved.");
            } catch (error) { toastr.error("SAM: Failed to save state."); } finally { isProcessingState = false; }
        },
    };

    function resetCurrentState() {
        stopGenerationWatcher(); curr_state = STATES.IDLE; isDispatching = false; isProcessingState = false;
        isCheckpointing = false; event_queue.length = 0; prevState = null;
        sync_latest_state().then(() => toastr.success("SAM state reset.")).catch(err => toastr.error("SAM state reset failed."));
    }

    async function manualCheckpoint() {
        if (isCheckpointing || isProcessingState || curr_state !== STATES.IDLE) return;
        isCheckpointing = true;
        try {
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) return;
            const currentState = (await getVariables()).SAM_data;
            const lastAiMessage = SillyTavern.chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(currentState);
            const finalContent = `${cleanNarrative}\n\n${NEW_START_MARKER}\n${newStateBlock}\n${NEW_END_MARKER}`;
            await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
            toastr.success("Checkpoint created.");
        } finally { isCheckpointing = false; }
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
            const checkpointEvent = getButtonEvent("手动检查点");
            if (resetEvent) eventOn(resetEvent, resetCurrentState);
            if (checkpointEvent) eventOn(checkpointEvent, manualCheckpoint);
        } catch (e) {}

        const initializeOrReloadStateForCurrentChat = async () => {
            const lastAiIndex = await findLastAiMessageAndIndex();
            await loadStateToMemory(lastAiIndex);
            prevState = goodCopy((await getVariables()).SAM_data);
        };

        try {
            this_uid_name = Date.now();
            logger.info(`V${SCRIPT_VERSION} loaded. instance uid: ${this_uid_name}`);
            initializeOrReloadStateForCurrentChat();
            shoutINV();
        } catch (error) { logger.error("Init Error:", error); }
    });
})();