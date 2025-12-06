// ============================================================================
// == Situational Awareness Manager
// == Version: 5.0.0 "Hadron"
// ==
// == This script provides a robust state management system for SillyTavern.
// ==
// == [NEW in 5.0.0] Native Sync Storage & Memory Overhaul:
// ==   - Replaced all async variable dependencies with SillyTavern's native
// ==     synchronous variable API for maximum speed and stability.
// ==   - `memory_mode`: A new state flag to control how SAM handles long-term data.
// ==     - 0: Disabled. State tracking works, but memory features are off.
// ==     - 1: Response Summary (Append Mode). Appends new summaries to the list.
// ==     - 11: Response Summary (Replace Mode). Overwrites the list (Token Efficient).
// ==     - 2: Event Mode. Enables the structured Event subsystem.
// ==   - `summary_period`: A new state flag to automatically trigger a summary
// ==     request from the AI every K rounds (e.g., every 15 turns).
// ==   - `summary_prompt`: A customizable system prompt used for auto-summarization.
// ==
// == [Retained from 4.0.0 "Lepton"] Checkpointing System:
// ==   - State blocks are only written as "checkpoints" based on frequency or manually.
// ==   - State reconstruction on demand by loading the last checkpoint and applying
// ==     all subsequent commands from chat history.
// ==   - `prevState` caching for ultra-fast state updates during swipes/regenerations.
// ==   - "Checkpoint" button to manually save the current state.
// ============================================================================
// ****************************
// Required plugins: None! (JS-slash-runner is no longer needed)
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
    description: Adds a text summary of the current response. Behavior depends on `memory_mode`.
    syntax: '@.RESPONSE_SUMMARY("summary_text");'
    parameters:
      - name: summary_text
        type: string
        description: A concise summary of the AI's response.
  - command: EVENT_BEGIN
    description: Starts a new narrative event. Fails if another event is already active. (Only works in memory_mode: 2)
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
    description: Concludes the currently active event, setting its status and end time. (Only works in memory_mode: 2)
    syntax: '@.EVENT_END(exitCode, "optional_summary");'
    parameters:
      - name: exitCode
        type: integer
        description: The status code for the event's conclusion (1=success, -1=aborted/failed, other numbers for custom states).
      - name: optional_summary
        type: string
        description: Optional. A final summary of the event's outcome.
  - command: EVENT_ADD_PROC
    description: Adds one or more procedural steps to the active event's log. (Only works in memory_mode: 2)
    syntax: '@.EVENT_ADD_PROC("step_description_1", "step_description_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: One or more strings detailing what just happened in the event.
  - command: EVENT_ADD_DEFN
    description: Adds a temporary, event-specific definition to the active event. (Only works in memory_mode: 2)
    syntax: '@.EVENT_ADD_DEFN("item_name", "item_description");'
    parameters:
      - name: item_name
        type: string
        description: The name of the new concept (e.g., "Shard of Narsil").
      - name: item_description
        type: string
        description: A brief description of the concept.
  - command: EVENT_ADD_MEMBER
    description: Adds one or more members to the list of participants in the active event. (Only works in memory_mode: 2)
    syntax: '@.EVENT_ADD_MEMBER("name_1", "name_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: The names of the characters or entities involved in the event.
  - command: EVENT_SUMMARY
    description: Sets or updates the summary for the active event. (Only works in memory_mode: 2)
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
    const SCRIPT_VERSION = "5.0 'Hadron'";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    const CHECKPOINT_FREQUENCY = 20;
    const ENABLE_AUTO_CHECKPOINT = true;

    const STATE_BLOCK_START_MARKER = '$$$$$$data_block$$$$$$';
    const STATE_BLOCK_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\$/g, '\\$')}\\s*([\\s\\S]*?)\\s*${STATE_BLOCK_END_MARKER.replace(/\$/g, '\\$')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\$/g, '\\$')}\\s*[\\s\\S]*?\\s*${STATE_BLOCK_END_MARKER.replace(/\$/g, '\\$')}`, 'sg');

    const COMMAND_START_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVENT_BEGIN|EVENT_END|EVENT_ADD_PROC|EVENT_ADD_DEFN|EVENT_ADD_MEMBER|EVENT_SUMMARY|EVAL)\b\s*\(/gim;
    
    const INITIAL_STATE = {
        static: {},
        time: "",
        volatile: [],
        responseSummary: [],
        func: [],
        events: [],
        event_counter: 0,
        uniquely_identified: false,
        disable_dtype_mutation: false,
        memory_mode: 1,
        summary_period: 0,
        summary_prompt: "SYSTEM NOTE: Deeply analyze and summarize everything that has happened in the last {{K}} turns of the story into a detailed, narrative block. Preserve all character developments, plot points, newly introduced items, and significant environmental changes. Ensure this new summary is additive and does not contradict the previous one. Previous summary for context: {{LAST_SUMMARY}}. After your narrative summary, create and execute a @.RESPONSE_SUMMARY command containing the full text of your summary."
    };

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
    const HANDLER_STORAGE_KEY = `__SAM_V5_EVENT_HANDLER_STORAGE__`;

    // --- NATIVE SYNC STORAGE WRAPPERS ---
    function getSAMData() {
        try {
            const ctx = SillyTavern.getContext();
            const data = ctx.variables.local.get("SAM_data");
            return data ? data : null;
        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Failed to get SAM_data:`, e);
            return null;
        }
    }

    function saveSAMData(data) {
        try {
            const ctx = SillyTavern.getContext();
            ctx.variables.local.set("SAM_data", data);
        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Failed to save SAM_data:`, e);
        }
    }

    // --- LOGGING & INSTANCE MANAGEMENT ---
    const logger = {
        info: (...args) => console.log(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args)
    };

    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) return;
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
    async function loadExternalLibrary(url, globalName) {
        if (window[globalName]) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function extractBalancedParams(text, startIndex) {
        let depth = 1, inString = false, quoteChar = '', i = startIndex;
        const len = text.length;
        while (i < len && depth > 0) {
            const c = text[i];
            if (inString) {
                if (c === quoteChar && text[i-1] !== '\\') inString = false;
            } else {
                if (c === '"' || c === "'" || c === '`') { inString = true; quoteChar = c; }
                else if (c === '(') depth++;
                else if (c === ')') depth--;
            }
            i++;
        }
        return depth === 0 ? { params: text.substring(startIndex, i - 1), endIndex: i } : null;
    }

    function extractCommandsFromText(messageContent) {
        COMMAND_START_REGEX.lastIndex = 0;
        let match;
        const commands = [];
        while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
            const commandType = match[1].toUpperCase();
            const extraction = extractBalancedParams(messageContent, match.index + match[0].length);
            if (extraction) {
                commands.push({ type: commandType, params: extraction.params.trim() });
                COMMAND_START_REGEX.lastIndex = extraction.endIndex;
            }
        }
        return commands;
    }

    async function getRoundCounter() { return SillyTavern.chat.length - 1; }
    
    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                return _.merge({}, _.cloneDeep(INITIAL_STATE), parsed);
            } catch (error) { return null; }
        }
        return null;
    }

    function goodCopy(state) {
        if (!state) return _.cloneDeep(INITIAL_STATE);
        try { return JSON.parse(JSON.stringify(state)); } 
        catch { return _.cloneDeep(state); }
    }
    
    function getActiveEvent(state) {
        if (!state.events || state.events.length === 0) return null;
        return state.events.find(e => e.status === 0) || null;
    }

    // ... (Other helpers like buildPathMap, isTypeMutationAllowed, etc. from v4 are still used inside applyCommandsToState)

    // --- MEMORY & SUMMARY LOGIC ---
    async function triggerSummaryInsertion(state) {
        const memoryMode = state.memory_mode;
        if (memoryMode !== 1 && memoryMode !== 11) return;

        const lastSummary = state.responseSummary.length > 0 ? state.responseSummary[state.responseSummary.length - 1] : "None.";
        let promptText = state.summary_prompt || INITIAL_STATE.summary_prompt;
        promptText = promptText.replace("{{LAST_SUMMARY}}", lastSummary.substring(0, 1000) + "...");
        promptText = promptText.replace("{{K}}", state.summary_period);

        logger.info("[Memory] Triggering Auto-Summary insertion.");
        await createChatMessages([{ role: 'system', message: promptText, is_system: true }]);
        toastr.info("SAM: Auto-summary prompt inserted. Please continue generation.");
    }
    
    // --- CORE COMMAND LOGIC ---
    function isTypeMutationAllowed(oldValue, newValue) {
        if (oldValue === null || typeof oldValue === 'undefined') return true;
        const oldType = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        const newType = Array.isArray(newValue) ? 'array' : typeof newValue;
        return oldType === newType;
    }
    
    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;
        const currentRound = await getRoundCounter();

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            if (i > 0 && i % COMMAND_BATCH_SIZE === 0) await new Promise(r => setTimeout(r, DELAY_MS));

            let params;
            try {
                params = JSON.parse(`[${command.params.trim()}]`);
            } catch {
                if (typeof window.jsonrepair !== 'function') await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                try { params = JSON.parse(window.jsonrepair(`[${command.params.trim()}]`)); } 
                catch (e) { logger.error(`Failed to parse/repair command ${command.type}:`, e); continue; }
            }

            try {
                switch (command.type) {
                    case 'SET':
                        if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, params[0]), params[1])) break;
                        _.set(state.static, params[0], params[1]);
                        break;
                    case 'ADD': {
                        const existing = _.get(state.static, params[0], 0);
                        if (Array.isArray(existing)) existing.push(params[1]);
                        else _.set(state.static, params[0], (Number(existing) || 0) + Number(params[1]));
                        break;
                    }
                    case 'DEL': {
                        const list = _.get(state.static, params[0]);
                        if (Array.isArray(list)) list.splice(params[1], 1);
                        break;
                    }
                    case 'SELECT_SET': {
                        const [listPath, selProp, selVal, recProp, valToSet] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) break;
                        const target = list.find(item => _.get(item, selProp) === selVal);
                        if (target) {
                           if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(target, recProp), valToSet)) break;
                           _.set(target, recProp, valToSet);
                        }
                        break;
                    }
                    case 'SELECT_ADD': {
                        const [listPath, selProp, selVal, recProp, valToAdd] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) break;
                        const target = list.find(item => _.get(item, selProp) === selVal);
                        if (target) {
                            const existing = _.get(target, recProp, 0);
                            if (Array.isArray(existing)) existing.push(valToAdd);
                            else _.set(target, recProp, (Number(existing) || 0) + Number(valToAdd));
                        }
                        break;
                    }
                    case 'SELECT_DEL': {
                         _.update(state.static, params[0], list => _.reject(list, { [params[1]]: params[2] }));
                         break;
                    }
                    case 'TIME':
                        state.time = params[0];
                        break;
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isRealTime, timepoint] = params;
                        if (state.disable_dtype_mutation && !isTypeMutationAllowed(_.get(state.static, varName), varValue)) break;
                        const targetTime = isRealTime ? new Date(timepoint).toISOString() : currentRound + Number(timepoint);
                        state.volatile.push([varName, varValue, isRealTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        const id = params[0];
                        state.volatile = state.volatile.filter(entry => entry[4] !== id && state.volatile.indexOf(entry) !== Number(id));
                        break;
                    }
                    case 'EVAL':
                        // Sandboxed eval logic would go here, omitted for security focus unless explicitly requested.
                        break;

                    // --- MEMORY MODE GATED COMMANDS ---
                    case 'RESPONSE_SUMMARY': {
                        if (state.memory_mode !== 1 && state.memory_mode !== 11) {
                            logger.warn(`RESPONSE_SUMMARY ignored (Memory Mode is ${state.memory_mode})`);
                            break;
                        }
                        if (state.memory_mode === 11) state.responseSummary = [params[0]]; // Replace
                        else state.responseSummary.push(params[0]); // Append
                        break;
                    }
                    case 'EVENT_BEGIN':
                    case 'EVENT_END':
                    case 'EVENT_ADD_PROC':
                    case 'EVENT_ADD_DEFN':
                    case 'EVENT_ADD_MEMBER':
                    case 'EVENT_SUMMARY': {
                        if (state.memory_mode !== 2) {
                            logger.warn(`Event command ${command.type} ignored (Not in Event Mode)`);
                            break;
                        }
                        const activeEvent = getActiveEvent(state);
                        switch (command.type) {
                            case 'EVENT_BEGIN':
                                if (activeEvent) break;
                                state.event_counter++;
                                state.events.push({
                                    name: params[0], evID: state.event_counter, start_time: state.time, objective: params[1],
                                    members: [], procedural: params.slice(2), new_defines: [], status: 0, summary: null
                                });
                                break;
                            case 'EVENT_END':
                                if (activeEvent) { activeEvent.status = params[0] ?? 1; activeEvent.end_time = state.time; if (params[1]) activeEvent.summary = params[1]; }
                                break;
                            case 'EVENT_ADD_PROC':
                                if (activeEvent) activeEvent.procedural.push(...params);
                                break;
                            case 'EVENT_ADD_DEFN':
                                if (activeEvent) activeEvent.new_defines.push({ name: params[0], desc: params[1] });
                                break;
                            case 'EVENT_ADD_MEMBER':
                                if (activeEvent) activeEvent.members.push(...params);
                                break;
                            case 'EVENT_SUMMARY':
                                if (activeEvent) activeEvent.summary = params[0];
                                break;
                        }
                        break;
                    }
                }
            } catch (e) { logger.error(`Error processing command ${command.type}:`, e); }
        }
        return state;
    }
    
    async function executeCommandPipeline(commands, state) {
        // Volatile updates first
        const promotedCommands = [];
        const remainingVolatiles = [];
        const currentTime = state.time ? new Date(state.time) : new Date();
        const currentRound = await getRoundCounter();
        for (const volatile of state.volatile) {
            const [varName, varValue, isRealTime, targetTime, reason] = volatile;
            if (isRealTime ? (currentTime >= new Date(targetTime)) : (currentRound >= targetTime)) {
                promotedCommands.push({ type: 'SET', params: JSON.stringify([varName, varValue]).slice(1,-1) });
            } else {
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;

        // Apply all commands
        return await applyCommandsToState([...commands, ...promotedCommands], state);
    }

    // --- STATE PROCESSING & LIFECYCLE ---
    async function processMessageState(index) {
        if (isProcessingState) return;
        isProcessingState = true;
        try {
            if (index === "{{lastMessageId}}") index = SillyTavern.chat.length - 1;
            const lastMsg = SillyTavern.chat[index];
            if (!lastMsg || lastMsg.is_user) return;

            let state = prevState ? goodCopy(prevState) : await findLatestState(SillyTavern.chat, index - 1);
            
            const newCommands = extractCommandsFromText(lastMsg.mes);
            const newState = await executeCommandPipeline(newCommands, state);

            saveSAMData(goodCopy(newState));

            const cleanNarrative = lastMsg.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            let finalContent = cleanNarrative;
            const currentRound = await getRoundCounter();

            if (ENABLE_AUTO_CHECKPOINT && CHECKPOINT_FREQUENCY > 0 && currentRound > 0 && (currentRound % CHECKPOINT_FREQUENCY === 0)) {
                const block = JSON.stringify(newState, null, 2);
                finalContent += `\n\n${STATE_BLOCK_START_MARKER}\n${block}\n${STATE_BLOCK_END_MARKER}`;
            }

            if (finalContent !== lastMsg.mes) {
                await setChatMessage({ message: finalContent }, index, "display_current");
            }

            if (newState.summary_period > 0 && currentRound > 0 && (currentRound % newState.summary_period === 0) && !lastMsg.is_system) {
                await triggerSummaryInsertion(newState);
            }

        } catch (e) { logger.error("Process State Error", e); } 
        finally { isProcessingState = false; }
    }

    async function findLatestState(chatHistory, targetIndex) {
        let baseState = _.cloneDeep(INITIAL_STATE);
        let checkpointIndex = -1;

        for (let i = targetIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (!message || message.is_user) continue;
            const stateFromBlock = parseStateFromMessage(message.mes);
            if (stateFromBlock) {
                baseState = stateFromBlock;
                checkpointIndex = i;
                break;
            }
        }

        const commandsToApply = [];
        for (let i = checkpointIndex + 1; i <= targetIndex; i++) {
            const message = chatHistory[i];
            if (message && !message.is_user) commandsToApply.push(...extractCommandsFromText(message.mes));
        }
        
        return await applyCommandsToState(commandsToApply, baseState);
    }
    
    async function loadStateToMemory(targetIndex) {
        if (targetIndex < 0) {
             saveSAMData(_.cloneDeep(INITIAL_STATE));
             return;
        }
        if (targetIndex === "{{lastMessageId}}") targetIndex = SillyTavern.chat.length - 1;
        let state = await findLatestState(SillyTavern.chat, targetIndex);
        saveSAMData(goodCopy(state));
        return state;
    }

    async function sync_latest_state() {
        let idx = -1;
        for (let i = SillyTavern.chat.length - 1; i >= 0; i--) {
            if (SillyTavern.chat[i] && !SillyTavern.chat[i].is_user) { idx = i; break; }
        }
        await loadStateToMemory(idx);
    }
    
    // --- DISPATCHER & EVENT HANDLING ---
    async function dispatcher(event, ...args) {
        switch (curr_state) {
            case STATES.IDLE:
                if (event === tavern_events.GENERATION_STARTED) {
                     await sync_latest_state();
                     prevState = getSAMData();
                     curr_state = STATES.AWAIT_GENERATION;
                     startGenerationWatcher();
                } else if ([tavern_events.MESSAGE_SWIPED, tavern_events.MESSAGE_DELETED, tavern_events.MESSAGE_EDITED, tavern_events.CHAT_CHANGED].includes(event)) {
                     await sync_latest_state();
                     prevState = getSAMData();
                }
                break;
            case STATES.AWAIT_GENERATION:
                if (event === tavern_events.GENERATION_STOPPED || event === tavern_events.GENERATION_ENDED) {
                    stopGenerationWatcher();
                    curr_state = STATES.PROCESSING;
                    await processMessageState(SillyTavern.chat.length - 1);
                    curr_state = STATES.IDLE;
                    prevState = null;
                }
                break;
        }
    }
    
    function startGenerationWatcher() {
        if(generationWatcherId) clearInterval(generationWatcherId);
        generationWatcherId = setInterval(() => {
            if (curr_state === STATES.AWAIT_GENERATION && !$('#mes_stop').is(':visible')) {
                dispatcher(tavern_events.GENERATION_ENDED);
            }
        }, 2000);
    }
    
    function stopGenerationWatcher() {
        if(generationWatcherId) clearInterval(generationWatcherId);
        generationWatcherId = null;
    }

    // --- INITIALIZATION ---
    $(() => {
        cleanupPreviousInstance();
        
        const handlers = {
            handleGenerationStarted: (...args) => dispatcher(tavern_events.GENERATION_STARTED, ...args),
            handleGenerationEnded: () => dispatcher(tavern_events.GENERATION_ENDED),
            handleMessageSwiped: () => setTimeout(() => dispatcher(tavern_events.MESSAGE_SWIPED), 50),
            handleMessageDeleted: () => setTimeout(() => dispatcher(tavern_events.MESSAGE_DELETED), 50),
            handleMessageEdited: () => setTimeout(() => dispatcher(tavern_events.MESSAGE_EDITED), 50),
            handleChatChanged: () => setTimeout(() => dispatcher(tavern_events.CHAT_CHANGED), 50),
            handleMessageSent: () => dispatcher(tavern_events.GENERATION_STARTED), // Treat as start
            handleGenerationStopped: () => dispatcher(tavern_events.GENERATION_STOPPED),
        };
        
        window[HANDLER_STORAGE_KEY] = handlers;
        
        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);

        const addBtn = (name, fn) => { try { const e = getButtonEvent(name); if(e) eventOn(e, fn); } catch {} };
        
        addBtn("重置内部状态（慎用）", async () => {
            curr_state = STATES.IDLE;
            stopGenerationWatcher();
            await sync_latest_state();
            toastr.success("SAM State has been reset and re-synced.");
        });
        
        addBtn("手动检查点", async () => {
             let lastAiIndex = -1;
             for (let i = SillyTavern.chat.length - 1; i >= 0; i--) {
                if(SillyTavern.chat[i] && !SillyTavern.chat[i].is_user) { lastAiIndex = i; break; }
             }
             if (lastAiIndex === -1) { toastr.error("No AI message to checkpoint."); return; }
             
             const state = getSAMData();
             const block = JSON.stringify(state, null, 2);
             const clean = SillyTavern.chat[lastAiIndex].mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
             await setChatMessage({ message: `${clean}\n\n${STATE_BLOCK_START_MARKER}\n${block}\n${STATE_BLOCK_END_MARKER}` }, lastAiIndex);
             toastr.success(`Checkpoint saved to message ${lastAiIndex}.`);
        });

        logger.info(`V${SCRIPT_VERSION} loaded. Initializing state...`);
        sync_latest_state().then(() => logger.info("State initialized successfully."));
    });

})();