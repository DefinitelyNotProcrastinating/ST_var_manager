// ============================================================================
// == Situational Awareness Manager (SAM)
// == Version: 4.0.0 "Lepton"
// ==
// == Refactored for O(N) space efficiency and O(N) time efficiency via SillyTavern Native Macros. I never thought I have to trade time for space.
// ==
// == This script listens for AI commands, calculates the result based on
// == current variables, and injects a SillyTavern-compatible {{setvar}}
// == macro back into the message.
// ==
// == REQUIRES SILLYTAVERN REGEX:
// == Replace: /@\.<setvar::(.*?)::(.*?)>\.@/g
// == With:    {{setvar::$1::$2}}
// ============================================================================

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "SAM v4.0.0";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";
    
    // Command Parsing
    const COMMAND_START_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVENT_BEGIN|EVENT_END|EVENT_ADD_PROC|EVENT_ADD_DEFN|EVENT_ADD_MEMBER|EVENT_SUMMARY|EVAL)\b\s*\(/gim;

    // Macro Formatting
    const MACRO_START = "@.<setvar::";
    const MACRO_SEP = "::";
    const MACRO_END = ">.@";

    // --- STATE & LIFECYCLE MANAGEMENT ---
    let isProcessing = false;
    let generationWatcherId = null;

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };
    var curr_state = STATES.IDLE;
    const WATCHER_INTERVAL_MS = 3000;
    
    // Logging
    const logger = {
        info: (...args) => console.log(`[${SCRIPT_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME}]`, ...args)
    };

    // --- HELPER FUNCTIONS ---

    // Load external library for JSON repair if needed
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

    // Multiline-safe parameter extractor
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
                    while (j >= startIndex && text[j] === '\\') { backslashCount++; j--; }
                    if (backslashCount % 2 === 0) inString = false;
                }
            } else {
                if (c === '"' || c === "'" || c === '`') { inString = true; quoteChar = c; }
                else if (c === '(') depth++;
                else if (c === ')') depth--;
            }
            i++;
        }
        
        if (depth === 0) return { params: text.substring(startIndex, i - 1), endIndex: i };
        return null;
    }

    // --- DATA HANDLING ---

    // Retrieve all variables from SillyTavern's global store
    function getAllVariables() {
        // Compatibility with various ST versions/extensions
        if (typeof SillyTavern.getContext === 'function') {
            const ctx = SillyTavern.getContext();
            if (ctx && ctx.variables) return ctx.variables;
        }
        if (SillyTavern.extension_settings && SillyTavern.extension_settings.variables) {
            return SillyTavern.extension_settings.variables;
        }
        // Fallback for older versions or if slash runner isn't syncing
        return window.variables || {}; 
    }

    // Create the output string string: @.<setvar::name::json_value>.@
    function createSetVarString(rootKey, value) {
        // We always stringify the value to handle objects/arrays/numbers correctly within the macro
        const jsonVal = JSON.stringify(value);
        return `${MACRO_START}${rootKey}${MACRO_SEP}${jsonVal}${MACRO_END}`;
    }

    // --- CORE LOGIC ---

    // Check for timed events (VOLATILE) stored in SAM_volatile variable
    function processVolatileTimers(workingVars) {
        const volatileList = _.get(workingVars, 'SAM_volatile', []);
        if (!Array.isArray(volatileList) || volatileList.length === 0) return [];

        const currentRound = SillyTavern.chat.length - 1; // Approx
        const now = new Date();
        const remainingVolatiles = [];
        const triggeredCommands = [];

        volatileList.forEach(entry => {
            const [varName, varValue, isRealTime, targetTime, reason] = entry;
            let triggered = false;

            if (isRealTime) {
                triggered = now >= new Date(targetTime);
            } else {
                triggered = currentRound >= parseInt(targetTime);
            }

            if (triggered) {
                logger.info(`[SAM] Timer triggered: Setting ${varName} to`, varValue);
                // Create a synthetic command to executed immediately
                const params = `${JSON.stringify(varName)}, ${JSON.stringify(varValue)}`;
                triggeredCommands.push({ type: 'SET', params: params, isInternal: true });
            } else {
                remainingVolatiles.push(entry);
            }
        });

        // Update the volatile list in working vars
        if (triggeredCommands.length > 0) {
            _.set(workingVars, 'SAM_volatile', remainingVolatiles);
        }

        return triggeredCommands;
    }

    async function runSandboxedFunction(funcName, params, workingVars) {
        // Function definitions are stored in SAM_func variable
        const funcList = _.get(workingVars, 'SAM_func', []);
        const funcDef = funcList.find(f => f.func_name === funcName);
        
        if (!funcDef) { logger.warn(`EVAL: Function '${funcName}' not found in SAM_func.`); return null; }

        const timeout = funcDef.timeout ?? 2000;
        
        return new Promise(async (resolve) => {
            try {
                // We pass workingVars as 'state'. The function should return a delta object: { "path.to.var": newValue }
                const bodyPrologue = `const args = Array.from(arguments);`;
                const functionBody = `'use strict';\n${funcDef.func_body}`;
                
                // Construct the function
                const userFunction = new Function('state', 'args', 'fetch', functionBody);
                
                // Mock fetch if no network access (security)
                const fetchImpl = funcDef.network_access ? window.fetch.bind(window) : () => Promise.reject("Network disabled");

                // Execute with timeout race
                const result = await Promise.race([
                    Promise.resolve(userFunction(workingVars, params, fetchImpl)),
                    new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), timeout))
                ]);

                resolve(result);
            } catch (err) {
                logger.error(`EVAL Error in ${funcName}:`, err);
                resolve(null);
            }
        });
    }

    async function processMessage(index) {
        if (isProcessing) return;
        isProcessing = true;

        try {
            if (index === "{{lastMessageId}}") index = SillyTavern.chat.length - 1;
            const message = SillyTavern.chat[index];
            if (!message || message.is_user) { isProcessing = false; return; }

            let content = message.mes;
            let hasChanges = false;
            let replacements = [];

            // 1. Snapshot current variables (Deep Clone to handle sequential logic in O(1) read)
            let workingVars = _.cloneDeep(getAllVariables());

            // 2. Process Volatile Timers first
            const timerCommands = processVolatileTimers(workingVars);
            
            // 3. Find Commands in Message
            COMMAND_START_REGEX.lastIndex = 0;
            let match;
            const foundCommands = [];

            while ((match = COMMAND_START_REGEX.exec(content)) !== null) {
                const commandType = match[1].toUpperCase();
                const openParenIndex = match.index + match[0].length;
                const extraction = extractBalancedParams(content, openParenIndex);
                
                if (extraction) {
                    foundCommands.push({
                        type: commandType,
                        params: extraction.params.trim(),
                        start: match.index,
                        end: extraction.endIndex,
                        original: content.substring(match.index, extraction.endIndex)
                    });
                    COMMAND_START_REGEX.lastIndex = extraction.endIndex;
                }
            }

            // Combine Timer commands (executed virtually) and Message commands
            // We append timer updates to the message content at the end
            
            const allCommands = [...timerCommands, ...foundCommands];

            // 4. Execute Logic on workingVars
            for (const cmd of allCommands) {
                let params;
                // Parse Parameters
                try {
                    params = JSON.parse(`[${cmd.params}]`);
                } catch (e) {
                    if (window.jsonrepair) {
                        params = JSON.parse(window.jsonrepair(`[${cmd.params}]`));
                    } else {
                        await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                        params = JSON.parse(window.jsonrepair(`[${cmd.params}]`));
                    }
                }

                // Execute Logic
                try {
                    // Logic to update workingVars
                    // We only generate a replacement string for the explicit message commands
                    // For timer commands, we generate a setvar to append later
                    
                    let rootKeyToUpdate = null; // The top-level key changed

                    switch (cmd.type) {
                        case 'SET':
                            _.set(workingVars, params[0], params[1]);
                            rootKeyToUpdate = params[0].split('.')[0];
                            break;
                        case 'ADD':
                            {
                                const [path, val] = params;
                                const existing = _.get(workingVars, path, 0);
                                if (Array.isArray(existing)) existing.push(val);
                                else _.set(workingVars, path, Number(existing) + Number(val));
                                rootKeyToUpdate = path.split('.')[0];
                            }
                            break;
                        case 'DEL':
                            {
                                const [path, idx] = params;
                                const list = _.get(workingVars, path);
                                if (Array.isArray(list)) {
                                    list.splice(idx, 1);
                                    rootKeyToUpdate = path.split('.')[0];
                                }
                            }
                            break;
                        case 'SELECT_SET':
                        case 'SELECT_ADD':
                            {
                                const [path, sKey, sVal, rKey, newVal] = params;
                                const list = _.get(workingVars, path);
                                if (Array.isArray(list)) {
                                    const item = list.find(x => _.get(x, sKey) == sVal);
                                    if (item) {
                                        if (cmd.type === 'SELECT_SET') _.set(item, rKey, newVal);
                                        else {
                                            const existing = _.get(item, rKey, 0);
                                            _.set(item, rKey, Number(existing) + Number(newVal));
                                        }
                                        rootKeyToUpdate = path.split('.')[0];
                                    }
                                }
                            }
                            break;
                        case 'TIMED_SET': 
                            {
                                // Add to SAM_volatile
                                const [p, v, r, isReal, t] = params;
                                const vol = _.get(workingVars, 'SAM_volatile', []);
                                const target = isReal ? new Date(t).toISOString() : (SillyTavern.chat.length + Number(t));
                                vol.push([p, v, isReal, target, r]);
                                _.set(workingVars, 'SAM_volatile', vol);
                                rootKeyToUpdate = 'SAM_volatile';
                            }
                            break;
                        case 'EVAL':
                            {
                                const [funcName, ...args] = params;
                                const delta = await runSandboxedFunction(funcName, args, workingVars);
                                if (delta && typeof delta === 'object') {
                                    // Eval returns a delta of changes. Apply them to working vars and prepare updates
                                    // Special handling: EVAL replaces the command text with multiple setvars
                                    let evalReplacements = "";
                                    for (const [k, v] of Object.entries(delta)) {
                                        _.set(workingVars, k, v);
                                        const root = k.split('.')[0];
                                        const fullVal = _.get(workingVars, root);
                                        evalReplacements += createSetVarString(root, fullVal);
                                    }
                                    if (!cmd.isInternal) {
                                        replacements.push({ start: cmd.start, end: cmd.end, text: evalReplacements });
                                    }
                                    rootKeyToUpdate = null; // Handled internally
                                }
                            }
                            break;
                        // ... Add other event handlers like EVENT_BEGIN here logic maps to SAM_events variable
                    }

                    // Generate Replacement String for this specific command
                    if (rootKeyToUpdate && !cmd.isInternal) {
                        const newValue = _.get(workingVars, rootKeyToUpdate);
                        const replacementString = createSetVarString(rootKeyToUpdate, newValue);
                        replacements.push({ start: cmd.start, end: cmd.end, text: replacementString });
                    }

                } catch (err) {
                    logger.error(`Error executing ${cmd.type}`, err);
                }
            }

            // 5. If we had internal commands (Timers) that changed state, we need to append those updates to the message
            // We check if SAM_volatile or other keys changed via internal commands
            // For simplicity in this O(n) logic, we just check if SAM_volatile changed compared to start
            const finalVolatile = _.get(workingVars, 'SAM_volatile');
            const startVolatile = _.get(getAllVariables(), 'SAM_volatile'); // Crude check
            
            let appendText = "";
            if (JSON.stringify(finalVolatile) !== JSON.stringify(startVolatile)) {
                appendText += "\n" + createSetVarString('SAM_volatile', finalVolatile);
                hasChanges = true;
            }

            // 6. Apply Text Replacements (Reverse order to maintain indices)
            replacements.sort((a, b) => b.start - a.start);
            
            for (const rep of replacements) {
                content = content.substring(0, rep.start) + rep.text + content.substring(rep.end);
                hasChanges = true;
            }

            content += appendText;

            // 7. Save back to ST if changed
            if (hasChanges) {
                logger.info(`[SAM] Updates applied. Injecting ${replacements.length} setvars.`);
                await setChatMessage({ message: content }, index, "display_current");
            }

        } catch (e) {
            logger.error("Critical error in processMessage", e);
        } finally {
            isProcessing = false;
        }
    }

    // --- DISPATCHER ---
    
    // Watcher: Ensures we catch the end of generation even if events miss (common on mobile)
    function startGenerationWatcher() {
        if (generationWatcherId) clearInterval(generationWatcherId);
        generationWatcherId = setInterval(() => {
            const isGenerating = $('#mes_stop').is(':visible');
            if (curr_state === STATES.AWAIT_GENERATION && !isGenerating) {
                logger.info('[Watcher] Generation stopped detected via UI check.');
                handleGenerationEnd();
            }
        }, WATCHER_INTERVAL_MS);
    }

    async function handleGenerationEnd() {
        if (generationWatcherId) clearInterval(generationWatcherId);
        if (curr_state === STATES.PROCESSING) return;
        
        curr_state = STATES.PROCESSING;
        // Small delay to ensure ST DOM is ready
        setTimeout(async () => {
            await processMessage("{{lastMessageId}}");
            curr_state = STATES.IDLE;
        }, 100);
    }

    // Main Event Handler
    const onGenerationStarted = () => {
        logger.info("[SAM] Generation Started.");
        curr_state = STATES.AWAIT_GENERATION;
        startGenerationWatcher();
    };

    const onGenerationStopped = () => {
        logger.info("[SAM] Generation Stopped Event.");
        handleGenerationEnd();
    };

    // --- INITIALIZATION ---

    $(() => {
        // Register Event Listeners
        // We use eventMakeFirst to ensure we capture start early
        // We handle logic primarily on STOP/END to rewrite the output
        
        if (typeof eventMakeFirst === 'function') {
            eventMakeFirst(tavern_events.GENERATION_STARTED, onGenerationStarted);
        } else {
            eventOn(tavern_events.GENERATION_STARTED, onGenerationStarted);
        }

        eventOn(tavern_events.GENERATION_STOPPED, onGenerationStopped);
        eventOn(tavern_events.GENERATION_ENDED, onGenerationStopped); // Failsafe
        
        // Manual Trigger
        eventOn(tavern_events.MESSAGE_SENT, () => {
            curr_state = STATES.AWAIT_GENERATION;
            startGenerationWatcher();
        });

        logger.info(`${SCRIPT_NAME} Loaded. GLHF,player.`);
    });

})();
