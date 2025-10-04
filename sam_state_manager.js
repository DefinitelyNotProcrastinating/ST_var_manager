// ============================================================================
// == Situational Awareness Manager
// == Version: 3.3.0 "Foundations"
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It correctly handles state during swipes and regenerations by using
// == the GENERATION_STARTED event to prepare the state, fixing race conditions.
// == It also includes a sandboxed EVAL command for user-defined functions,
// == now with support for execution ordering and periodic execution.
// == It now features a comprehensive logging system and recovery tools.
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
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const COMMAND_REGEX = /^\s*@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\b\s*\((.*)\)\s*;?\s*$/gim;
    const INITIAL_STATE = { static: {}, time: "",volatile: [], responseSummary: [], func: [] };

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
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
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
                return { static: parsed.static ?? {}, time: parsed.time ?? "", volatile: parsed.volatile ?? [], responseSummary: parsed.responseSummary ?? [], func: parsed.func ?? [] };
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
    function goodCopy(state) { return _.cloneDeep(state) ?? _.cloneDeep(INITIAL_STATE); }

    // [NEW] Helper function to get base data from World Info
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
    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;
        const currentRound = await getRoundCounter();
        let modifiedListPaths = new Set();
        for (const command of commands) {
            let params;
            try {
                const paramsString = command.params.trim();
                params = paramsString ? JSON.parse(`[${paramsString}]`) : [];
            } catch (error) {
                logger.error(`Failed to parse parameters for command ${command.type}. Params: "${command.params}"`, error);
                continue;
            }
            try {
                switch (command.type) {
                    case 'SET': { _.set(state.static, params[0], params[1]); break; }
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
                            break;
                        }
                        const targetIndex = _.findIndex(list, { [selProp]: selVal });
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            const existing = _.get(state.static, fullPath);
                            if (Array.isArray(existing)) {
                                existing.push(valToAdd); // Must get reference and push for arrays
                            } else {
                                const newValue = (Number(existing) || 0) + Number(valToAdd);
                                _.set(state.static, fullPath, newValue);
                            }
                        } else {
                            logger.warn(`[SAM] SELECT_ADD failed: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'SELECT_SET': {
                        const [listPath, selProp, selVal, recProp, valToSet] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            logger.warn(`[SAM] SELECT_SET failed: Path "${listPath}" is not a list.`);
                            break;
                        }
                        const targetIndex = _.findIndex(list, (item) => _.get(item, selProp) == selVal);

                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            _.set(state.static, fullPath, valToSet);
                            
                        } else {
                            logger.warn(`[SAM] SELECT_SET failed to find object: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
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
    async function processMessageState(index) {
        logger.info(`processing message state at ${index}`);
        if (isProcessingState) { logger.warn("Aborting processMessageState: Already processing."); return; }
        isProcessingState = true;
        try {
            if (index === "{{lastMessageId}}") { index = SillyTavern.chat.length - 1; }
            
            var state = (await getVariables()).SAM_data;

            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) return;

            const promotedCommands = await processVolatileUpdates(state);
            const messageContent = lastAIMessage.mes;
            COMMAND_REGEX.lastIndex = 0;
            let match;
            const newCommands = [];
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({ type: match[1].toUpperCase(), params: match[2].trim() });
            }
            const allMessageCommands = [...promotedCommands, ...newCommands];
            logger.info(`---- Found ${allMessageCommands.length} command(s) to process (incl. volatile) ----`);
            const newState = await executeCommandPipeline(allMessageCommands, state);
            await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newState)); return variables });
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
            const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;
            await setChatMessage({ message: finalContent }, index, "display_current");
        } catch (error) {
            logger.error(`Error in processMessageState for index ${index}:`, error);
        } finally {
            logger.info("update finished");
            isProcessingState = false;
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
        if (!lastMessage.mes.includes(STATE_BLOCK_START_MARKER)) {
            const warningMsg = "Stuck State Detected: The last AI message is missing its state block. The next turn will use the previous state. This may cause inconsistencies. Consider using the 'Reset State' or 'Rerun Commands' debug buttons if issues persist.";
            logger.error(`STUCK STATE DETECTED! Message at index ${SillyTavern.chat.length - 1} did not contain a state block after processing. please RESET the current state and MANUALLY update the variables.`);
            toastr.error(warningMsg);
        }
    }
    async function dispatcher(event, ...event_params) {
        logger.info(`[FSM Dispatcher] Event: ${event}, State: ${curr_state}`);
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
        if ((sessionStorage.getItem(SESSION_STORAGE_KEY)) && (session_id !== sessionStorage.getItem(SESSION_STORAGE_KEY))) {
            logger.warn(`Session mismatch! current: ${session_id}, storage: ${sessionStorage.getItem(SESSION_STORAGE_KEY)}. Aborting event ${JSON.stringify(event)}`);
            return;
        }
        event_queue.push({ event_id: event, args: [...args] });
        await unified_dispatch_executor();
    }
    async function unified_dispatch_executor() {
        if (isDispatching) { return; }
        isDispatching = true;
        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift();
            logger.info(`[UDE] Dequeuing and dispatching event: ${event_id}`);
            try { await dispatcher(event_id, ...args); }
            catch (error) {
                logger.error(`[UDE] Unhandled error during dispatch of ${event_id}:`, error);
                curr_state = STATES.IDLE;
            }
        }
        isDispatching = false;
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
			}, 100);
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

    // [NEW] Debugging and Recovery Functions
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
            COMMAND_REGEX.lastIndex = 0;
            let match;
            const newCommands = [];
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({ type: match[1].toUpperCase(), params: match[2].trim() });
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
            logger.info(`V3.3.0 "Foundations" loaded. GLHF, player.`);
            initializeOrReloadStateForCurrentChat();
            session_id = JSON.stringify(new Date());
            sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);
            logger.info(`Assigned new session ID: ${session_id}`);
        } catch (error) {
            logger.error("Error during final initialization:", error);
        }
    });

})()