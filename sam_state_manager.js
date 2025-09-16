// ============================================================================
// == Situational Awareness Manager
// == Version: 3.2.0 (Refactored Command Syntax)
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It correctly handles state during swipes and regenerations by using
// == the GENERATION_STARTED event to prepare the state, fixing race conditions.
// == It also includes a sandboxed EVAL command for user-defined functions,
// == now with support for execution ordering and periodic execution.
// ==
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



(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    // [MODIFIED] Switched to a robust, code-like command syntax.
    const COMMAND_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\b\s*\(([\s\S]*?)\)\s*;/gis;
    const INITIAL_STATE = { static: {}, time: "",volatile: [], responseSummary: [], func: [] };
    let isProcessingState = false;
  
    // FSM implementation strategy

    const STATES = {
        IDLE: "IDLE",
        AWAIT_GENERATION: "AWAIT_GENERATION",
        PROCESSING: "PROCESSING"
    };
    
    // set curr_state and next_state
    var curr_state = STATES.IDLE;

    // do a queue-based event handler.
    const event_queue = [];

    // defensive programming against SillyTavern ignoring event sends
    let generationWatcherId = null;
    const WATCHER_INTERVAL_MS = 3000; // Check every 3 seconds
    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";



    // --- SCRIPT LIFECYCLE MANAGEMENT ---
    // This key is used to store our event handlers on the global window object.
    // This allows a new instance of the script to find and remove the listeners
    // from an old instance, preventing the "multiple listener" bug on script reloads.
    const HANDLER_STORAGE_KEY = `__SAM_V3_EVENT_HANDLERS__`;
    const SESSION_STORAGE_KEY = "__SAM_ID__";
    var session_id = "";


    // This function is called by a new script instance to remove listeners
    // from a previously loaded instance.
    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) {
            console.log(`[${SCRIPT_NAME}] No previous instance found. Starting fresh.`);
            return;
        }

        console.log(`[${SCRIPT_NAME}] Found a previous instance. Removing its event listeners to prevent duplicates.`);
        eventRemoveListener(tavern_events.GENERATION_STARTED, oldHandlers.handleGenerationStarted);
        eventRemoveListener(tavern_events.GENERATION_ENDED, oldHandlers.handleGenerationEnded);
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, oldHandlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, oldHandlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, oldHandlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, oldHandlers.handleChatChanged);
        eventRemoveListener(tavern_events.MESSAGE_SENT, oldHandlers.handleMessageSent);
        eventRemoveListener(tavern_events.GENERATION_STOPPED, oldHandlers.handleGenerationStopped);


        // Once the old listeners are gone, we can remove the old handler object.
        delete window[HANDLER_STORAGE_KEY];
    };


    // [MODIFIED] Updated command documentation to reflect the new @.command(...); syntax.
    // --- Command Explanations ---
    // All commands must end with a semicolon ';'. Parameters should be JSON-compatible (e.g., strings in double quotes).
    //
    // SET:          Sets a variable to a value.
    //               Syntax: @.SET("path.to.var", value);
    //
    // ADD:          Adds a number to a variable, or an item to a list.
    //               Syntax: @.ADD("path.to.var", value_to_add);
    //
    // DEL:          Deletes an item from a list by its numerical index.
    //               Syntax: @.DEL("path.to.list", index);
    //
    // TIME:         Updates the in-game clock and calculates time delta.
    //               Syntax: @.TIME("YYYY-MM-DDTHH:MM:SSZ");
    //
    // TIMED_SET:    Schedules a SET command.
    //               Syntax: @.TIMED_SET("path.to.var", "new_value", "reason", is_real_time, timepoint);
    //               is_real_time: boolean (true for date string, false for round count)
    //               timepoint: string (e.g., "2024-10-26T10:00:00Z") or number (e.g., 5 rounds from now)
    //
    // CANCEL_SET:   Cancels a scheduled TIMED_SET by its index or reason.
    //               Syntax: @.CANCEL_SET("reason_to_cancel"); or @.CANCEL_SET(0);
    //
    // SELECT_ADD:   Finds an object in a list and adds a value to one of its properties.
    //               Syntax: @.SELECT_ADD("path.to.list", "selector_key", "selector_value", "receiver_key", value_to_add);
    //
    // SELECT_SET:   Finds an object in a list and sets one of its properties.
    //               Syntax: @.SELECT_SET("path.to.list", "selector_key", "selector_value", "receiver_key", value_to_set);
    //
    // SELECT_DEL:   Finds and deletes an entire object from a list.
    //               Syntax: @.SELECT_DEL("path.to.list", "selector_key", "selector_value");
    //
    // RESPONSE_SUMMARY: Adds a summary of the AI's response to a list.
    //               Syntax: @.RESPONSE_SUMMARY("Text summary of the response.");
    //
    // EVAL:         Executes a user-defined function stored in the state.
    //               Syntax: @.EVAL("function_name", param1, param2, ...);
    //               WARNING: DANGEROUS. USE WITH CAUTION.
    //
    // EVAL logic remains the same (defined in state.func array).


    // --- HELPER FUNCTIONS ---

    // This helper function stops the watcher and cleans up its ID
    function stopGenerationWatcher() {
        if (generationWatcherId) {
            console.log('[SAM Watcher] Stopping generation watcher.');
            clearInterval(generationWatcherId);
            generationWatcherId = null;
        }
    }

    // This function starts the watcher
    function startGenerationWatcher() {
        // Stop any previous watcher just in case.
        stopGenerationWatcher();

        console.log(`[SAM] [Await watcher] Starting generation watcher. Will check UI every ${WATCHER_INTERVAL_MS / 1000}s.`);
        generationWatcherId = setInterval(() => {
            // This is the core logic of our janitor process
            //console.log('[SAM] [Await watcher] Performing check...');

            // Check if the "Stop" button is visible.
            // This is our new, reliable source of truth.
            const isUiGenerating = $('#mes_stop').is(':visible'); // false when not generating, true when generating

            // Condition for intervention: FSM is stuck waiting, but the UI says generation is over.
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
                console.warn('[SAM] [Await watcher] DETECTED DESYNC! FSM is in AWAIT_GENERATION, but ST is not generating. Forcing state transition.');
                
                // Stop ourselves from running again.
                stopGenerationWatcher();
                
                // Push our special event into the queue to force processing.
                // Using the unifiedEventHandler ensures we respect the queue and dispatch lock.
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);

            } else if (curr_state !== STATES.AWAIT_GENERATION) {
                // Failsafe: If the FSM is not in the await state for any reason,
                // the watcher's job is done.
                console.log('[SAM Watcher] FSM is no longer awaiting generation. Shutting down watcher.');
                stopGenerationWatcher();
            }

        }, WATCHER_INTERVAL_MS);
    }





    async function getRoundCounter(){
        return SillyTavern.chat.length -1;
    }

    function tryParseJSON(str) {
        // [MODIFIED] This function remains, but is now used more broadly by the parameter parser.
        try {
            return JSON.parse(str);
        } catch (e) {
            return str; // Return original string if it's not valid JSON
        }
    }

    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                return {
                    static: parsed.static ?? {},
                    volatile: parsed.volatile ?? [],
                    responseSummary: parsed.responseSummary ?? [],
                    func: parsed.func ?? [],
                    time: parsed.time ?? "",
                    dtime : parsed.dtime ?? 0
                };
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed to parse state JSON.`, error);
                return _.cloneDeep(INITIAL_STATE);
            }
        }
        return null;
    }

    async function findLatestState(chatHistory, lastIndex = chatHistory.length-1) {
        console.log(`[SAM] finding latest state down from ${lastIndex}`);
        for (let i = lastIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;

            const state = parseStateFromMessage(message.mes);
            if (state) {
                console.log(`[${SCRIPT_NAME}] Found latest state, State loaded from message at index ${i}.`);
                return _.cloneDeep(state);
            }
        }
        console.log(`[${SCRIPT_NAME}] No previous state found. Using initial state.`);
        return _.cloneDeep(INITIAL_STATE);
    }


    function findLatestUserMsgIndex(){
        for (let i = SillyTavern.chat.length -1; i >= 0; i--){
            const message = SillyTavern.chat[i];
            if (message.is_user){
                return i;
            }
        }
        return -1;
    }
    
    function goodCopy(state) {
        return _.cloneDeep(state) ?? _.cloneDeep(INITIAL_STATE);
    }

    // --- Sandboxed function executor
    async function runSandboxedFunction(funcName, params, state) {
        const funcDef = state.func?.find(f => f.func_name === funcName);


        if (!funcDef) {
            console.warn(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' not found in state.func array.`);
            return;
        }

        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const rawParamNames = funcDef.func_params || [];


        let formalParamNames = [];
        let restParamName = null;

        for (const param of rawParamNames) {
            if (param.startsWith('...')) {
                // This is our rest parameter. Store its name without the '...'.
                restParamName = param.substring(3);
            } else {
                // This is a normal, formal parameter.
                formalParamNames.push(param);
            }
        }

        let bodyPrologue = '';
        if (restParamName) {
            // If a rest parameter was defined, we inject code to create it from the 'arguments' object.
            // We slice the arguments object starting after the last formal parameter.
            const startIndex = formalParamNames.length;
            // This line will become e.g.: `const skill_names = Array.from(arguments).slice(4);`
            // The '4' comes from state, _, fetch, XMLHttpRequest.
            bodyPrologue = `const ${restParamName} = Array.from(arguments).slice(${4 + startIndex});\n`;
        }

        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;

                // These are the names of all parameters the new function will accept.
                // Notice we are ONLY using the formal (non-rest) parameter names here.
                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...formalParamNames];
                
                // These are the values we will pass when we call the function.
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];

                // We assemble the final function body string.
                const functionBody = `'use strict';\n${bodyPrologue}${funcDef.func_body}`;

                // Create the function. This is now safe for strict mode.
                const userFunction = new Function(...argNames, functionBody);

                // Execute the function. `.apply` will correctly pass all our `argValues`.
                const result = await userFunction.apply(null, argValues);
                
                resolve(result);

            } catch (error)
                {
                reject(error);
            }
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout);
        });

        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            console.log(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] EVAL: Error executing function '${funcName}'.`, error);
        }
    }


    // --- CORE LOGIC ---
    async function processVolatileUpdates(state) {
        if (!state.volatile || !state.volatile.length) return [];
        const promotedCommands = [];
        const remainingVolatiles = [];
        
        const deleted = [];

        const currentRound = await getRoundCounter();
        var currentTime = state.time;
        if (!currentTime){
            currentTime = new Date();
        }
        for (const volatile of state.volatile) {
            const [varName, varValue, isGameTime, targetTime] = volatile;
            let triggered = isGameTime ? (new Date(String(currentTime)) >= new Date(targetTime)) : (currentRound >= targetTime);
            if (triggered) {
                // [MODIFIED] Generate commands in the new format. JSON.stringify ensures values are correctly formatted.
                const params = `${JSON.stringify(varName)}, ${JSON.stringify(varValue)}`;
                promotedCommands.push({ type: 'SET', params: params });
            } else {
                if (targetTime) { }
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }
    
    // [MODIFIED] This function is no longer needed as the new param parser handles types correctly.
    // Kept for EVAL command's specific needs.
    function smart_parse(value){
        if (typeof value !== 'string') return value;
        try { return JSON.parse(value); } 
        catch (e) { return value; }
    }

    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) {
            return state;
        }
        const currentRound = await getRoundCounter();
        let modifiedListPaths = new Set();
        
        for (const command of commands) {
            // [MODIFIED] Major change in parameter parsing.
            // We treat the content inside (...) as a list of arguments for a JSON array.
            // This robustly handles strings, numbers, booleans, and even JSON objects as parameters.
            let params;
            try {
                // If params is empty (e.g., @.COMMAND();), treat as an empty array.
                const paramsString = command.params.trim();
                params = paramsString ? JSON.parse(`[${paramsString}]`) : [];
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed to parse parameters for command ${command.type}. Params: "${command.params}"`, error);
                continue; // Skip this malformed command.
            }
            
            try {
                // [MODIFIED] All cases updated to use the `params` array instead of splitting a string.
                switch (command.type) {
                    case 'SET': {
                        let [varName, varValue] = params;
                        if (!varName || varValue === undefined) continue;
                        // The JSON.parse trick already handles types, so no extra parsing needed.
                        _.set(state.static, varName, varValue);
                        break;
                    }
                    case 'ADD': {
                        const [varName, valueToAdd] = params;
                        if (!varName || valueToAdd === undefined) continue;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) {
                            existing.push(valueToAdd);
                        } else {
                            const increment = Number(valueToAdd);
                            const baseValue = Number(existing) || 0;
                            if (isNaN(increment) || isNaN(baseValue)) continue;
                            _.set(state.static, varName, baseValue + increment);
                        }
                        break;
                    }
                    case 'RESPONSE_SUMMARY': {
                        if (!Array.isArray(state.responseSummary)) {
                            state.responseSummary = state.responseSummary ? [state.responseSummary] : [];
                        }
                        const summaryText = params[0];
                        if (summaryText && !state.responseSummary.includes(summaryText)){
                           state.responseSummary.push(summaryText);
                        }
                        break;
                    }
                    case "TIME" : {
                        const timeStr = params[0];
                        if (!timeStr) continue;
                        if (state.time) {
                            const prev_time = state.time;
                            state.time = timeStr;
                            _.set(state, 'dtime', new Date(state.time) - new Date(prev_time));
                        } else {
                            state.time = timeStr;
                            _.set(state, 'dtime', 0);
                        }
                        break;
                    }
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isGameTime, timepoint] = params;
                        if (!varName || varValue === undefined || !reason || isGameTime === undefined || !timepoint) continue;
                        const targetTime = isGameTime ? new Date(timepoint).toISOString() : currentRound + Number(timepoint);
                        if(!state.volatile) state.volatile = [];
                        state.volatile.push([varName, varValue, isGameTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        if (params.length === 0 || !state.volatile?.length) continue;
                        const identifier = params[0];
                        const index = parseInt(identifier, 10);
                        if (!isNaN(index) && index >= 0 && index < state.volatile.length) {
                            state.volatile.splice(index, 1);
                        } else {
                            state.volatile = state.volatile.filter(entry => {
                                const [varName, , , , reason] = entry;
                                return varName !== identifier && reason !== identifier;
                            });
                        }
                        break;
                    }
                    case 'DEL': {
                        const [listPath, index] = params;
                        if (!listPath || index === undefined || isNaN(Number(index))) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        if (index >= 0 && index < list.length) {
                            list[index] = undefined;
                            modifiedListPaths.add(listPath);
                        }
                        break;
                    }
                    case 'SELECT_DEL': {
                        const [listPath, identifier, targetId] = params;
                        if (!listPath || !identifier || targetId === undefined) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        _.set(state.static, listPath, _.reject(list, {[identifier]: targetId}));
                        break;
                    }
                    case 'SELECT_ADD' : {
                        const [listPath, selectorProp, selectorVal, receiverProp, valueToAdd] = params;
                        if (!listPath || !selectorProp || selectorVal === undefined || !receiverProp || valueToAdd === undefined) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        const targetObject = _.find(list, { [selectorProp]: selectorVal });
                        if (!targetObject) continue;
                        const existingValue = _.get(targetObject, receiverProp);
                        if (Array.isArray(existingValue)) {
                            existingValue.push(valueToAdd);
                            _.set(targetObject, receiverProp, existingValue);
                        } else {
                            const baseValue = Number(existingValue) || 0;
                            const increment = Number(valueToAdd);
                            if (isNaN(baseValue) || isNaN(increment)) continue;
                            _.set(targetObject, receiverProp, baseValue + increment);
                        }
                        break;
                    }
                    case 'SELECT_SET' : {
                        const [listPath, selectorProp, selectorVal, receiverProp, valueToSet] = params;
                        if (!listPath || !selectorProp || selectorVal === undefined || !receiverProp || valueToSet === undefined) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        const targetObject = _.find(list, { [selectorProp]: selectorVal });
                        if (!targetObject) continue;
                        _.set(targetObject, receiverProp, valueToSet);
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = params;
                        if (!funcName) {
                            console.warn(`[${SCRIPT_NAME}] EVAL aborted: EVAL command requires a function name.`);
                            continue;
                        }
                        // EVAL params are already parsed correctly by our JSON trick.
                        await runSandboxedFunction(funcName, funcParams, state);
                        break;
                    }
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error processing command: ${JSON.stringify(command)}`, error);
            }
        }

        for (const path of modifiedListPaths){
            const list = _.get(state.static, path);
            _.remove(list, (item) => item === undefined);
        }

        return state;
    }
    
    // ========== FIXED FUNCTION ==========
    async function executeCommandPipeline(messageCommands, state) {
        const periodicCommands = state.func?.filter(f => f.periodic === true)
                                         .map(f => ({ type: 'EVAL', params: `"${f.func_name}"` })) || [];
    
        const allPotentialCommands = [...messageCommands, ...periodicCommands];
        
        const priorityCommands = [];
        const firstEvalItems = [];
        const lastEvalItems = [];
        const normalCommands = [];
        
        const funcDefMap = new Map(state.func?.map(f => [f.func_name, f]) || []);

        for (const command of allPotentialCommands) {
            if (command.type === "TIME") {
                priorityCommands.push(command);
                continue;
            }

            if (command.type === 'EVAL') {
                // [MODIFIED] Safely parse the function name from the params string.
                const funcName = (command.params.split(',')[0] || '').trim().replace(/"/g, '');
                const funcDef = funcDefMap.get(funcName);
                
                if (funcDef?.order === 'first') {
                    firstEvalItems.push({ command, funcDef });
                } else if (funcDef?.order === 'last') {
                    lastEvalItems.push({ command, funcDef });
                } else {
                    normalCommands.push(command);
                }
            } else {
                normalCommands.push(command);
            }
        }

        const sortBySequence = (a, b) => (a.funcDef.sequence || 0) - (b.funcDef.sequence || 0);
        firstEvalItems.sort(sortBySequence);
        lastEvalItems.sort(sortBySequence);

        const firstCommands = firstEvalItems.map(item => item.command);
        const lastCommands = lastEvalItems.map(item => item.command);

        console.log(`[SAM] Executing ${priorityCommands.length} priority commands (e.g., TIME).`);
        await applyCommandsToState(priorityCommands, state);
        console.log(`[SAM] Executing ${firstCommands.length} 'first' order commands.`);
        await applyCommandsToState(firstCommands, state);
        console.log(`[SAM] Executing ${normalCommands.length} normal order commands.`);
        await applyCommandsToState(normalCommands, state);
        console.log(`[SAM] Executing ${lastCommands.length} 'last' order commands.`);
        await applyCommandsToState(lastCommands, state);
        
        return state;
    }


    // --- MAIN HANDLERS ---
    async function processMessageState(index) {
        console.log(`[SAM] processing message state at ${index}`);

        if (isProcessingState) {
            console.warn(`[SAM] Aborting processMessageState: Already processing.`);
            return;
        }
        isProcessingState = true;
        
        try {
            if (index === "{{lastMessageId}}"){
                index = SillyTavern.chat.length - 1;
            }
            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) return;
            
            var state = await getVariables();
            if (state){
                state = state.SAM_data; 
            }

            const promotedCommands = await processVolatileUpdates(state);
            
            const messageContent = lastAIMessage.mes;
            COMMAND_REGEX.lastIndex = 0; 
            let match;
            const newCommands = [];
            // [MODIFIED] The parsing loop now uses numbered capture groups and normalizes the command type to uppercase.
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({type: match[1].toUpperCase(), params: match[2].trim()});
            }
            
            const allMessageCommands = [...promotedCommands, ...newCommands];
            console.log(`[SAM] ---- Found ${allMessageCommands.length} command(s) to process (incl. volatile) ----`);
            
            const newState = await executeCommandPipeline(allMessageCommands, state);

            await updateVariablesWith(variables => {_.set(variables, "SAM_data", goodCopy(newState));return variables});

            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
            const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;
            
            await setChatMessage({message: finalContent}, index, "display_current");

        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error in processMessageState for index ${index}:`, error);
        } finally {
            console.log("[SAM] update finished");
            isProcessingState = false;
        }
    }

    async function loadStateFromMessage(index) {
        if (index === "{{lastMessageId}}") {
            index = SillyTavern.chat.length - 1;
        }

        try {
            const message = SillyTavern.chat[index];
            if (!message) return;
            const state = parseStateFromMessage(message.mes);
            
            if (state) {
                console.log(`[SAM] replacing variables with found state at index ${index}`);
                await updateVariablesWith(variables => {_.set(variables, "SAM_data", goodCopy(state));return variables});
                
            } else {
                console.log("[SAM] did not find valid state at index, replacing with latest state")
                const chatHistory = SillyTavern.chat;
                const lastKnownState = await findLatestState(chatHistory, index);
                await updateVariablesWith(variables => {_.set(variables, "SAM_data", goodCopy(lastKnownState));return variables});
            }

        } catch (e) {
            console.log(`[${SCRIPT_NAME}] Load state from message failed for index ${index}:`, e);
        }
    }
    
    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;

        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user === false) return i;
        }
        return -1;
    }

    // brief function to help sync.
    async function sync_latest_state(){
        var lastlastAIMessageIdx = await findLastAiMessageAndIndex();
        await loadStateFromMessage(lastlastAIMessageIdx);
    }

    // handlers are requested to pass their event (tavern_events... and related information (ex. ev, options, dry_run...) to the dispatcher.
    // specifically the handler to handle generation_begin will have to pass event, ev, options, dry_run to the dispatcher.
    // actually a mealy machine. State updates and processing happens in same cycle.
    async function dispatcher(event, ...event_params){

        console.log(
        `[SAM] [FSM Dispatcher] FSM Dispatcher called from event ${event} with params ${JSON.stringify(event_params)}.
        stats: 
        current state = ${curr_state}
        Dispatcher invoked at time = ${Date()}
        current chat length = ${SillyTavern.chat.length}
        `);

        // restructure 1: To Mealy FSM

        try{

            switch(curr_state){

                case STATES.IDLE: {

                    switch (event) {
                        case tavern_events.GENERATION_STARTED: {

                            // do nothing if it is a dry run
                            if (event_params[2]) {
                                console.log("[SAM] [IDLE handler] Dry run detected, aborting FSM Dispatcher");
                                return;
                            }


                            if (event_params[0] === "swipe" || event_params[0] === "regenerate" ){

                                console.log(`[SAM] [IDLE handler] ${event_params[0]} detected. RE/GENERATE during IDLE detected. Loading from before latest user msg.`);
                                const latestUserMsg = findLatestUserMsgIndex();
                                await loadStateFromMessage(latestUserMsg);

                            }

                            // generally do nothing here. We transition to waiting for generation
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();

                            break;
                        }

                        case tavern_events.MESSAGE_SENT : {
                            // message is being sent. 
                            
                            curr_state = STATES.AWAIT_GENERATION;
                            break;

                        }

                        case tavern_events.MESSAGE_SWIPED : {

                            try{

                            await sync_latest_state();
                            

                            }catch(e){
                                console.log(`[SAM][IDLE handler] Message swiped error: ${e}`)
                            }

                            break;
                        }

                        default:
                            console.log("[SAM] [IDLE handler] Reloading state.");
                            await sync_latest_state();
                            break;       
                    }
                    break;
                }

                
                case STATES.AWAIT_GENERATION: {

                    switch (event){

                        case tavern_events.GENERATION_STOPPED:     
                        case FORCE_PROCESS_COMPLETION:     
                        case tavern_events.GENERATION_ENDED: {

                            stopGenerationWatcher();
                            curr_state = STATES.PROCESSING;

                            console.log("[SAM] [AWAIT_GENERATION handler] Deciphering latest message");
                            const index = SillyTavern.chat.length - 1;
                            await processMessageState(index);


                            console.log('[SAM] [AWAIT_GENERATION handler] Processing complete. Transitioning back to IDLE.');
                            curr_state = STATES.IDLE;
                            break;
                        }
                        case tavern_events.CHAT_CHANGED: {
                            stopGenerationWatcher();
                            console.log('[SAM] [AWAIT_GENERATION handler] Chat changed during generation. Aborting and returning to IDLE.');
                            await sync_latest_state();
                            curr_state = STATES.IDLE;
                            break;
                        }

                    }
                    break;
                }

                case STATES.PROCESSING: {
                    console.warn(`[SAM] [PROCESSING handler] Received event ${event} while in PROCESSING state. Ignoring.`);
                    break;
                }

            }


        }catch(e){
            stopGenerationWatcher();
            console.log(`[SAM] [Dispatcher] FSM Scheduling failed. Error reason: ${e}`);
        }
    }




    // --- MAIN EXECUTION & UNIFIED EVENT HANDLER ---

    // A lock to ensure only one event is being processed by the dispatcher at a time.
    let isDispatching = false;

    async function unifiedEventHandler(event, ...args) {

        // guard for multiple triggering
        if ((sessionStorage.getItem(SESSION_STORAGE_KEY)) && (session_id !== sessionStorage.getItem(SESSION_STORAGE_KEY))){
            console.warn(
            `[SAM] Session mismatch detected! current session key == ${session_id} while got session key ${sessionStorage.getItem(SESSION_STORAGE_KEY)}.
            Aborting event sequence for event ${JSON.stringify(event)}`);
            return;
        }
        
        // move on to event queue-based handling to not miss a single generation_stopped or something like that.
        // when received, push one event out. then re-invoke if there is still thing in the queue.
        console.log(`[SAM] [Unified event handler] pushing next EVENT [${event}] to queue and invoking executor [UDE].`);
        event_queue.push({event_id: event, args: [...args]});
        await unified_dispatch_executor(); // Kick off the processor, which will only run if not already running. Todo: SHOULD THIS BE AWAITED?
    }


    async function unified_dispatch_executor(){
        console.log("[SAM] unified dispatch executor running");
        
        if (isDispatching){
            console.warn("[SAM] already running dispatcher.");
            return;

        }
        isDispatching = true;

        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift(); // Get the oldest event
            console.log(`[SAM] [Unified Event Executor] Dequeuing and dispatching event: ${event_id}`);
            try {
                await dispatcher(event_id, ...args);
            } catch (error) {
                console.error(`[SAM] [Unified Event Executor] Unhandled error during dispatch of ${event_id}:`, error);
                curr_state = STATES.IDLE; // Failsafe reset
            }
        }

        isDispatching = false;
        console.log(`[SAM] [Unified Event Executor] Queue empty. Processor going idle.`);

    }


    const handlers = {
            // We need to keep a reference to the anonymous functions to be able to remove them later.
            handleGenerationStarted: async (ev, options, dry_run) => {
                
                await unifiedEventHandler(tavern_events.GENERATION_STARTED, ev, options,dry_run)
            
            },
            handleGenerationEnded: async () => {



                await unifiedEventHandler(tavern_events.GENERATION_ENDED)
            
            },
            handleMessageSwiped: async () => {

                await unifiedEventHandler(tavern_events.MESSAGE_SWIPED)
            
            },
            handleMessageDeleted: async (message) => {
                await unifiedEventHandler(tavern_events.MESSAGE_DELETED, message);
            },

            handleMessageEdited: async () => {

                await unifiedEventHandler(tavern_events.MESSAGE_EDITED)
            },
            handleChatChanged: async  () => {

                await unifiedEventHandler(tavern_events.CHAT_CHANGED)
            },
            handleMessageSent: async () => {

                await unifiedEventHandler(tavern_events.MESSAGE_SENT)
            },
            handleGenerationStopped : async () => {


                await unifiedEventHandler(tavern_events.GENERATION_STOPPED)
            },
            
            handleCleanup : async () => {
                // directly define this function to handle cleanup.
                // this will clean up existing SAM listeners, including itself.
                // first await a short time
                

                // get lorebook entry.
                console.log("[SAM] [Cleanup crew] Trying to determine if this is a SAM card.");
                var char_lorebook = await getCharLorebooks();

                if (!char_lorebook){
                    return;
                }

                var entries = await getLorebookEntries(char_lorebook.primary);
                if (!entries){
                    return;
                }

                var found_ID = false;

                for(let entry of entries){
                    if (!entry.comment){
                        continue;
                    }
                    

                    if (entry.comment.trim().toLowerCase() === "SAM_IDENTIFIER".toLowerCase()){
                        found_ID = true;
                    }
                }

                // execution part. Test first
                if (found_ID) {
                    console.log("[SAM] [Cleanup crew] Identified SAM card. Cleanup crew will not clean its SAM listeners");
                }else{
                    console.log("[SAM] [Cleanup crew] Identified NON-SAM card. Cleanup crew will clean all Listeners.");
                    // first wait for 1.5s for slow updates
                    eventRemoveListener(handlers.handleChatChanged);
                    eventRemoveListener(handlers.handleCleanup);
                    eventRemoveListener(handlers.handleGenerationEnded);
                    eventRemoveListener(handlers.handleGenerationStarted);
                    eventRemoveListener(handlers.handleGenerationStopped);
                    eventRemoveListener(handlers.handleMessageDeleted);
                    eventRemoveListener(handlers.handleMessageEdited);
                    eventRemoveListener(handlers.handleMessageSent);
                    eventRemoveListener(handlers.handleMessageSwiped);
                    


                }




            }

        };

    $(() => {
        // This is the main entry point of the script.
        cleanupPreviousInstance();

        // Step 2: Define a standalone initialization function for the first load.
        // This logic is called once on startup or chat change, outside the main FSM event loop.
        const initializeOrReloadStateForCurrentChat = async () => {

            let latestAIPos = await findLastAiMessageAndIndex();


            console.log("[SAM] Initializing or reloading state for current chat.");
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) {
                console.log(`[${SCRIPT_NAME}] No AI messages found. Initializing with default state.`);

                // all replace variables should be insert or assign variables to SAM_data
                // in turns, all reads should be from SAM_data
                await updateVariablesWith(variables => {_.set(variables, "SAM_data", _.cloneDeep(INITIAL_STATE));return variables});


                //await replaceVariables(_.cloneDeep(INITIAL_STATE));
            } else {
                await loadStateFromMessage(lastAiIndex);
            }
            console.log("[SAM] initialization finalized")
        };

        // Step 3: Register the new event listeners, routing them through the unified handler.
        console.log(`[${SCRIPT_NAME}] Registering new event listeners via the Unified Handler.`);

        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);

        // Step 4: Store a reference to the new handlers on the window object.
        window[HANDLER_STORAGE_KEY] = handlers;
        
        // Step 5: Initialize the state for the newly loaded chat.
        try {
            console.log(`[${SCRIPT_NAME}] V3.2.0 (Refactored) loaded. GLHF, player.`);
            initializeOrReloadStateForCurrentChat();
            session_id = JSON.stringify(new Date());
            sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);
            console.log(`[SAM] Assigned new session ID: ${session_id}` );

        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during final initialization:`, error);
        }
    });

})()
