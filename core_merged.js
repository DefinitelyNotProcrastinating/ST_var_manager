// ==UserScript==
// @name         SAM Core Engine - Fully Integrated (Refactored)
// @version      6.2.2
// @description  SAM engine refactored to use RFC 6902 (JSON Patch) for all state operations, enhancing robustness and structure.
// @author       SAM Extension Team
// @match        *://*/*
// @grant        none
// ==/UserScript==

$((() => {
    "use strict";
  
    // ========================================================================
    // 1. 基础配置与标识常量
    // ========================================================================
    const INSTANCE_KEY = "__sam_core_widget_v6__";
    const STYLE_ID = "sam-core-widget-style";
    const WIDGET_ID = "sam-core-widget-root";
    const APP_NAME = "SAM 核心管理器";
    
    const SCRIPT_VERSION = "6.2.2 'Lone star'";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";
    const MINISEARCH_URL = "https://cdn.jsdelivr.net/npm/minisearch@6.3.0/dist/umd/index.min.js";
    
    // Regex to find and extract content from <UpdateVariable> blocks.
    const UPDATE_BLOCK_EXTRACT_REGEX = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gim;
    const UPDATE_BLOCK_REMOVE_REGEX = /<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gim;
    
    const INITIAL_STATE = { 
        static: {}, time: "", volatile:[], 
        responseSummary: { L1:[], L2: [], L3:[] }, 
        summary_progress: 0,
        jsondb: null,
        func: [], events:[], event_counter: 0 
    };
    
    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING", SUMMARIZING: "SUMMARIZING" };
    const SAM_FUNCTIONLIB_ID = "__SAM_IDENTIFIER__";
    const MODULE_NAME = 'sam_extension';
  
    // API Sources Constants
    const API_SOURCES = {
        OPENAI: 'openai', CLAUDE: 'claude', OPENROUTER: 'openrouter', AI21: 'ai21', MAKERSUITE: 'makersuite',
        VERTEXAI: 'vertexai', MISTRALAI: 'mistralai', CUSTOM: 'custom', COHERE: 'cohere', PERPLEXITY: 'perplexity',
        GROQ: 'groq', ZEROONEAI: '01ai', NANOGPT: 'nanogpt', DEEPSEEK: 'deepseek', AIMLAPI: 'aimlapi', XAI: 'xai', POLLINATIONS: 'pollinations',
    };
    const API_SOURCE_OPTIONS =[
        { value: 'custom', label: '自定义 / OpenAI 兼容' }, { value: 'makersuite', label: 'Google Makersuite (Gemini)' },
        { value: 'claude', label: 'Anthropic Claude' }, { value: 'mistralai', label: 'Mistral AI' },
        { value: 'openrouter', label: 'OpenRouter' }, { value: 'cohere', label: 'Cohere' },
        { value: 'perplexity', label: 'Perplexity' }, { value: 'groq', label: 'Groq' },
        { value: 'deepseek', label: 'DeepSeek' }, { value: '01ai', label: '01.AI' },
        { value: 'nanogpt', label: 'NanoGPT' }, { value: 'aimlapi', label: 'AI/ML API' },
        { value: 'xai', label: 'xAI (Grok)' }, { value: 'pollinations', label: 'Pollinations' },
        { value: 'vertexai', label: 'Google Vertex AI' }, { value: 'ai21', label: 'AI21' },
    ];
  
    // Default Settings
    const DEFAULT_SETTINGS = {
        data_enable: true,
        enable_auto_checkpoint: true,
        auto_checkpoint_frequency: 20,
        summary_api_preset: null,
        api_presets:[],
        summary_levels: {
            L1: { enabled: false, frequency: 20 },
            L2: { enabled: true, frequency: 20 },
            L3: { enabled: true, frequency: 5 }
        },
        skipWIAN_When_summarizing: false,
        regexes:[],
        summary_prompt: `请仔细审查下方提供的聊天记录和现有设定。你的任务包含两部分，并需严格按照指定格式输出：\n\n1. **L2摘要**: 将“新内容”合并成一段连贯的摘要。在摘要中，每个对应原始消息的事件都必须在其句首注明编号。\n2. **插入指令**: 对比“新内容”和“现有设定”。只为在“现有设定”中不存在的关键信息生成插入指令。指令必须使用 RFC 6902 JSON Patch 格式，并包裹在 <UpdateVariable> 标签内。例如:\n<UpdateVariable>\n{ "op": "add", "path": "/unique_key", "value": { "content": "详细描述", "keywords": ["关键词1"] } }\n</UpdateVariable>\n\n**最终输出格式要求：**\n必须先输出完整的L2摘要，然后另起一行输出所有的 <UpdateVariable> 块。\n---\n现有设定:\n{{db_content}}\n---\n新内容:\n{{chat_content}}\n---`,
        summary_prompt_L3: `You are a summarization expert. Review the following list of sequential event summaries (L2 summaries). Your task is to condense them into a single, high-level narrative paragraph (an L3 summary). Focus on the most significant developments.\n\n---\n**Summaries to Condense:**\n{{summary_content}}\n---`
    };
  
    // ========================================================================
    // 2. 环境解析与全局实例清理
    // ========================================================================
    const y = (function () { try { if (window.top && window.top.document) return window.top; } catch (err) {} return window; })();
    const v = (function (contextWindow) { try { if (contextWindow && contextWindow.document) return contextWindow.document; } catch (err) {} return document; })(y);
    
    function cleanupDOM() {
        try {
            const w = v.getElementById(WIDGET_ID); if (w) w.remove();
            const s = v.getElementById(STYLE_ID); if (s) s.remove();
        } catch(e) {}
    }

    if (y[INSTANCE_KEY] && "function" == typeof y[INSTANCE_KEY].stop) {
      try { y[INSTANCE_KEY].stop(); } catch (err) {}
    }
    cleanupDOM(); // Ensures completely clean slate from previously terminated IIFEs
  
    // ========================================================================
    // 3. 统一全局状态
    // ========================================================================
    const P =[]; // 事件清理池
    const _loadingLibraries = {};
    const logger = {
        info: (...args) => console.log(`[${APP_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${APP_NAME}]`, ...args),
        error: (...args) => console.error(`[${APP_NAME}]`, ...args),
        shoutInfo: (...args) => toastr.info(`[${APP_NAME}]`, ...args),
        shoutError: (...args) => toastr.error(`[${APP_NAME}]`, ...args)
    };
  
    let curr_state = STATES.IDLE;
    let event_queue =[];
    let isDispatching = false;
    let generationWatcherId = null;
    let go_flag = false; // 是否激活了SAM Identifier
    let current_run_is_dry = false;
  
    // --- 数据与UI状态 ---
    let samSettings = structuredClone(DEFAULT_SETTINGS);
    let samData = goodCopy(INITIAL_STATE);
    let samFunctions =[];
    
    let sam_db = null;
    let apiManager = null;
  
    // UI 内部状态
    let UI_STATE = {
        panelOpen: false, uiLeft: null, uiTop: null, fabSizePx: 48,
        activeTab: 'SUMMARY',
        selectedFuncIndex: -1,
        selectedPresetIndex: -1,
        selectedRegexIndex: -1
    };
    
    const k = { widget: null, panel: null, contentArea: null, statusText: null };
  
    // ========================================================================
    // 4. SAMDatabase 类封装
    // ========================================================================
    class SAMDatabase {
        constructor({ enabled = true } = {}) {
            this.isEnabled = enabled;
            this.miniSearch = null;
            this.documentMap = new Map();
            this.isInitialized = false;
            this.miniSearchConfig = { fields: ['key', 'keywords'], storeFields: ['key'], idField: 'key' };
        }
        async init() {
            if (!this.isEnabled || this.isInitialized) return this.isInitialized;
            try {
                if (typeof y.MiniSearch !== 'function') await loadExternalLibrary(MINISEARCH_URL, 'MiniSearch');
                this.miniSearch = new y.MiniSearch(this.miniSearchConfig);
                this.isInitialized = true;
                return true;
            } catch (error) { logger.shoutError("DB init failed.", error); this.isEnabled = false; return false; }
        }
        _checkReady() { return this.isEnabled && this.isInitialized; }
        setMemo(key, content, keywords =[]) {
            if (!this._checkReady()) return;
            const doc = { key: key, keywords:[key, ...keywords].join(' ').toLowerCase() };
            if (this.miniSearch.has(key)) this.miniSearch.remove({ key });
            this.miniSearch.add(doc);
            this.documentMap.set(key, content);
        }
        searchMemos(query) {
            if (!this._checkReady()) return[];
            return this.miniSearch.search(query.toLowerCase()).map(res => ({ key: res.key, content: this.documentMap.get(res.key) }));
        }
        deleteMemo(key) {
            if (!this._checkReady()) return;
            if (this.miniSearch.has(key)) { this.miniSearch.remove({ key }); this.documentMap.delete(key); }
        }
        getAllMemosAsObject() {
            if (!this._checkReady()) return {};
            return Object.fromEntries(this.documentMap.entries());
        }
        export() {
            if (!this._checkReady()) return null;
            return JSON.stringify({ miniSearchIndex: this.miniSearch.toJSON(), documentMap: Object.fromEntries(this.documentMap.entries()) });
        }
        import(jsonString) {
            if (!this.isEnabled) return false;
            try {
                const data = JSON.parse(jsonString);
                if (typeof y.MiniSearch.loadJSON !== 'function') throw new Error("MiniSearch not fully loaded.");
                this.miniSearch = y.MiniSearch.loadJSON(JSON.stringify(data.miniSearchIndex), this.miniSearchConfig);
                this.documentMap = new Map(Object.entries(data.documentMap));
                this.isInitialized = true;
                return true;
            } catch (error) { logger.shoutError("DB import failed.", error); return false; }
        }
    }
  
    // ========================================================================
    // 5. APIManager 类封装
    // ========================================================================
    class APIManager {
        constructor({ initialPresets =[], onUpdate = () => {} }) {
            this.presets = initialPresets;
            this.onUpdate = onUpdate;
        }
        _notifyUpdate() { if (typeof this.onUpdate === 'function') this.onUpdate(this.presets); }
        savePreset(name, config) {
            const trimmedName = name.trim();
            const presetData = {
                name: trimmedName, apiMode: config.apiMode === 'tavern' ? 'tavern' : 'custom',
                apiConfig: {
                    source: config.apiConfig?.source || API_SOURCES.CUSTOM,
                    url: config.apiConfig?.url || '', apiKey: config.apiConfig?.apiKey || '',
                    proxyPassword: config.apiConfig?.proxyPassword || '', model: config.apiConfig?.model || '',
                    max_tokens: parseInt(config.apiConfig?.max_tokens || 4096, 10),
                    temperature: parseFloat(config.apiConfig?.temperature || 0.9), top_p: parseFloat(config.apiConfig?.top_p || 0.9),
                    frequency_penalty: parseFloat(config.apiConfig?.frequency_penalty || 0.0), presence_penalty: parseFloat(config.apiConfig?.presence_penalty || 0.0),
                }
            };
            const existingIndex = this.presets.findIndex(p => p.name === trimmedName);
            if (existingIndex >= 0) this.presets[existingIndex] = presetData; else this.presets.push(presetData);
            this._notifyUpdate(); return true;
        }
        deletePreset(name) {
            const initLen = this.presets.length;
            this.presets = this.presets.filter(p => p.name !== name);
            if (this.presets.length !== initLen) { this._notifyUpdate(); return true; }
            return false;
        }
        getPreset(name) { return this.presets.find(p => p.name === name); }
        getAllPresets() { return this.presets; }
        _normalizeRole(role) {
            const r = String(role || '').toLowerCase();
            if (r === 'ai' || r === 'assistant') return 'assistant';
            if (r === 'system') return 'system';
            return 'user';
        }
        async generate(messages, presetName, abortSignal = null) {
            const preset = this.getPreset(presetName);
            if (!preset) throw new Error(`APIManager: Preset "${presetName}" not found.`);
            const orderedMessages = messages.map(m => ({ role: this._normalizeRole(m.role), content: m.content }));
  
            if (preset.apiMode === 'tavern') {
                if (typeof TavernHelper === 'undefined' || typeof TavernHelper.generateRaw !== 'function') throw new Error('APIManager: TavernHelper.generateRaw not available.');
                const response = await TavernHelper.generateRaw({ ordered_prompts: orderedMessages, should_stream: false }, abortSignal);
                if (typeof response === 'string') return response.trim();
                throw new Error(`Main API did not return a valid text response.`);
            }
  
            if (preset.apiMode === 'custom') {
                const apiConfig = preset.apiConfig || {};
                if (!apiConfig.model) throw new Error(`APIManager: Model name is required for custom preset.`);
                const cleanUrl = apiConfig.url ? apiConfig.url.replace(/\/$/, '') : '';
                const source = apiConfig.source || API_SOURCES.CUSTOM;
                
                let requestBody = {
                    messages: orderedMessages, model: apiConfig.model, max_tokens: apiConfig.max_tokens,
                    temperature: apiConfig.temperature, top_p: apiConfig.top_p, stream: false, chat_completion_source: source,
                    custom_url: cleanUrl, reverse_proxy: cleanUrl, api_key: apiConfig.apiKey, key: apiConfig.apiKey,
                    custom_include_headers: apiConfig.apiKey ? `Authorization: Bearer ${apiConfig.apiKey}` : '',
                    proxy_password: apiConfig.proxyPassword || "",
                };
                switch (source) { case API_SOURCES.MAKERSUITE: case 'google': requestBody.google_model = apiConfig.model; break; case API_SOURCES.CLAUDE: requestBody.claude_model = apiConfig.model; break; case API_SOURCES.MISTRALAI: requestBody.mistral_model = apiConfig.model; break; }
                const response = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST', headers: { ...SillyTavern.getContext().getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody), signal: abortSignal,
                });
                if (!response.ok) throw new Error(`API request failed: ${response.status} - ${await response.text()}`);
                const data = await response.json();
                if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content.trim();
                throw new Error(`Custom API returned an invalid response.`);
            }
            throw new Error(`APIManager: Unknown apiMode`);
        }
    }
  
    // ========================================================================
    // 6. 基础工具与状态操作函数 (Refactored Core)
    // ========================================================================
    function O(elem, type, listener, options) {
        if (elem && "function" == typeof elem.addEventListener) {
            elem.addEventListener(type, listener, options);
            P.push(() => elem.removeEventListener(type, listener, options));
        }
    }
    
    function bindTavernEvent(eventName, handler) {
        if (typeof eventOn === 'function') eventOn(eventName, handler);
        P.push(() => { if (typeof eventRemoveListener === 'function') eventRemoveListener(eventName, handler); });
    }
  
    async function loadExternalLibrary(url, globalName) {
        if (y[globalName]) return;
        if (_loadingLibraries[url]) return _loadingLibraries[url];
        _loadingLibraries[url] = new Promise((resolve, reject) => {
            const script = v.createElement('script'); script.src = url;
            script.onload = () => { delete _loadingLibraries[url]; resolve(); };
            script.onerror = (err) => { delete _loadingLibraries[url]; reject(err); };
            v.head.appendChild(script);
        });
        return _loadingLibraries[url];
    }
  
    function goodCopy(state) { return _.cloneDeep(state || INITIAL_STATE); }
    async function chunkedStringify(obj) { return new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(obj, null, 2)), 5)); }
  
    // Settings Loader
    function loadSamSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        _.defaultsDeep(extensionSettings[MODULE_NAME], DEFAULT_SETTINGS);
        samSettings = extensionSettings[MODULE_NAME];
        return samSettings;
    }
    function saveSamSettings() {
        const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
        extensionSettings[MODULE_NAME] = samSettings;
        saveSettingsDebounced();
        if (UI_STATE.panelOpen) renderTabContent();
    }
  
    async function checkWorldInfoActivation() {
        try {
            const characterId = SillyTavern.getContext().characterId;
            if (characterId === null || characterId < 0) { go_flag = false; return; }
            const char = SillyTavern.getContext().characters[characterId];
            const worldInfoName = char?.data?.extensions?.world;
            if (!worldInfoName) { go_flag = false; return; }
            const wi = await SillyTavern.getContext().loadWorldInfo(worldInfoName);
            if (!wi) { go_flag = false; return; }
            go_flag = Object.values(wi.entries).some(item => item.comment === SAM_FUNCTIONLIB_ID);
        } catch (e) { go_flag = false; }
    }
  
    async function getFunctionsFromWI() {
        try {
            const characterId = SillyTavern.getContext().characterId;
            if (characterId === null || characterId < 0) return[];
            const worldInfoName = SillyTavern.getContext().characters[characterId]?.data?.extensions?.world;
            if (!worldInfoName) return[];
            const wiData = await SillyTavern.getContext().loadWorldInfo(worldInfoName);
            const funcEntry = Object.values(wiData?.entries || {}).find(e => e.comment === SAM_FUNCTIONLIB_ID);
            return funcEntry && funcEntry.content ? JSON.parse(funcEntry.content) :[];
        } catch (e) { return[]; }
    }
    
    async function saveFunctionsToWI(functions) {
        if (!go_flag) { toastr.error("无法保存: 世界信息中未找到SAM标识符。"); return; }
        const characterWIName = await TavernHelper.getCurrentCharPrimaryLorebook();
        if (!characterWIName) { toastr.error("此角色没有关联的世界信息文件。"); return; }
        
        try {
            let wi = await SillyTavern.getContext().loadWorldInfo(characterWIName);
            const entryKey = _.findKey(wi.entries, (entry) => entry.comment === SAM_FUNCTIONLIB_ID);
            const content = JSON.stringify(functions, null, 2);

            if (entryKey) {
                wi.entries[entryKey].content = content;
                await TavernHelper.updateWorldInfo(characterWIName, wi);
            } else {
                 toastr.warning("未找到SAM函数库条目，请先在世界信息中手动创建一个comment为'__SAM_IDENTIFIER__'的条目。");
            }
            toastr.success("函数已成功保存至世界信息。");
        } catch (e) { console.error(e); toastr.error("保存函数至世界信息失败。"); }
    }

    async function initializeDatabase(dbStateJson = null) {
        if (!sam_db) sam_db = new SAMDatabase({ enabled: true });
        await sam_db.init();
        if (dbStateJson) { try { sam_db.import(dbStateJson); } catch(e){} }
    }
  
    async function runSandboxedFunction(funcName, params, state) {
        const funcDef = samFunctions.find(f => f.func_name === funcName);
        if (!funcDef) return;
        const timeout = funcDef.timeout ?? 2000;
        const formalParamNames =[]; let restParamName = null;
        for (const param of (funcDef.func_params ||[])) { 
            if (param.startsWith('...')) restParamName = param.substring(3); 
            else formalParamNames.push(param); 
        }
        let bodyPrologue = restParamName ? `const ${restParamName} = Array.from(arguments).slice(${4 + formalParamNames.length});\n` : '';
        const fetchImpl = funcDef.network_access ? y.fetch.bind(y) : () => { throw new Error('Network disabled'); };
        
        const execPromise = new Promise(async (resolve, reject) => {
            try {
                const userFunc = new Function('state', '_', 'fetch', 'XMLHttpRequest', ...formalParamNames, `'use strict';\n${bodyPrologue}${funcDef.func_body}`);
                resolve(await userFunc.apply(null,[state, _, fetchImpl, null, ...params]));
            } catch (err) { reject(err); }
        });
        try { 
            await Promise.race([execPromise, new Promise((_, r) => setTimeout(()=>r(new Error("Timeout")), timeout))]); } 
        catch(e) { 
            logger.shoutError(`Func Error:`, e);
             logger.error(`Function "${funcName}" execution failed:`, e);
        }
    }
  
    /**
     * Parses a JSON Pointer (RFC 6902) path string into an array of keys.
     * @param {string} pointer The JSON Pointer string (e.g., "/a/b/0").
     * @returns {string[]} An array of keys for _.set/_.get.
     */
    function parseJsonPointer(pointer) {
        if (typeof pointer !== 'string' || pointer.length === 0 || pointer[0] !== '/') {
            throw new Error(`Invalid JSON Pointer: must be a string starting with '/'. Received: ${pointer}`);
        }
        // An empty pointer refers to the root of the static object.
        if (pointer === '/') return[];
        // Split, remove the initial empty string, and decode ~1 and ~0.
        return pointer.substring(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    }

    /**
     * Applies an array of RFC 6902-based operations to the state object.
     * @param {Array<object>} operations The array of operation objects.
     * @param {object} state The current state object to modify.
     * @returns {Promise<{state: object}>} The modified state.
     */
    async function applyOperationsToState(operations, state) {
        if (!operations || operations.length === 0) return { state };
        
        for (const op of operations) {
            if (!op || typeof op.op !== 'string') continue;
            try {
                switch (op.op) {
                    case 'add':
                    case 'replace':
                        // Standard JSON Patch 'add' and 'replace' target the 'static' property.
                        if (typeof op.path === 'string') {
                            const pathKeys = parseJsonPointer(op.path);
                            _.set(state.static, pathKeys, op.value);
                        }
                        break;
                    case 'remove':
                        // Standard JSON Patch 'remove'.
                        if (typeof op.path === 'string') {
                            const pathKeys = parseJsonPointer(op.path);
                            _.unset(state.static, pathKeys);
                        }
                        break;
                    case 'time':
                        // Custom operation to set the time.
                        if (typeof op.value === 'string') {
                            state.time = op.value;
                        }
                        break;
                    case 'func':
                        // Custom operation to execute a sandboxed function.
                        if (typeof op.func_name === 'string') {
                            const params = Array.isArray(op.params) ? op.params :[];
                            await runSandboxedFunction(op.func_name, params, state);
                        }
                        break;
                    default:
                        logger.warn(`Unknown operation type: ${op.op}`);
                        break;
                }
            } catch(e) {
                logger.error(`Failed to apply operation:`, op, e);
                logger.shoutError(`Failed to apply operation: ${e.message}`);
            }
        }
        return { state };
    }
  
    /**
     * Extracts and parses all operations from <UpdateVariable> blocks in a text.
     * @param {string} messageContent The text to scan.
     * @returns {Promise<Array<object>>} A flattened array of all found operation objects.
     */
    async function extractOperationsFromText(messageContent) {
        const operations =[];
        let match;

        // Ensure jsonrepair library is loaded
        if (typeof y.jsonrepair !== 'function') {
            await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
        }

        UPDATE_BLOCK_EXTRACT_REGEX.lastIndex = 0; // Reset regex state
        while ((match = UPDATE_BLOCK_EXTRACT_REGEX.exec(messageContent)) !== null) {
            let content = match[1].trim();
            if (!content) continue;
            
            // Heuristically wrap content in an array if it's not already,
            // allowing jsonrepair to fix comma-less object lists.
            if (!content.startsWith('[') && !content.endsWith(']')) {
                content = `[${content}]`;
            }

            try {
                const repairedJson = y.jsonrepair(content);
                const parsedData = JSON.parse(repairedJson);
                
                if (Array.isArray(parsedData)) {
                    operations.push(...parsedData);
                } else if (typeof parsedData === 'object' && parsedData !== null) {
                    operations.push(parsedData);
                }
            } catch (e) {
                logger.shoutError(`Failed to parse <UpdateVariable> block content: ${e.message}`);
                logger.error("Failed to parse <UpdateVariable> block content:", e, "\nContent:", match[1]);
            }
        }
        return operations;
    }
  
    // ========================================================================
    // 7. 自动总结 (Auto-Summary) & 数据写入流程
    // ========================================================================
    async function triggerSummaryCheck(currentIndex) {
        await checkWorldInfoActivation();
        if (!go_flag || !samSettings.data_enable) return;
        
        const period = samSettings.summary_levels.L2.frequency;
        const last_progress = samData.summary_progress || 0;
        
        if (currentIndex - last_progress >= period) {
            logger.info(`Summary threshold reached (${currentIndex - last_progress}/${period}).`);
            curr_state = STATES.SUMMARIZING; updateUIStatus();
            await processSummarizationRun(last_progress, currentIndex);
            curr_state = STATES.IDLE; updateUIStatus();
        }
    }
  
    async function processSummarizationRun(startIndex, endIndex, force = false) {
        const chat = SillyTavern.getContext().chat;
        if (!samData.responseSummary) samData.responseSummary = { L1:[], L2: [], L3:[] };
        
        if (force) {
            samData.responseSummary.L2 = samData.responseSummary.L2.filter(s => s.index_begin >= endIndex || s.index_end <= startIndex);
        }
  
        const msgs = chat.slice(startIndex, endIndex);
        if (msgs.length === 0) return false;
        
        const contentStr = msgs.map(m => {
            let processed = m.mes.replace(UPDATE_BLOCK_REMOVE_REGEX, '').trim();
            samSettings.regexes.forEach(rx => { if(rx.enabled && rx.regex_body) try { processed = processed.replace(new RegExp(rx.regex_body, 'g'), ''); }catch(e){} });
            return `${m.name}: ${processed}`;
        }).join('\n');
  
        const db_content = sam_db && sam_db.isInitialized ? Object.entries(sam_db.getAllMemosAsObject()).map(([k,v])=>`Key: ${k}\nContent: ${v}`).join('\n\n') : "无现有设定";
        const promptL2 = SillyTavern.getContext().substituteParamsExtended(samSettings.summary_prompt, { db_content, chat_content: contentStr });
        
        let resultL2;
        if (typeof toastr !== 'undefined') toastr.info("[SAM] 开始生成摘要...");
        try {
            if (samSettings.summary_api_preset && apiManager) {
                resultL2 = await apiManager.generate([{ role: 'user', content: promptL2 }], samSettings.summary_api_preset);
            } else {
                resultL2 = await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: promptL2, skipWIAN: samSettings.skipWIAN_When_summarizing });
            }
        } catch (e) {
            logger.error("L2 Summary failed", e);
            logger.shoutError(`L2 Summary failed: ${e.message}`);
            if (typeof toastr !== 'undefined') toastr.error(`L2 摘要失败: ${e.message}`); return false; }
  
        if (!resultL2) return false;
  
        const dbOperations = await extractOperationsFromText(resultL2);
        for (const op of dbOperations) {
            // Process database insertions from summary
            if (op.op === 'add' && op.path && op.value && typeof op.value.content === 'string') {
                const pathParts = op.path.split('/');
                const key = pathParts[pathParts.length - 1];
                if (key) {
                   sam_db.setMemo(key, op.value.content, Array.isArray(op.value.keywords) ? op.value.keywords :[]);
                }
            }
        }
  
        const cleanL2 = resultL2.replace(UPDATE_BLOCK_REMOVE_REGEX, '').trim();
  
        if (cleanL2) {
            samData.responseSummary.L2.push({ index_begin: startIndex, index_end: endIndex, content: cleanL2, level: 0 });
            samData.summary_progress = endIndex;
  
            const l3Set = samSettings.summary_levels.L3;
            if (l3Set.enabled && samData.responseSummary.L2.length >= l3Set.frequency) {
                const toCondense = samData.responseSummary.L2.slice(-l3Set.frequency);
                const l3Str = toCondense.map(s => `[Messages ${s.index_begin}-${s.index_end}]: ${s.content}`).join('\n');
                const pL3 = SillyTavern.getContext().substituteParamsExtended(samSettings.summary_prompt_L3, { summary_content: l3Str });
                try {
                    const resultL3 = (samSettings.summary_api_preset && apiManager) ? await apiManager.generate([{ role: 'user', content: pL3 }], samSettings.summary_api_preset)
                                   : await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: pL3, skipWIAN: samSettings.skipWIAN_When_summarizing });
                    if (resultL3) {
                        samData.responseSummary.L3.push({ index_begin: toCondense[0].index_begin, index_end: toCondense[toCondense.length-1].index_end, content: resultL3, level: 0 });
                        samData.responseSummary.L2.splice(-l3Set.frequency);
                    }
                } catch(e) {}
            }
  
            if (sam_db.isInitialized) samData.jsondb = sam_db.export();
            await applyDataToChat(samData);
            if (typeof toastr !== 'undefined') toastr.success("[SAM] 摘要生成完成");
            if (UI_STATE.panelOpen) renderTabContent();
            return true;
        }
        return false;
    }
  
    async function processMessageState(index) {
        const chat = SillyTavern.getContext().chat;
        if (!chat[index] || chat[index].is_user) return;
        
        let state = goodCopy(samData);
        
        // Extract operations from the AI's message
        const opsFromMessage = await extractOperationsFromText(chat[index].mes);
        
        // Create operations for any periodic functions
        const periodicOps = samFunctions
            .filter(f => f.periodic)
            .map(f => ({ op: 'func', func_name: f.func_name, params:[] }));
        
        // Apply all operations to the state
        await applyOperationsToState([...opsFromMessage, ...periodicOps], state);

        samData = state;
        await applyDataToChat(samData, index);
    }
  
    async function applyDataToChat(data, index = null) {
        SillyTavern.getContext().variables.local.set("SAM_data", data);
        if (index === null) {
            const chat = SillyTavern.getContext().chat;
            for (let i = chat.length - 1; i >= 0; i--) { if (!chat[i].is_user) { index = i; break; } }
        }
        if (index === null || index < 0) return;
        
        const chat = SillyTavern.getContext().chat;
        const lastMsg = chat[index];
        const cleanNarrative = lastMsg.mes.replace(UPDATE_BLOCK_REMOVE_REGEX, '').trim();
        
        // Checkpoint logic is no longer needed as state is not stored in chat messages.
        // If a state block needs to be stored for debugging or history, a different mechanism is needed.
        // For now, we only update the latest message to its clean version without state blocks.
        if (lastMsg.mes.includes('<UpdateVariable>')) {
            await TavernHelper.setChatMessages([{ message_id: index, message: cleanNarrative }]);
        }
    }
  
    async function dispatcher(event) {
        try {
            if (curr_state === STATES.IDLE && (event === tavern_events.MESSAGE_SENT || event === tavern_events.GENERATION_STARTED)) {
                if (current_run_is_dry) return;
                curr_state = STATES.AWAIT_GENERATION;
            } else if (curr_state === STATES.AWAIT_GENERATION && event === tavern_events.GENERATION_ENDED) {
                if (current_run_is_dry) { current_run_is_dry = false; return; }
                curr_state = STATES.PROCESSING; updateUIStatus();
                const chatLen = SillyTavern.getContext().chat.length;
                await processMessageState(chatLen - 1);
                
                await triggerSummaryCheck(chatLen);
                
                curr_state = STATES.IDLE; updateUIStatus();
            } else if (event === tavern_events.MESSAGE_SWIPED || event === tavern_events.GENERATION_STOPPED) {
                curr_state = STATES.IDLE; updateUIStatus();
            }
        } catch (e) { logger.error("Dispatcher Error:", e); curr_state = STATES.IDLE; updateUIStatus(); }
    }
  
    async function unified_dispatch_executor() {
        if (isDispatching) return; isDispatching = true;
        while (event_queue.length > 0) await dispatcher(event_queue.shift());
        isDispatching = false;
        if (event_queue.length > 0) setTimeout(() => unified_dispatch_executor(), 10);
    }
    const pushEvent = (ev) => { event_queue.push(ev); unified_dispatch_executor(); };
  
    // ========================================================================
    // 8. 内部悬浮窗 UI & 样式构建 (原生 JS)
    // ========================================================================
    function updateUIStatus() {
        if (k.statusText) {
            k.statusText.textContent = `引擎状态: ${curr_state} | 数据: ${go_flag && samSettings.data_enable ? '活跃' : '休眠'}`;
            k.statusText.style.color =["PROCESSING", "SUMMARIZING"].includes(curr_state) ? "#f0ad4e" : "#5cb85c";
        }
    }
  
    function Nn() {
        if (!v.head) return;
        if (v.getElementById(STYLE_ID)) v.getElementById(STYLE_ID).remove();
        const styleNode = v.createElement("style");
        styleNode.id = STYLE_ID;
        styleNode.textContent = `
          #${WIDGET_ID} { position: fixed; z-index: 99997; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          #${WIDGET_ID} .th-asr-fab { width: 48px; height: 48px; border: none; border-radius: 14px; cursor: pointer; color: white; background: linear-gradient(135deg, #0f766e, #0f172a); box-shadow: 0 8px 20px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
          #${WIDGET_ID} .th-asr-fab:hover { transform: translateY(-2px) scale(1.05); }
          #${WIDGET_ID} .th-asr-panel { margin-top: 10px; width: 800px; max-height: 90vh; border-radius: 8px; background: #1e1e1e; border: 1px solid #333; box-shadow: 0 16px 36px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; color: #ddd; }
          #${WIDGET_ID} .th-asr-panel[hidden] { display: none !important; }
          .sam_modal_header { background: #252526; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: move; border-bottom: 1px solid #333; user-select: none; }
          .sam_header_title { font-weight: bold; font-size: 14px; } .sam_brand { color: #4a6fa5; } .sam_version { font-size: 10px; color: #666; }
          .sam_close_icon { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; } .sam_close_icon:hover { color: #fff; }
          .sam_tabs { display: flex; background: #2d2d2d; border-bottom: 1px solid #333; flex-shrink:0; }
          .sam_tab { background: transparent; border: none; color: #888; padding: 10px 20px; cursor: pointer; font-size: 12px; border-right: 1px solid #333; transition: all 0.2s; }
          .sam_tab:hover { background: #333; color: #ccc; } .sam_tab.active { background: #1e1e1e; color: #4a6fa5; font-weight: bold; border-top: 2px solid #4a6fa5; }
          .sam_content_area { flex: 1; overflow:hidden; display:flex; flex-direction: column; }
          .sam_content_area > * { flex: 1; overflow-y: auto; padding: 15px; box-sizing: border-box; }
          .sam_modal_footer { height: 40px; background: #252526; border-top: 1px solid #333; display: flex; justify-content: space-between; align-items: center; padding: 0 15px; flex-shrink:0;}
          .sam_status_bar { font-size: 11px; color: #666; } .sam_actions { display: flex; gap: 10px; }
          .sam_btn { padding: 6px 14px; border: none; font-size: 12px; cursor: pointer; border-radius: 2px; }
          .sam_btn_secondary { background: #3c3c3c; color: #ccc; } .sam_btn_secondary:hover { background: #4c4c4c; }
          .sam_btn_primary { background: #0e639c; color: white; } .sam_btn_primary:hover { background: #1177bb; }
          .sam_btn_small { background: #3c3c3c; border: none; color: white; width: 20px; height: 20px; cursor: pointer; border-radius: 3px; }
          
          /* Form Elements */
          .sam_form_row { margin-bottom: 15px; } .sam_form_grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
          .sam_label { display: block; margin-bottom: 5px; font-size: 11px; color: #aaa; }
          .sam_input, .sam_select { width: 100%; background: #2d2d2d; border: 1px solid #3e3e3e; color: white; padding: 6px; font-size: 12px; box-sizing: border-box; }
          .sam_textarea { width: 100%; min-height: 80px; background: #151515; border: 1px solid #333; color: #ccc; font-family: monospace; padding: 10px; box-sizing: border-box; resize: vertical; }
          .sam_code_editor { height: 100%; width: 100%; background: #151515; color: #dcdcaa; border: 1px solid #333; padding: 10px; font-family: 'Consolas', monospace; box-sizing: border-box; flex: 1; resize: none; }
          
          /* Lists (Sidebar) */
          .sam_split { display: flex; height: 100%; gap: 15px; overflow: hidden;}
          .sam_sidebar { width: 220px; background: #252526; border: 1px solid #333; display: flex; flex-direction: column; flex-shrink:0; }
          .sam_sidebar_header { padding: 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items:center; font-size: 12px; font-weight: bold; }
          .sam_list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex:1; }
          .sam_list li { padding: 8px 10px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; }
          .sam_list li:hover { background: #2a2a2a; } .sam_list li.active { background: #37373d; color: white; }
          .sam_detail { flex: 1; overflow-y: auto; background: #1e1e1e; border: 1px solid #333; padding: 15px; box-sizing: border-box;}
          .sam_delete_icon { color: #666; font-weight: bold; cursor:pointer; } .sam_delete_icon:hover { color: #f86c6b; }
          
          /* Toggles */
          .sam_toggle { cursor: pointer; display: inline-block; vertical-align: middle; }
          .sam_toggle_track { width: 36px; height: 18px; background: #333; border-radius: 9px; position: relative; transition: background 0.2s; }
          .sam_toggle_track.on { background: #4a6fa5; }
          .sam_toggle_thumb { width: 14px; height: 14px; background: white; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: left 0.2s; }
          .sam_toggle_track.on .sam_toggle_thumb { left: 20px; }
          
          /* Summary Display */
          .sam_summary_display { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; }
          .sam_summary_box { background: #252526; border: 1px solid #333; padding: 10px; border-radius: 4px; display: flex; flex-direction: column; }
          .sam_summary_box h4 { margin:0 0 10px 0; font-size: 12px; color:#888; border-bottom:1px solid #333; padding-bottom:5px; }
          .sam_summary_box textarea { min-height: 120px; }
        `;
        v.head.appendChild(styleNode);
    }
  
    // 渲染 UI 内部 HTML
    function renderTabContent() {
        if (!k.contentArea) return;
        const T = UI_STATE.activeTab;
        let html = '';
  
        if (T === 'SUMMARY') {
            html = `<div>
              <h3>分层摘要配置</h3>
              <div class="sam_form_grid" style="grid-template-columns: 1fr 1fr 1fr;">
                 <div class="sam_form_row"><label class="sam_label">L1 频率</label><input class="sam_input" type="number" id="sam_L1_freq" value="${samSettings.summary_levels.L1.frequency}"></div>
                 <div class="sam_form_row"><label class="sam_label">L2 频率</label><input class="sam_input" type="number" id="sam_L2_freq" value="${samSettings.summary_levels.L2.frequency}"></div>
                 <div class="sam_form_row"><label class="sam_label">L3 频率</label><input class="sam_input" type="number" id="sam_L3_freq" value="${samSettings.summary_levels.L3.frequency}"></div>
              </div>
              <div class="sam_form_row">
                  <label class="sam_label" style="display:inline-block; margin-right: 10px;">启用 L2 摘要</label>
                  <div class="sam_toggle" id="toggle_L2"><div class="sam_toggle_track ${samSettings.summary_levels.L2.enabled?'on':''}"><div class="sam_toggle_thumb"></div></div></div>
              </div>
              <div class="sam_form_row">
                  <label class="sam_label" style="display:inline-block; margin-right: 10px;">启用 L3 摘要</label>
                  <div class="sam_toggle" id="toggle_L3"><div class="sam_toggle_track ${samSettings.summary_levels.L3.enabled?'on':''}"><div class="sam_toggle_thumb"></div></div></div>
              </div>
              <div class="sam_form_row"><label class="sam_label">L2 生成提示词</label><textarea class="sam_textarea" id="sam_prompt_L2">${samSettings.summary_prompt}</textarea></div>
              <div class="sam_form_row"><label class="sam_label">L3 生成提示词</label><textarea class="sam_textarea" id="sam_prompt_L3">${samSettings.summary_prompt_L3}</textarea></div>
              <div class="sam_actions"><button class="sam_btn sam_btn_primary" id="btn_save_summary">保存配置</button> <button class="sam_btn sam_btn_secondary" id="btn_run_summary">立即执行一次总结</button></div>
              <hr style="border-color: #333; margin: 20px 0;">
              <h3>已存档摘要</h3>
              <div class="sam_summary_display">
                  ${['L3', 'L2', 'L1'].map(level => `
                    <div class="sam_summary_box">
                      <h4>${level} 级摘要 (${(samData.responseSummary[level] ||[]).length})</h4>
                      ${(samData.responseSummary[level] ||[]).map((s, i) => `
                        <div style="margin-bottom:10px;">
                          <div style="font-size:10px; color:#666; display:flex; justify-content:space-between;"><span>范围: ${s.index_begin}-${s.index_end}</span> <span class="sam_delete_icon" data-level="${level}" data-idx="${i}">×</span></div>
                          <textarea class="sam_textarea" data-level="${level}" data-idx="${i}" style="min-height:80px;">${s.content}</textarea>
                        </div>`).join('')}
                    </div>
                  `).join('')}
              </div>
              <div class="sam_actions" style="margin-top:20px;"><button class="sam_btn sam_btn_primary" id="btn_commit_data">保存所有摘要编辑</button></div>
            </div>`;
        } else if (T === 'CONNECTIONS') {
            const presets = apiManager.getAllPresets();
            const draft = presets[UI_STATE.selectedPresetIndex];
            
            html = `<div class="sam_split">
                <div class="sam_sidebar">
                    <div class="sam_sidebar_header"><span>API 预设</span><button class="sam_btn_small" id="btn_add_preset">+</button></div>
                    <ul class="sam_list" id="preset_list">
                        ${presets.map((p, i) => `<li data-idx="${i}" class="${i === UI_STATE.selectedPresetIndex ? 'active' : ''}">${p.name} ${samSettings.summary_api_preset === p.name?'(当前)':''} <span class="sam_delete_icon" data-idx="${i}">×</span></li>`).join('')}
                    </ul>
                </div>
                <div class="sam_detail">
                    ${draft ? `
                        <div class="sam_form_row"><label class="sam_label">预设名称</label><input class="sam_input" id="preset_name" value="${draft.name}"></div>
                        <div class="sam_form_row"><label class="sam_label">API 模式</label><select class="sam_select" id="preset_mode"><option value="custom" ${draft.apiMode==='custom'?'selected':''}>自定义连接</option><option value="tavern" ${draft.apiMode==='tavern'?'selected':''}>Tavern 主 API</option></select></div>
                        ${draft.apiMode === 'custom' ? `
                            <div class="sam_form_row"><label class="sam_label">源 (格式)</label><select class="sam_select" id="preset_source">${API_SOURCE_OPTIONS.map(opt => `<option value="${opt.value}" ${draft.apiConfig.source===opt.value?'selected':''}>${opt.label}</option>`).join('')}</select></div>
                            <div class="sam_form_row"><label class="sam_label">URL</label><input class="sam_input" id="preset_url" value="${draft.apiConfig.url || ''}"></div>
                            <div class="sam_form_grid">
                                <div class="sam_form_row"><label class="sam_label">API Key</label><input type="password" class="sam_input" id="preset_key" value="${draft.apiConfig.apiKey || ''}"></div>
                                <div class="sam_form_row"><label class="sam_label">Proxy Pwd</label><input type="password" class="sam_input" id="preset_pwd" value="${draft.apiConfig.proxyPassword || ''}"></div>
                            </div>
                            <div class="sam_form_row"><label class="sam_label">模型</label><input class="sam_input" id="preset_model" value="${draft.apiConfig.model || ''}"></div>
                        ` : '<p style="color:#666; font-size:12px;">此模式将使用SillyTavern中当前配置的主AI设置。</p>'}
                        <div class="sam_actions" style="margin-top:20px;">
                            <button class="sam_btn sam_btn_primary" id="btn_save_preset">保存并应用更改</button>
                            <button class="sam_btn sam_btn_secondary" id="btn_set_active_preset" ${samSettings.summary_api_preset === draft.name ?'disabled':''}>设为默认</button>
                        </div>
                    ` : '<div style="color:#555; text-align:center; padding-top:100px;">选择或添加预设</div>'}
                </div>
            </div>`;
        } else if (T === 'FUNCS') {
            const func = samFunctions[UI_STATE.selectedFuncIndex];
            html = `<div class="sam_split">
                <div class="sam_sidebar">
                    <div class="sam_sidebar_header"><span>自定义函数</span><button class="sam_btn_small" id="btn_add_func">+</button></div>
                    <ul class="sam_list" id="func_list">
                        ${samFunctions.map((f, i) => `<li data-idx="${i}" class="${i === UI_STATE.selectedFuncIndex ? 'active' : ''}">${f.func_name} <span class="sam_delete_icon" data-idx="${i}">×</span></li>`).join('')}
                    </ul>
                    <div style="padding:10px; border-top:1px solid #333;"><button class="sam_btn sam_btn_primary" style="width:100%;" id="btn_save_funcs" ${!go_flag?'disabled':''}>保存函数至世界信息</button></div>
                </div>
                <div class="sam_detail">
                    ${func ? `
                       <div class="sam_form_row"><label class="sam_label">函数名</label><input class="sam_input" value="${func.func_name}" data-field="func_name"></div>
                       <div class="sam_form_row"><label class="sam_label">参数 (逗号分隔)</label><input class="sam_input" value="${(func.func_params ||[]).join(', ')}" data-field="func_params"></div>
                       <div class="sam_form_row" style="flex:1; display:flex; flex-direction:column;"><label class="sam_label">函数体 (JS)</label><textarea class="sam_code_editor" data-field="func_body">${func.func_body}</textarea></div>
                       <div class="sam_form_grid">
                           <div><label class="sam_label" style="display:inline-block; margin-right:10px;">周期执行</label><div class="sam_toggle" data-field="periodic"><div class="sam_toggle_track ${func.periodic?'on':''}"><div class="sam_toggle_thumb"></div></div></div></div>
                           <div><label class="sam_label" style="display:inline-block; margin-right:10px;">网络访问</label><div class="sam_toggle" data-field="network_access"><div class="sam_toggle_track ${func.network_access?'on':''}"><div class="sam_toggle_thumb"></div></div></div></div>
                       </div>
                    ` : '<div style="color:#555; text-align:center; padding-top:100px;">选择或添加函数</div>'}
                </div>
            </div>`;
        } else if (T === 'REGEX') {
             const regex = (samSettings.regexes || [])[UI_STATE.selectedRegexIndex];
             html = `<div class="sam_split">
                <div class="sam_sidebar">
                    <div class="sam_sidebar_header"><span>正则过滤器</span><button class="sam_btn_small" id="btn_add_regex">+</button></div>
                    <ul class="sam_list" id="regex_list">
                        ${(samSettings.regexes ||[]).map((r, i) => `<li data-idx="${i}" class="${i === UI_STATE.selectedRegexIndex ? 'active' : ''}">${r.name} <span class="sam_delete_icon" data-idx="${i}">×</span></li>`).join('')}
                    </ul>
                    <div style="padding:10px; border-top:1px solid #333;"><button class="sam_btn sam_btn_primary" style="width:100%;" id="btn_save_regexes">保存所有正则</button></div>
                </div>
                <div class="sam_detail">
                    ${regex ? `
                        <div class="sam_form_row"><label class="sam_label">名称</label><input class="sam_input" value="${regex.name}" data-field="name"></div>
                        <div class="sam_form_row"><label class="sam_label">表达式 (不含 /.../g)</label><textarea class="sam_textarea" data-field="regex_body">${regex.regex_body}</textarea></div>
                        <div><label class="sam_label" style="display:inline-block; margin-right:10px;">启用</label><div class="sam_toggle" data-field="enabled"><div class="sam_toggle_track ${regex.enabled?'on':''}"><div class="sam_toggle_thumb"></div></div></div></div>
                    ` : '<div style="color:#555; text-align:center; padding-top:100px;">选择或添加正则表达式</div>'}
                </div>
            </div>`;
        } else if (T === 'DATA') {
            html = `<div style="display:flex; flex-direction:column; height:100%;">
                <div class="sam_form_row" style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                    <label class="sam_label">当前状态 JSON (可直接编辑)</label>
                    <button class="sam_btn sam_btn_primary" id="btn_commit_data" ${!go_flag?'disabled':''}>提交数据更改</button>
                </div>
                <textarea class="sam_code_editor" id="data_json_area" ${!go_flag?'disabled':''}>${JSON.stringify(samData, null, 2)}</textarea>
            </div>`;
        } else if (T === 'SETTINGS') {
            html = `<div>
               <h3 style="margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">全局设置</h3>
               <div class="sam_form_row">
                  <label class="sam_label" style="display:inline-block; margin-right:10px;">启用数据/摘要系统</label>
                  <div class="sam_toggle" id="toggle_data"><div class="sam_toggle_track ${samSettings.data_enable?'on':''}"><div class="sam_toggle_thumb"></div></div></div>
              </div>
              <div class="sam_form_row">
                  <label class="sam_label" style="display:inline-block; margin-right:10px;">摘要生成时跳过世界信息</label>
                  <div class="sam_toggle" id="toggle_skip"><div class="sam_toggle_track ${samSettings.skipWIAN_When_summarizing?'on':''}"><div class="sam_toggle_thumb"></div></div></div>
              </div>
              <div class="sam_actions" style="margin-top:20px;"><button class="sam_btn sam_btn_primary" id="btn_save_global">保存全局设置</button></div>
              <hr style="border-color: #333; margin: 20px 0;">
              <h3>导入 / 导出</h3>
              <p style="font-size:11px; color:#666;">保存或加载您的扩展设置（不含API预设）。</p>
              <div class="sam_actions">
                <button class="sam_btn sam_btn_secondary" id="btn_export">导出设置</button>
                <input type="file" id="file_import" style="display:none;" accept=".json">
                <button class="sam_btn sam_btn_secondary" id="btn_import">导入设置</button>
              </div>
            </div>`;
        }
        
        k.contentArea.innerHTML = `<div>${html}</div>`;
        bindPanelEvents();
    }
  
    function bindPanelEvents() {
        const C = k.contentArea.firstElementChild;
        if (!C) return;
        const T = UI_STATE.activeTab;

        const commitDataFromUI = async () => {
            if (!go_flag) { toastr.error("缺少标识符，无法写入。"); return; }
            try {
                // For direct data editing in the DATA tab
                const text = C.querySelector('#data_json_area')?.value;
                if(text) {
                    let parsed; 
                    try { 
                        parsed = JSON.parse(text); 
                    } catch(e) {
                        if(y.jsonrepair) parsed = JSON.parse(y.jsonrepair(text)); 
                        else throw e;
                    }
                    samData = parsed;
                }
                
                // For summary edits in the SUMMARY tab
                C.querySelectorAll('.sam_summary_display textarea').forEach(area => {
                    const {level, idx} = area.dataset;
                    if (samData.responseSummary[level]?.[idx]) {
                         samData.responseSummary[level][idx].content = area.value;
                    }
                });

                SillyTavern.getContext().variables.local.set("SAM_data", samData);
                toastr.success("数据已更新至本地变量");
            } catch(e) { toastr.error(`JSON解析或提交失败: ${e.message}`); }
        };

        if (T === 'SUMMARY') {
            C.querySelector('#toggle_L2').onclick = () => { samSettings.summary_levels.L2.enabled = !samSettings.summary_levels.L2.enabled; renderTabContent(); };
            C.querySelector('#toggle_L3').onclick = () => { samSettings.summary_levels.L3.enabled = !samSettings.summary_levels.L3.enabled; renderTabContent(); };
            C.querySelector('#btn_save_summary').onclick = () => {
                samSettings.summary_levels.L1.frequency = parseInt(C.querySelector('#sam_L1_freq').value) || 20;
                samSettings.summary_levels.L2.frequency = parseInt(C.querySelector('#sam_L2_freq').value) || 20;
                samSettings.summary_levels.L3.frequency = parseInt(C.querySelector('#sam_L3_freq').value) || 5;
                samSettings.summary_prompt = C.querySelector('#sam_prompt_L2').value;
                samSettings.summary_prompt_L3 = C.querySelector('#sam_prompt_L3').value;
                saveSamSettings(); toastr.success("摘要配置已保存");
            };
            C.querySelector('#btn_run_summary').onclick = async () => {
                if(!go_flag || !samSettings.data_enable) { toastr.warning("摘要功能未激活。"); return; }
                const chatLen = SillyTavern.getContext().chat.length;
                curr_state = STATES.SUMMARIZING; updateUIStatus();
                await processSummarizationRun(Math.max(0, chatLen - samSettings.summary_levels.L2.frequency), chatLen, true);
                curr_state = STATES.IDLE; updateUIStatus();
            };
            C.querySelectorAll('.sam_summary_display .sam_delete_icon').forEach(icon => {
                icon.onclick = (e) => {
                    const {level, idx} = e.target.dataset;
                    samData.responseSummary[level].splice(idx, 1);
                    renderTabContent();
                };
            });
            C.querySelector('#btn_commit_data').onclick = commitDataFromUI;
        }
        else if (T === 'SETTINGS') {
            C.querySelector('#toggle_data').onclick = () => { samSettings.data_enable = !samSettings.data_enable; renderTabContent(); };
            C.querySelector('#toggle_skip').onclick = () => { samSettings.skipWIAN_When_summarizing = !samSettings.skipWIAN_When_summarizing; renderTabContent(); };
            C.querySelector('#btn_save_global').onclick = () => {
                saveSamSettings(); toastr.success("设置已保存");
            };
            C.querySelector('#btn_export').onclick = () => {
                const settingsToExport = _.cloneDeep(samSettings);
                delete settingsToExport.api_presets;
                const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], {type:'application/json'});
                const a = v.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sam_settings.json'; a.click();
            };
            const fileInput = C.querySelector('#file_import');
            C.querySelector('#btn_import').onclick = () => fileInput.click();
            fileInput.onchange = (e) => {
                const file = e.target.files[0]; if(!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const newSettings = JSON.parse(ev.target.result);
                        Object.assign(samSettings, newSettings);
                        saveSamSettings(); toastr.success("设置已导入");
                    } catch(err) { toastr.error("导入失败"); }
                };
                reader.readAsText(file);
            };
        }
        else if (T === 'DATA') { C.querySelector('#btn_commit_data').onclick = commitDataFromUI; }
        else if (T === 'CONNECTIONS' || T === 'FUNCS' || T === 'REGEX') {
            const isFunc = T === 'FUNCS';
            const isRegex = T === 'REGEX';
            const sourceArr = isFunc ? samFunctions : (samSettings.regexes ||[]);
            const selectedIdx = isFunc ? 'selectedFuncIndex' : 'selectedRegexIndex';
            const addBtnId = isFunc ? 'btn_add_func' : 'btn_add_regex';
            const saveBtnId = isFunc ? 'btn_save_funcs' : 'btn_save_regexes';
            const listId = isFunc ? 'func_list' : 'regex_list';

            if (isFunc || isRegex) {
                C.querySelector(`#${addBtnId}`).onclick = () => {
                    const newItem = isFunc ? { func_name: "新函数", func_params:[], func_body: "//..." } : { name: "新正则", regex_body: "", enabled: true };
                    sourceArr.push(newItem);
                    UI_STATE[selectedIdx] = sourceArr.length - 1;
                    renderTabContent();
                };
                 C.querySelector(`#${saveBtnId}`).onclick = async () => {
                    if(isFunc) await saveFunctionsToWI(samFunctions); else { samSettings.regexes = sourceArr; saveSamSettings(); toastr.success("正则表达式已保存"); }
                };
                C.querySelector(`#${listId}`).onclick = (e) => {
                    const li = e.target.closest('li');
                    if(!li) return;
                    const idx = parseInt(li.dataset.idx);
                    if (e.target.classList.contains('sam_delete_icon')) {
                        sourceArr.splice(idx, 1);
                        if (UI_STATE[selectedIdx] === idx) UI_STATE[selectedIdx] = -1;
                    } else { UI_STATE[selectedIdx] = idx; }
                    renderTabContent();
                };
                const detail = C.querySelector('.sam_detail');
                if (detail && UI_STATE[selectedIdx] !== -1) {
                    detail.oninput = (e) => {
                        const field = e.target.dataset.field;
                        if(field === "func_params") sourceArr[UI_STATE[selectedIdx]][field] = e.target.value.split(',').map(s=>s.trim());
                        else sourceArr[UI_STATE[selectedIdx]][field] = e.target.value;
                    };
                    detail.onclick = (e) => {
                        const toggle = e.target.closest('.sam_toggle');
                        if (toggle) {
                            const field = toggle.dataset.field;
                            sourceArr[UI_STATE[selectedIdx]][field] = !sourceArr[UI_STATE[selectedIdx]][field];
                            toggle.firstElementChild.classList.toggle('on');
                        }
                    };
                }
            } else { // Connections
                C.querySelector('#preset_list').onclick = (e) => {
                    const li = e.target.closest('li'); if(!li) return;
                    const idx = parseInt(li.dataset.idx);
                    if (e.target.classList.contains('sam_delete_icon')) {
                        const presetName = apiManager.getAllPresets()[idx].name;
                        apiManager.deletePreset(presetName);
                        if(samSettings.summary_api_preset === presetName) samSettings.summary_api_preset = null;
                        UI_STATE.selectedPresetIndex = -1;
                    } else { UI_STATE.selectedPresetIndex = idx; }
                    renderTabContent();
                };
                C.querySelector('#btn_add_preset').onclick = () => {
                    apiManager.savePreset(`新预设 ${apiManager.getAllPresets().length + 1}`, { apiMode: 'custom', apiConfig: { source: 'custom' } });
                    UI_STATE.selectedPresetIndex = apiManager.getAllPresets().length - 1;
                    renderTabContent();
                };
                const detail = C.querySelector('.sam_detail');
                if (detail && UI_STATE.selectedPresetIndex !== -1) {
                    C.querySelector('#btn_save_preset').onclick = () => {
                        const oldName = apiManager.getAllPresets()[UI_STATE.selectedPresetIndex].name;
                        const newName = C.querySelector('#preset_name').value;
                        const mode = C.querySelector('#preset_mode').value;
                        let conf = { name: newName, apiMode: mode, apiConfig: {} };
                        if (mode === 'custom') {
                            conf.apiConfig = {
                                source: C.querySelector('#preset_source').value, url: C.querySelector('#preset_url').value,
                                apiKey: C.querySelector('#preset_key').value, proxyPassword: C.querySelector('#preset_pwd').value,
                                model: C.querySelector('#preset_model').value
                            };
                        }
                        if (oldName !== newName) apiManager.deletePreset(oldName);
                        apiManager.savePreset(newName, conf);
                        toastr.success("预设已保存");
                    };
                    C.querySelector('#btn_set_active_preset').onclick = () => {
                        const name = apiManager.getAllPresets()[UI_STATE.selectedPresetIndex].name;
                        samSettings.summary_api_preset = name;
                        saveSamSettings(); toastr.success(`"${name}" 设为默认预设`);
                    };
                }
            }
        }
    }
  
    function buildWidgetHTML() {
        try {
            if (!v.body) return false;
            const exist = v.getElementById(WIDGET_ID); if (exist) exist.remove();
            
            const c = v.createElement("div"); c.id = WIDGET_ID;
            // Initially hide the widget, until `loadContextData` confirms SAM ID presence
            c.style.display = 'none';
            c.innerHTML = `
              <button class="th-asr-fab" title="${APP_NAME}">
                <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2" fill="none"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
              </button>
              <div class="th-asr-panel" hidden>
                <div class="sam_modal_header">
                  <div class="sam_header_title"><span class="sam_brand">SAM</span> 管理器 <span class="sam_version">v${SCRIPT_VERSION}</span></div>
                  <button class="sam_close_icon" id="sam_btn_close">✕</button>
                </div>
                <div class="sam_tabs">
                    <button class="sam_tab active" data-tab="SUMMARY">摘要</button>
                    <button class="sam_tab" data-tab="CONNECTIONS">连接</button>
                    <button class="sam_tab" data-tab="REGEX">正则</button>
                    <button class="sam_tab" data-tab="DATA">数据</button>
                    <button class="sam_tab" data-tab="FUNCS">函数</button>
                    <button class="sam_tab" data-tab="SETTINGS">设置</button>
                </div>
                <div class="sam_content_area" id="sam_tab_content"></div>
                <div class="sam_modal_footer">
                    <div class="sam_status_bar" id="sam_status_display">初始化中...</div>
                    <div class="sam_actions"><button class="sam_btn sam_btn_secondary" id="sam_btn_refresh">重载数据</button></div>
                </div>
              </div>
            `;
            v.body.appendChild(c);
            
            k.widget = c; 
            k.panel = c.querySelector(".th-asr-panel"); 
            k.fab = c.querySelector(".th-asr-fab");
            k.contentArea = c.querySelector("#sam_tab_content"); 
            k.statusText = c.querySelector("#sam_status_display");
            
            if (!k.widget || !k.panel || !k.fab || !k.contentArea) throw new Error("Missing Elements");
            
            const header = c.querySelector(".sam_modal_header");
            
            O(k.fab, "click", () => { if ("1"!==k.widget.dataset.dragging) togglePanel(true); });
            O(c.querySelector("#sam_btn_close"), "click", () => togglePanel(false));
            O(c.querySelector("#sam_btn_refresh"), async () => { await loadContextData(); renderTabContent(); toastr.info("数据已重载"); });
            
            c.querySelectorAll('.sam_tab').forEach(tab => {
                O(tab, "click", (e) => {
                    c.querySelectorAll('.sam_tab').forEach(t=>t.classList.remove('active'));
                    tab.classList.add('active');
                    UI_STATE.activeTab = tab.dataset.tab;
                    renderTabContent();
                });
            });
            
            let drag = { active: false, id: null, sX: 0, sY: 0, oL: 0, oT: 0 };
            const onDown = (e) => {
                if (e.target.closest("button,input,textarea,select,.sam_toggle")) return;
                const rect = k.widget.getBoundingClientRect();
                drag = { active: true, id: e.pointerId, sX: e.clientX, sY: e.clientY, oL: rect.left, oT: rect.top };
                k.widget.dataset.dragging = "0"; e.preventDefault();
            };
            const onMove = (e) => {
                if (!drag.active || (drag.id !== null && e.pointerId !== drag.id)) return;
                const dx = e.clientX - drag.sX; const dy = e.clientY - drag.sY;
                if (Math.abs(dx)+Math.abs(dy) > 4) k.widget.dataset.dragging = "1";
                let nL = drag.oL + dx; let nT = drag.oT + dy;
                k.widget.style.left = `${nL}px`; k.widget.style.top = `${nT}px`;
            };
            const onUp = () => { if (drag.active) { drag.active = false; setTimeout(() => { k.widget.dataset.dragging = "0"; }, 0); } };
            
            O(k.fab, "pointerdown", onDown); O(header, "pointerdown", onDown);
            O(v, "pointermove", onMove); O(v, "pointerup", onUp); O(v, "pointercancel", onUp);
            
            k.widget.style.left = `${Math.max(8, y.innerWidth - 64)}px`;
            k.widget.style.top = `${Math.max(8, Math.min(y.innerHeight - 64, 120))}px`;

            return true;
        } catch (e) {
            logger.error("Widget creation failed:", e);
            return false;
        }
    }
  
    function togglePanel(open) {
        UI_STATE.panelOpen = open;
        k.panel.hidden = !open;
        if (open) {
            k.widget.style.left = `${Math.max(8, (y.innerWidth - k.panel.offsetWidth)/2)}px`;
            k.widget.style.top = `${Math.max(8, (y.innerHeight - k.panel.offsetHeight)/2)}px`;
            renderTabContent();
        } else {
            k.widget.style.left = `${Math.max(8, y.innerWidth - 64)}px`;
            k.widget.style.top = `${Math.max(8, Math.min(y.innerHeight - 64, 120))}px`;
        }
    }
  
    // ========================================================================
    // 9. 初始化与上下文加载
    // ========================================================================
    async function loadContextData() {
        await checkWorldInfoActivation();
        loadSamSettings();
        samFunctions = await getFunctionsFromWI();
        let d = SillyTavern.getContext().variables.local.get("SAM_data");
        if (d && typeof d === 'object') { _.defaultsDeep(d, INITIAL_STATE); samData = d; } 
        else { samData = goodCopy(INITIAL_STATE); SillyTavern.getContext().variables.local.set("SAM_data", samData); }
        await initializeDatabase(samData.jsondb);
        updateUIStatus();

        // Control Widget Visibility dynamically based on ID presence in the context
        if (k.widget) {
            k.widget.style.display = go_flag ? 'block' : 'none';
        }
    }
  
    async function initSAM() {
        if (typeof tavern_events === 'undefined') { logger.warn("Not in ST environment."); return; }
        
        loadSamSettings();
        apiManager = new APIManager({ initialPresets: samSettings.api_presets, onUpdate: (p) => { samSettings.api_presets = p; saveSamSettings(); } });
        
        bindTavernEvent(tavern_events.MESSAGE_SENT, () => pushEvent(tavern_events.MESSAGE_SENT));
        bindTavernEvent(tavern_events.GENERATION_STARTED, (type, dry) => { if (dry) current_run_is_dry = true; else pushEvent(tavern_events.GENERATION_STARTED); });
        bindTavernEvent(tavern_events.GENERATION_ENDED, () => pushEvent(tavern_events.GENERATION_ENDED));
        bindTavernEvent(tavern_events.GENERATION_STOPPED, () => pushEvent(tavern_events.GENERATION_STOPPED));
        bindTavernEvent(tavern_events.MESSAGE_SWIPED, async () => { await loadContextData(); pushEvent(tavern_events.MESSAGE_SWIPED); });
        bindTavernEvent(tavern_events.CHAT_CHANGED, async () => { await loadContextData(); });
  
        await loadContextData();
        
        logger.info(`SAM Core Engine V${SCRIPT_VERSION} fully loaded.`);
    }
  
    y[INSTANCE_KEY] = { 
        stop: () => { 
            while(P.length) { 
                try { P.pop()(); } catch(e) {} 
            } 
            try { if(k.widget) k.widget.remove(); } catch(e) {}
            cleanupDOM(); 
            delete y[INSTANCE_KEY]; 
        } 
    };

    const startup = () => {
        Nn();
        // Self-destruct sequence if Widget DOM creation fails (or environment blocks UI)
        if (!buildWidgetHTML()) {
            logger.error("Failed to build widget. Self-destructing script instance.");
            if (y[INSTANCE_KEY] && typeof y[INSTANCE_KEY].stop === 'function') {
                y[INSTANCE_KEY].stop();
            }
            return;
        }
        initSAM();
    };
    
    if (v.readyState === "loading") { O(v, "DOMContentLoaded", startup, { once: true }); } 
    else { startup(); }
  
  })());