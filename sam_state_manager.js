// ============================================================================
// == Situational Awareness Manager
// == Version: 3.0.0 
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It correctly handles state during swipes and regenerations by using
// == the GENERATION_STARTED event to prepare the state, fixing race conditions.
// == It also includes a sandboxed EVAL command for user-defined functions.
// ==
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

// bug : "fake-swipe" -> it does not actually reset the state.
// upon swipe, it first sends THEN reloads the state...
// therefore we must restructure it into a "real-swipe".

// The idea is to refactor it to:
// State N = State N-1 + Delta_state N
// Then, upon load, we compute 


(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\s*::\s*(?<params>.*?)>/gs;
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [], func: [] };
    let isProcessingState = false;

    // impossible to see ended -> ended -> ended -> ended.....
    // therefore we only take the first ended. -> we detect this only if the previous detected EVENT is NOT ended.


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





    // --- SCRIPT LIFECYCLE MANAGEMENT ---
    // This key is used to store our event handlers on the global window object.
    // This allows a new instance of the script to find and remove the listeners
    // from an old instance, preventing the "multiple listener" bug on script reloads.
    const HANDLER_STORAGE_KEY = `__SAM_V3_EVENT_HANDLERS__`;

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


    // --- Command Explanations ---
    // SET:          Sets a variable to a value. <SET :: path.to.var :: value>
    // ADD:          Adds a number to a variable, or an item to a list. <ADD :: path.to.var :: value>
    // DEL:          Deletes an item from a list by its numerical index. <DEL :: list_path :: index>
    // REMOVE:       Removes item(s) from a list where a property matches a value. <REMOVE :: list_path :: property's relative path :: value>
    // TIMED_SET:    Schedules a SET command. <TIMED_SET :: path.to.var :: new_value :: reason :: is_real_time? :: timepoint>
    // CANCEL_SET:   Cancels a scheduled TIMED_SET. <CANCEL_SET :: index or reason>
    // RESPONSE_SUMMARY: Adds a summary of the AI's response to a list. <RESPONSE_SUMMARY :: text>
    //
    // EVAL command documentation
    // EVAL:         Executes a user-defined function stored in the state.
    // Syntax:       <EVAL :: function_name :: param1 :: param2 :: ...>
    // WARNING: DANGEROUS FUNCTIONALITY. KNOW WHAT YOU ARE DOING, I WILL NOT TAKE RESPONSIBILITY FOR YOUR FAILURES AS STATED IN LICENSE.
    // YOU HAVE BEEN WARNED.
    /* ... (rest of documentation) ... */

    // --- HELPER FUNCTIONS ---
    async function getRoundCounter(){
        return SillyTavern.chat.length -1;
    }

    function tryParseJSON(str) {
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
                    func: parsed.func ?? []
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


    // not going to be used anymore when we have swipe length detection. 
    // it does not accurately detect swipes to unknown space. We need to detect swipes to non-existent previous indices
    // to know that we're swiping to generate a new response. 
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
        const paramNames = funcDef.func_params || [];

        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;

                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...paramNames];
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];

                const functionBody = `'use strict';\n${funcDef.func_body}`;
                const userFunction = new Function(...argNames, functionBody);

                const result = await userFunction.apply(null, argValues);
                resolve(result);

            } catch (error) {
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
    // Todo: Process volatile updates for all the operations.
    // this includes SET, REMOVE, DEL,... 
    // TIMED syntax will change to <TIMED :: is_game_time? :: time :: reason :: [actual command]>
    // to increase the flexibility of the TIMED command.
    // you can even TIMED another TIMED because of this.
    // to do this, you must make time a level 1 variable in your static.
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
                promotedCommands.push({ type: 'SET', params: `${varName} :: ${varValue}` });
            } else {

                if (targetTime) {

                }

                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }

    async function applyCommandsToState(commands, state) {
        const currentRound = await getRoundCounter();

        // keep all the modified list paths here.
        let modifiedListPaths = new Set();
        

        for (const command of commands) {
            let params = command.params.split('::').map(p => p.trim());
            
            try {
                switch (command.type) {
                    case 'SET': {
                        let [varName, varValue] = params;
                        if (!varName || varValue === undefined) continue;
                        varValue = tryParseJSON(varValue);
                         if (typeof varValue === 'string') {
                            const lowerVar = varValue.trim().toLowerCase();
                            if (lowerVar === "true") varValue = true;
                            else if (lowerVar === "false") varValue = false;
                            else if (lowerVar === "null") varValue = null;
                            else if (lowerVar === "undefined") varValue = undefined;
                        }
                        _.set(state.static, varName, isNaN(Number(varValue)) ? varValue : Number(varValue));
                        break;
                    }
                    case 'ADD': {
                        const [varName, incrementStr] = params;
                        if (!varName || incrementStr === undefined) continue;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) {
                            existing.push(tryParseJSON(incrementStr));
                        } else {
                            const increment = Number(incrementStr);
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
                        if (!state.responseSummary.includes(command.params.trim())){
                           state.responseSummary.push(command.params.trim());
                        }
                        break;
                    }
                    case 'TIMED_SET': {

                        const [varName, varValue, reason, isGameTimeStr, timeUnitsStr] = params;
                        
                        if (!varName || !varValue || !reason || !isGameTimeStr || !timeUnitsStr) continue;
                        
                        const isGameTime = isGameTimeStr.toLowerCase() === 'true' || isGameTimeStr === 1;
                        
                        const finalValue = isNaN(varValue) ? tryParseJSON(varValue) : Number(varValue);
                        
                        const targetTime = isGameTime ? new Date(timeUnitsStr).toISOString() : currentRound + Number(timeUnitsStr);
                        
                        if(!state.volatile) state.volatile = [];
                        
                        state.volatile.push([varName, finalValue, isGameTime, targetTime, reason]);
                        
                        break;
                    }
                    case 'CANCEL_SET': {
                        if (!params[0] || !state.volatile?.length) continue;
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
                        const [listPath, indexStr] = params;
                        
                        if (!listPath || indexStr === undefined) continue;
                        
                        const index = parseInt(indexStr, 10);
                        
                        if (isNaN(index)) continue;
                        
                        const list = _.get(state.static, listPath);

                        if (!Array.isArray(list)) continue;
                        
                        if (index >= 0 && index < list.length) {
                            list[index] = undefined;
                            modifiedListPaths.add(listPath);
                        }
                        
                        break;
                    }
                    case 'REMOVE': {
                        const [listPath, identifier, targetId] = params;
                        if (!listPath || !identifier || targetId === undefined) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        _.set(state.static, listPath, _.reject(list, {[identifier]: tryParseJSON(targetId)}));
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = params;
                        if (!funcName) {
                            console.warn(`[${SCRIPT_NAME}] EVAL aborted: EVAL command requires a function name.`);
                            continue;
                        }
                        await runSandboxedFunction(funcName, funcParams, state);
                        break;
                    }
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error processing command: ${JSON.stringify(command)}`, error);
            }
        }

        // handle DELs properly.
        for (const path of modifiedListPaths){
            const list = _.get(state.static, path);
            _.remove(list, (item) => item === undefined);
        }

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
            
            // state now loads from SAM_data and whatever we get will be written to SAM_data
            if (state){
                state = state.SAM_data; 
            }

            const promotedCommands = await processVolatileUpdates(state);
            const messageContent = lastAIMessage.mes;

            COMMAND_REGEX.lastIndex = 0; 

            let match;
            const newCommands = [];
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({type: match.groups.type, params: match.groups.params});
            }
            
            console.log(`[SAM] ---- Found ${newCommands.length} command(s) to process ----`);
            
            const newState = await applyCommandsToState([...promotedCommands, ...newCommands], state); 
            
            //await replaceVariables(goodCopy(newState));
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
                //await replaceVariables(goodCopy(state));
                await updateVariablesWith(variables => {_.set(variables, "SAM_data", goodCopy(state));return variables});
                
            } else {
                console.log("[SAM] did not find valid state at index, replacing with latest state")
                const chatHistory = SillyTavern.chat;
                const lastKnownState = await findLatestState(chatHistory, index);
                //await replaceVariables(goodCopy(lastKnownState));
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


                            if (event_params[0] === "swipe" ){

                                console.log("[SAM] [IDLE handler] Swipe generate to GENERATE during IDLE detected. Loading from before latest user msg.");
                                const latestUserMsg = await findLatestUserMsgIndex();
                                await loadStateFromMessage(latestUserMsg);

                            }

                            // generally do nothing here. We transition to waiting for generation
                            curr_state = STATES.AWAIT_GENERATION;

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
                        case tavern_events.GENERATION_ENDED: {
                            curr_state = STATES.PROCESSING;

                            console.log("[SAM] [AWAIT_GENERATION handler] Deciphering latest message");
                            const index = SillyTavern.chat.length - 1;
                            await processMessageState(index);


                            console.log('[SAM] [AWAIT_GENERATION handler] Processing complete. Transitioning back to IDLE.');
                            curr_state = STATES.IDLE;
                            break;
                        }
                        case tavern_events.CHAT_CHANGED: {
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
            console.log(`[SAM] [Dispatcher] FSM Scheduling failed. Error reason: ${e}`);
        }
    }




    // --- MAIN EXECUTION & UNIFIED EVENT HANDLER ---

    // A lock to ensure only one event is being processed by the dispatcher at a time.
    let isDispatching = false;

    async function unifiedEventHandler(event, ...args) {
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

        // Step 1: Clean up any listeners from a previous version of the script.
        // This is crucial to prevent "ghost" listeners that cause events to fire multiple times.

        // - Did not work, still suffers from multiple listener and script unload but listener still working
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

        // make first the generation_started event.
        // this is actually a gamble. We think that generation started also binds Zonde's Prompt Template plugin upon generation, so we must
        // do variable updates earlier than Prompt Template processes the text (otherwise our update is not meaningful).
        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);

        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleCleanup);

        // Step 4: Store a reference to the new handlers on the window object.
        // This allows the *next* script reload to find and clean up this instance.
        window[HANDLER_STORAGE_KEY] = handlers;
        
        // Step 5: Initialize the state for the newly loaded chat.
        try {
            console.log(`[${SCRIPT_NAME}] V3.0.0 loaded. GLHF, player.`);
            initializeOrReloadStateForCurrentChat();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during final initialization:`, error);
        }
    });

})()
