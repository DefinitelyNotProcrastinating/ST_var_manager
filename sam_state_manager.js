$((() => {
    "use strict";

    // ========================================================================
    // 1. 基础配置与标识常量 (Base Configuration & Constants)
    // ========================================================================
    const INSTANCE_KEY = "__sam_core_widget_v6__";
    const STYLE_ID = "sam-core-widget-style";
    const WIDGET_ID = "sam-core-widget-root";
    const APP_NAME = "SAM 核心管理器";

    const SCRIPT_VERSION = "6.2.11 'Lone star'"; 
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";
    const MINISEARCH_URL = "https://cdn.jsdelivr.net/npm/minisearch@6.3.0/dist/umd/index.min.js";

    //[RESTORED FROM V5] Key for cleaning up old instances on script reload
    const HANDLER_STORAGE_KEY = `__SAM_V6_EVENT_HANDLER_STORAGE__`;

    // Local module references to replace global window dependencies
    let local_jsonrepair = null;
    let local_MiniSearch = null;

    // Regex to find and extract content from <JSONPatch> blocks.
    const UPDATE_BLOCK_EXTRACT_REGEX = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/gim;
    const UPDATE_BLOCK_REMOVE_REGEX = /<JSONPatch>[\s\S]*?<\/JSONPatch>/gim;

    // Legacy & New Checkpoint Block Regexes (Restored Functionality)
    const OLD_START_MARKER = '$$$$$$data_block$$$$$$';
    const OLD_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const OLD_STATE_PARSE_REGEX = new RegExp(`${OLD_START_MARKER.replace(/\$/g, '\\$')}\\s*([\\s\\S]*?)\\s*${OLD_END_MARKER.replace(/\$/g, '\\$')}`, 's');
    const OLD_STATE_REMOVE_REGEX = new RegExp(`${OLD_START_MARKER.replace(/\$/g, '\\$')}[\\s\\S]*?${OLD_END_MARKER.replace(/\$/g, '\\$')}`, 'sg');

    // Kept solely for backwards compatibility with any existing V6 blocks in chat history
    const CHECKPOINT_REGEX = /<SAMCheckpoint>([\s\S]*?)<\/SAMCheckpoint>/s;
    const CHECKPOINT_STRIP_REGEX = /(?:<!-- SAM_CHECKPOINT -->\s*)?<SAMCheckpoint>[\s\S]*?<\/SAMCheckpoint>/sg;

    // Thread Yielding for Mobile (Restored Functionality)
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const DELAY_MS = isMobileDevice ? 10 : 5;

    const INITIAL_STATE = {
        static: {}, time: "", dtime: 0, volatile:[],
        responseSummary: { L1:[], L2:[], L3:[] },
        summary_progress: 0,
        summary_failed_progress: -1,
        jsondb: null,
        func:[], events:[], event_counter: 0
    };

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING", SUMMARIZING: "SUMMARIZING" };
    const SAM_FUNCTIONLIB_ID = "__SAM_IDENTIFIER__";
    const SAM_BASEDATA_ID = "__SAM_base_data__";
    const MODULE_NAME = 'sam_extension';

    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";
    const SAM_RESPONSE_PROCESSING_COMPLETED = 'SAM_RESPONSE_PROCESSING_COMPLETED';
    const WATCHER_INTERVAL_MS = 3000;

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
        summary_prompt: `请仔细审查下方提供的聊天记录和现有设定。你的任务包含两部分，并需严格按照指定格式输出：\n\n1. **L2摘要**: 将“新内容”合并成一段连贯的摘要。在摘要中，每个对应原始消息的事件都必须在其句首注明编号。\n2. **插入指令**: 对比“新内容”和“现有设定”。只为在“现有设定”中不存在的关键信息生成插入指令。指令必须使用我们扩展的 JSON Patch 格式，并包裹在 <JSONPatch> 标签内。支持的op包含: replace, remove, delta, insert, inc, mul, push, addToSet, pull, pop, min, max, move。例如:\n<JSONPatch>\n[\n  { "op": "delta", "path": "/gold", "value": 10 }\n]\n</JSONPatch>\n\n**最终输出格式要求：**\n必须先输出完整的L2摘要，然后另起一行输出所有的 <JSONPatch> 块。\n---\n现有设定:\n{{db_content}}\n---\n新内容:\n{{chat_content}}\n---`,
        summary_prompt_L3: `You are a summarization expert. Review the following list of sequential event summaries (L2 summaries). Your task is to condense them into a single, high-level narrative paragraph (an L3 summary). Focus on the most significant developments.\n\n---\n**Summaries to Condense:**\n{{summary_content}}\n---`
    };

    // ========================================================================
    // 2. 环境解析与全局实例清理
    // ========================================================================
    const y = (function () { try { if (window.top && window.top.document) return window.top; } catch (err) {} return window; })();
    const v = (function (contextWindow) { try { if (contextWindow && contextWindow.document) return contextWindow.document; } catch (err) {} return document; })(y);

    // UI 内部状态引用声明
    const k = { widget: null, panel: null, fab: null, header: null, contentArea: null, statusText: null, depsText: null };

    // [RESTORED FROM V5] Cleanup function for hot-reloading context
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
        delete window[HANDLER_STORAGE_KEY];
        console.log(`[${APP_NAME}] Cleaned up previous instance event listeners.`);
    };

    function cleanupDOM() {
        try {
            const w = v.getElementById(WIDGET_ID); if (w) w.remove();
            const s = v.getElementById(STYLE_ID); if (s) s.remove();
            const wd = v.getElementById("sam-watchdog-script"); if (wd) wd.remove();
            k.widget = null; k.panel = null; k.fab = null; k.header = null; k.contentArea = null; k.statusText = null; k.depsText = null;
        } catch(e) {}
    }

    if (window[INSTANCE_KEY] && "function" == typeof window[INSTANCE_KEY].stop) {
      try { window[INSTANCE_KEY].stop(); } catch (err) {}
    }
    cleanupDOM();

    // ========================================================================
    // 3. 统一全局状态
    // ========================================================================
    const cleanup_pool =[]; // 事件清理池
    const _loadingLibraries = {};
    const logger = {
        info: (...args) => console.log(`[${APP_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${APP_NAME}]`, ...args),
        error: (...args) => console.error(`[${APP_NAME}]`, ...args),
        shoutInfo: (...args) => toastr.info(`[${APP_NAME}]`, ...args),
        shoutError: (...args) => toastr.error(`[${APP_NAME}]`, ...args)
    };

    // [RESTORED FROM V5] State variables including explicit lock and explicit cache
    let curr_state = STATES.IDLE;
    const event_queue =[];
    let isDispatching = false;
    let isProcessingState = false; 
    let isCheckpointing = false;
    let prevState = null; 
    let generationWatcherId = null; 
    let current_run_is_dry = false;
    let go_flag = false;

    // --- 数据与UI状态 ---
    let samSettings = structuredClone(DEFAULT_SETTINGS);
    let samData = goodCopy(INITIAL_STATE);
    let samFunctions =[];

    let sam_db = null;
    let apiManager = null;

    let UI_STATE = {
        panelOpen: false, uiLeft: null, uiTop: null, fabSizePx: 48,
        activeTab: 'SUMMARY',
        selectedFuncIndex: -1,
        selectedPresetIndex: -1,
        selectedRegexIndex: -1
    };

    window[INSTANCE_KEY] = {
        stop: function () {
            for (; cleanup_pool.length;) {
                const cb = cleanup_pool.pop();
                try { cb(); } catch(e){}
            }
            cleanupDOM();
        }
    };

    async function chunkedStringify(obj) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(JSON.stringify(obj, null, 2)); }, DELAY_MS);
        });
    }

    // ========================================================================
    // 4. SAMDatabase 类封装 (No changes needed)
    // ========================================================================
    class SAMDatabase {
        constructor({ enabled = true } = {}) {
            this.isEnabled = enabled;
            this.miniSearch = null;
            this.documentMap = new Map();
            this.isInitialized = false;
            this.miniSearchConfig = { fields:['key', 'keywords'], storeFields: ['key'], idField: 'key' };
        }
        async init() {
            if (!this.isEnabled || this.isInitialized) return this.isInitialized;
            try {
                if (!local_MiniSearch) await loadExternalLibrary(MINISEARCH_URL, 'MiniSearch');
                if (local_MiniSearch) {
                    this.miniSearch = new local_MiniSearch(this.miniSearchConfig);
                    this.isInitialized = true;
                    return true;
                } else {
                    logger.warn("DB init skipped: MiniSearch library not available.");
                    this.isEnabled = false;
                    return false;
                }
            } catch (error) { logger.warn("DB init failed.", error); this.isEnabled = false; return false; }
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
                if (!local_MiniSearch || typeof local_MiniSearch.loadJSON !== 'function') throw new Error("MiniSearch not fully loaded.");
                this.miniSearch = local_MiniSearch.loadJSON(JSON.stringify(data.miniSearchIndex), this.miniSearchConfig);
                this.documentMap = new Map(Object.entries(data.documentMap));
                this.isInitialized = true;
                return true;
            } catch (error) { logger.warn("DB import failed.", error); return false; }
        }
    }

    // ========================================================================
    // 5. APIManager 类封装 (No changes needed)
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
                const response = await generateRaw({ ordered_prompts: orderedMessages, should_stream: false }, abortSignal);
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
    // 6. 基础工具与状态操作函数
    // ========================================================================

    // [RESTORED FROM V5] Generation Watcher functions
    function stopGenerationWatcher() {
        if (generationWatcherId) {
            clearInterval(generationWatcherId);
            generationWatcherId = null;
        }
    }

    function startGenerationWatcher() {
        stopGenerationWatcher(); 
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
                logger.warn("Generation Watchdog: UI generation stopped, but no 'ended' event received. Forcing completion.");
                stopGenerationWatcher();
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);
            } else if (curr_state !== STATES.AWAIT_GENERATION) {
                stopGenerationWatcher();
            }
        }, WATCHER_INTERVAL_MS);
    }

    function findLatestUserMsgIndex() {
        const chat = SillyTavern.getContext().chat;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user) { return i; }
        }
        return -1; 
    }

    function findLastAiMessageAndIndex() {
        const chat = SillyTavern.getContext().chat;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_user) { return i; }
        }
        return -1; 
    }

    function add_event_listener(elem, type, listener, options) {
        if (elem && "function" == typeof elem.addEventListener && "function" == typeof elem.removeEventListener) {
            elem.addEventListener(type, listener, options);
            cleanup_pool.push(() => elem.removeEventListener(type, listener, options));
        }
    }

    function bindTavernEvent(eventName, handler) {
        eventOn(eventName, handler);
        cleanup_pool.push(() => {eventRemoveListener(eventName, handler); });
    }

    async function loadExternalLibrary(url, libName) {
        if (libName === 'jsonrepair' && local_jsonrepair) return true;
        if (libName === 'MiniSearch' && local_MiniSearch) return true;

        if (_loadingLibraries[url]) return await _loadingLibraries[url];

        logger.info(`Downloading external library: ${libName}...`);

        _loadingLibraries[url] = (async () => {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const code = await response.text();

                const mockModule = { exports: {} };
                const fn = new Function('module', 'exports', code);
                fn(mockModule, mockModule.exports);

                let exported = mockModule.exports;
                if (exported && typeof exported !== 'function') {
                    if (exported[libName]) exported = exported[libName];
                    else if (exported.default) exported = exported.default;
                }

                if (libName === 'jsonrepair') local_jsonrepair = exported;
                if (libName === 'MiniSearch') local_MiniSearch = exported;

                logger.info(`Library ${libName} loaded successfully.`);
                updateUIStatus();
                return true;
            } catch (error) {
                logger.warn(`Failed to load script: ${url}`, error);
                updateUIStatus();
                return false;
            } finally {
                delete _loadingLibraries[url];
            }
        })();

        return await _loadingLibraries[url];
    }

    function goodCopy(state) { return _.cloneDeep(state || INITIAL_STATE); }

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

    async function getBaseDataFromWI() {
        try {
            const characterId = SillyTavern.getContext().characterId;
            if (characterId === null || characterId < 0) return null;
            const worldInfoName = SillyTavern.getContext().characters[characterId]?.data?.extensions?.world;
            if (!worldInfoName) return null;
            const wiData = await SillyTavern.getContext().loadWorldInfo(worldInfoName);
            const baseDataEntry = Object.values(wiData?.entries || {}).find(e => e.comment === SAM_BASEDATA_ID);
            return baseDataEntry && baseDataEntry.content ? JSON.parse(baseDataEntry.content) : null;
        } catch (e) { return null; }
    }

    async function saveFunctionsToWI(functions) {
        if (!go_flag) { toastr.error("无法保存: 世界信息中未找到SAM标识符。"); return; }
        const characterId = SillyTavern.getContext().characterId;
        if (characterId === null || characterId < 0) { toastr.error("此角色没有关联的世界信息文件。"); return; }
        const characterWIName = SillyTavern.getContext().characters[characterId]?.data?.extensions?.world;
        if (!characterWIName) { toastr.error("此角色没有关联的世界信息文件。"); return; }

        try {
            const worldbook = await getWorldbook(characterWIName);
            const entryKey = _.findKey(worldbook, (entry) => entry.name.includes(SAM_FUNCTIONLIB_ID));
            const content = JSON.stringify(functions, null, 2);

            if (entryKey !== undefined) {
                worldbook[entryKey].content = content;
                await replaceWorldbook(characterWIName, worldbook);
                toastr.success("函数已成功保存至世界信息。");
            } else {
                toastr.warning("未找到SAM函数库条目，请先在世界信息中手动创建一个comment为'__SAM_IDENTIFIER__'的条目。");
            }
        } catch (e) { console.error(e); toastr.error("保存函数至世界信息失败。"); }
    }

    async function initializeDatabase(dbStateJson = null) {
        if (!sam_db) sam_db = new SAMDatabase({ enabled: true });
        await sam_db.init();
        if (dbStateJson) {
            try { sam_db.import(dbStateJson); } catch(e){}
        }
    }
    function serialize_db() {
        if (sam_db && sam_db.isInitialized) {
            const allMemos = sam_db.getAllMemosAsObject(); // Assuming this is synchronous
            if (allMemos && Object.keys(allMemos).length > 0) {
                return Object.entries(allMemos).map(([k, v]) => `Key: ${k}\nContent: ${v}`).join('\n\n');
            }
        }
        return "尚未储存任何设定。";
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
        const fetchImpl = funcDef.network_access ? window.fetch.bind(window) : () => { throw new Error('Network disabled'); };

        const execPromise = new Promise(async (resolve, reject) => {
            try {
                const userFunc = new Function('state', '_', 'fetch', 'XMLHttpRequest', ...formalParamNames, `'use strict';\n${bodyPrologue}${funcDef.func_body}`);
                resolve(await userFunc.apply(null,[state, _, fetchImpl, null, ...params]));
            } catch (err) { reject(err); }
        });
        try {
            await Promise.race([execPromise, new Promise((_, r) => setTimeout(()=>r(new Error("Timeout")), timeout))]); }
        catch(e) {
            logger.error(`Function "${funcName}" execution failed:`, e);
        }
    }

    function parseJsonPointer(pointer) {
        if (typeof pointer !== 'string' || pointer.length === 0 || pointer[0] !== '/') {
            throw new Error(`Invalid JSON Pointer: must be a string starting with '/'. Received: ${pointer}`);
        }
        if (pointer === '/') return[];
        return pointer.substring(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    }

    function generateJSONPatch(obj1, obj2) {
        const patches =[];

        function escapePath(str) {
            return String(str).replace(/~/g, '~0').replace(/\//g, '~1');
        }

        function diff(a, b, path) {
            if (a === b) return;

            if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
                if (Array.isArray(a) && Array.isArray(b)) {
                    const minLen = Math.min(a.length, b.length);
                    for (let i = 0; i < minLen; i++) { diff(a[i], b[i], `${path}/${i}`); }
                    if (b.length > a.length) {
                        for (let i = a.length; i < b.length; i++) { patches.push({ op: 'insert', path: `${path}/${i}`, value: b[i] }); }
                    } else if (a.length > b.length) {
                        for (let i = a.length - 1; i >= b.length; i--) { patches.push({ op: 'remove', path: `${path}/${i}` }); }
                    }
                } else if (!Array.isArray(a) && !Array.isArray(b)) {
                    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
                    for (const key of keys) {
                        const newPath = `${path}/${escapePath(key)}`;
                        if (!b.hasOwnProperty(key)) { patches.push({ op: 'remove', path: newPath }); } 
                        else if (!a.hasOwnProperty(key)) { patches.push({ op: 'insert', path: newPath, value: b[key] }); } 
                        else { diff(a[key], b[key], newPath); }
                    }
                } else { patches.push({ op: 'replace', path: path, value: b }); }
            } else { patches.push({ op: 'replace', path: path, value: b }); }
        }

        diff(obj1, obj2, '');
        return patches;
    }

    async function applyOperationsToState(operations, state, isLiveGeneration = false) {
        if (!operations || operations.length === 0) return { state, generatedDiffs:[] };

        let generatedDiffs =[];

        for (const op of operations) {
            if (!op || !op.op) continue;
            try {
                if (['replace', 'remove', 'inc', 'mul', 'push', 'addToSet', 'pull', 'pop', 'min', 'max', 'move', 'insert', 'delta'].includes(op.op)) {
                    let pathStr = op.path !== undefined ? op.path : op.from;
                    if (typeof pathStr === 'string') {
                        const pathKeys = parseJsonPointer(pathStr);

                        // skip readonly vars
                        if (pathKeys.length > 0 && pathKeys[0].startsWith('_')) {
                            logger.warn(`Skipping operation on read-only variable: ${pathStr}`);
                            continue;
                        }

                        let currentVal = _.get(state.static, pathKeys);

                        switch(op.op) {
                            case 'insert':
                                if (pathStr.endsWith('/-')) {
                                    const parentPath = pathStr === '/-' ? '/' : pathStr.slice(0, -2);
                                    const parentKeys = parseJsonPointer(parentPath);
                                    let parentVal = parentKeys.length ? _.get(state.static, parentKeys) : state.static;
                                    if (!Array.isArray(parentVal)) {
                                        parentVal =[];
                                        if(parentKeys.length) _.set(state.static, parentKeys, parentVal);
                                    }
                                    parentVal.push(op.value);
                                } else { _.set(state.static, pathKeys, op.value); }
                                break;
                            case 'replace': _.set(state.static, pathKeys, op.value); break;
                            case 'remove': _.unset(state.static, pathKeys); break;
                            case 'delta': case 'inc': _.set(state.static, pathKeys, (typeof currentVal === 'number' ? currentVal : 0) + (Number(op.value) || 0)); break;
                            case 'mul': _.set(state.static, pathKeys, (typeof currentVal === 'number' ? currentVal : 0) * (Number(op.value) || 1)); break;
                            case 'min': if (typeof currentVal !== 'number' || op.value < currentVal) _.set(state.static, pathKeys, op.value); break;
                            case 'max': if (typeof currentVal !== 'number' || op.value > currentVal) _.set(state.static, pathKeys, op.value); break;
                            case 'push':
                                if (!Array.isArray(currentVal)) { currentVal =[]; _.set(state.static, pathKeys, currentVal); }
                                if (op.value && typeof op.value === 'object' && op.value.$each && Array.isArray(op.value.$each)) {
                                    currentVal.push(...op.value.$each);
                                } else { currentVal.push(op.value); }
                                break;
                            case 'addToSet':
                                if (!Array.isArray(currentVal)) { currentVal =[]; _.set(state.static, pathKeys, currentVal); }
                                const itemsToAdd = (op.value && typeof op.value === 'object' && op.value.$each && Array.isArray(op.value.$each)) ? op.value.$each :[op.value];
                                itemsToAdd.forEach(item => { if (!currentVal.some(existing => _.isEqual(existing, item))) currentVal.push(item); });
                                break;
                            case 'pop':
                                if (Array.isArray(currentVal) && currentVal.length > 0) {
                                    if (op.value === 1) currentVal.pop();
                                    else if (op.value === -1) currentVal.shift();
                                }
                                break;
                            case 'pull':
                                if (Array.isArray(currentVal)) {
                                    _.remove(currentVal, item => {
                                        if (typeof op.value === 'object' && op.value !== null) return _.isMatch(item, op.value) || _.isEqual(item, op.value);
                                        return item === op.value;
                                    });
                                }
                                break;
                            case 'move':
                                if (currentVal !== undefined && typeof op.to === 'string') {
                                    const targetKeys = parseJsonPointer(op.to);
                                    _.set(state.static, targetKeys, currentVal);
                                    _.unset(state.static, pathKeys);
                                }
                                break;
                        }
                    }
                } else if (op.op === 'time') {
                    if (typeof op.value === 'string') {
                        if (state.time) {
                            var d = new Date(op.value) - new Date(state.time);
                            state.dtime = isNaN(d) ? 0 : d;
                        } else { state.dtime = 0; }
                        state.time = op.value;
                    }
                } else if (op.op === 'func') {
                    if (typeof op.func_name === 'string') {
                        const params = Array.isArray(op.params) ? op.params :[];
                        const preState = isLiveGeneration ? goodCopy(state.static) : null;

                        await runSandboxedFunction(op.func_name, params, state);

                        if (isLiveGeneration && preState) {
                            const diffs = generateJSONPatch(preState, state.static);
                            if (diffs && diffs.length > 0) { generatedDiffs.push(...diffs); }
                        }
                    }
                }
            } catch(e) { logger.error(`Failed to apply operation:`, op, e); }
        }
        return { state, generatedDiffs };
    }

    async function extractOperationsFromText(messageContent) {
        const operations =[];
        let match;
        UPDATE_BLOCK_EXTRACT_REGEX.lastIndex = 0;
        while ((match = UPDATE_BLOCK_EXTRACT_REGEX.exec(messageContent)) !== null) {
            let content = match[1].trim();
            if (!content) continue;
            if (!content.startsWith('[') && !content.endsWith(']')) { content = `[${content}]`; }
            try {
                if (!local_jsonrepair) await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                let textToParse = content;
                if (local_jsonrepair) { try { textToParse = local_jsonrepair(content); } catch (e) {} }

                const parsedData = JSON.parse(textToParse);
                if (Array.isArray(parsedData)) operations.push(...parsedData);
                else if (typeof parsedData === 'object' && parsedData !== null) operations.push(parsedData);
            } catch (e) {
                logger.error("Skipping malformed <JSONPatch> block due to parsing error:", e, "\nContent:", match[1]);
                if (typeof toastr !== 'undefined') toastr.warning("SAM: Skipped a malformed data block.", "Parsing Warning");
            }
        }
        return operations;
    }

    async function buildStateFromHistory(targetIndex) {
        const chat = SillyTavern.getContext().chat;
        let rebuiltState = goodCopy(INITIAL_STATE);
        let checkpointIndex = -1;

        if (samData) {
            rebuiltState.jsondb = samData.jsondb;
            rebuiltState.responseSummary = _.cloneDeep(samData.responseSummary);
            rebuiltState.summary_progress = samData.summary_progress;
            rebuiltState.summary_failed_progress = samData.summary_failed_progress || -1;
        }

        // 1. Trace BACKWARDS to find the latest Checkpoint
        for (let i = targetIndex; i >= 0; i--) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;

            const v6Match = msg.mes.match(CHECKPOINT_REGEX);
            if (v6Match && v6Match[1]) {
                try {
                    const parsed = JSON.parse(v6Match[1].trim());
                    rebuiltState = _.merge({}, rebuiltState, parsed);
                    checkpointIndex = i;
                    break;
                } catch (e) {}
            }

            const v5Match = msg.mes.match(OLD_STATE_PARSE_REGEX);
            if (v5Match && v5Match[1]) {
                try {
                    const parsed = JSON.parse(v5Match[1].trim());
                    rebuiltState = _.merge({}, rebuiltState, parsed);
                    checkpointIndex = i;
                    break;
                } catch (e) {}
            }
        }

        // 2. Load Base Data if no checkpoint found
        if (checkpointIndex === -1 && targetIndex >= 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) rebuiltState.static = _.merge({}, rebuiltState.static, baseData);
        }

        // 3. Trace FORWARD from the checkpoint
        const startIndex = checkpointIndex === -1 ? 0 : checkpointIndex + 1;
        const limit = Math.min(targetIndex, chat.length - 1);

        for (let i = startIndex; i <= limit; i++) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;

            const ops = await extractOperationsFromText(msg.mes);
            if (ops.length > 0) {
                const { state } = await applyOperationsToState(ops, rebuiltState, false);
                rebuiltState = state;
            }
        }
        return rebuiltState;
    }

    // [RESTORED FROM V5] Exact memory caching logic
    async function loadStateToMemory(targetIndex) {

        console.log("Loading state to memory for target index:", targetIndex);
        const chat = SillyTavern.getContext().chat;
        if (targetIndex === "{{lastMessageId}}") { targetIndex = chat.length - 1; }
        
        let state = await buildStateFromHistory(targetIndex);
        
        if (targetIndex === 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) { state.static = _.merge({}, state.static, baseData); }
        }
        
        samData = state; 
        await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(state)); return variables });
        updateUIStatus();
        return state;
    }

    // [RESTORED FROM V5] The explicit sync function
    async function sync_latest_state() {
        logger.info("Synchronizing SAM state with the latest chat history.");
        let lastAiIndex = findLastAiMessageAndIndex();
        await loadStateToMemory(lastAiIndex);
        if (UI_STATE.panelOpen) { renderTabContent(); }
    }

    // ========================================================================
    // 7. 自动总结 (Auto-Summary) & 数据写入流程
    // ========================================================================
    
    async function triggerSummaryCheck(currentIndex) {
        await checkWorldInfoActivation();
        if (!go_flag || !samSettings.data_enable) return;

        const period = samSettings.summary_levels.L2.frequency;
        const last_progress = samData.summary_progress || 0;
        const last_failed = samData.summary_failed_progress || -1;
        
        const effective_baseline = Math.max(last_progress, last_failed);

        if (currentIndex - effective_baseline >= period) {
            logger.info(`Summary threshold reached (${currentIndex - effective_baseline}/${period}).`);
            curr_state = STATES.SUMMARIZING; updateUIStatus();
            
            const oldProgress = samData.summary_progress;
            await processBatchSummarizationRun(currentIndex, false);
            
            if (samData.summary_progress === oldProgress) {
                samData.summary_failed_progress = currentIndex;
            } else {
                samData.summary_failed_progress = -1;
            }
            
            curr_state = STATES.IDLE; updateUIStatus();
        }
    }

    async function checkAndGenerateL3Summaries() {
        const l3Set = samSettings.summary_levels.L3;
        if (!l3Set.enabled) return;

        while (samData.responseSummary.L2.length >= l3Set.frequency) {
            const toCondense = samData.responseSummary.L2.slice(0, l3Set.frequency);
            const l3Str = toCondense.map(s => `[Messages ${s.index_begin}-${s.index_end}]: ${s.content}`).join('\n');
            const pL3 = SillyTavern.getContext().substituteParamsExtended(samSettings.summary_prompt_L3, { summary_content: l3Str });
            
            if (typeof toastr !== 'undefined') toastr.info(`[SAM] 开始生成 L3 摘要...`);
            try {
                const resultL3 = (samSettings.summary_api_preset && apiManager) ? await apiManager.generate([{ role: 'user', content: pL3 }], samSettings.summary_api_preset)
                                : await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: pL3, skipWIAN: samSettings.skipWIAN_When_summarizing });
                if (resultL3) {
                    samData.responseSummary.L3.push({ index_begin: toCondense[0].index_begin, index_end: toCondense[toCondense.length-1].index_end, content: resultL3, level: 0 });
                    samData.responseSummary.L2.splice(0, l3Set.frequency);
                } else {
                    break;
                }
            } catch(e) {
                logger.error("L3 Summary failed", e);
                break;
            }
        }
    }

    async function generateSingleL2Summary(startIndex, endIndex, force = false) {
        const chat = SillyTavern.getContext().chat;
        if (!samData.responseSummary) samData.responseSummary = { L1:[], L2:[], L3:[] };

        if (force) { 
            samData.responseSummary.L2 = samData.responseSummary.L2.filter(s => s.index_begin >= endIndex || s.index_end <= startIndex); 
        }

        const msgs = chat.slice(startIndex, endIndex);
        if (msgs.length === 0) return false;

        const contentStr = msgs.map(m => {
            let processed = m.mes
                .replace(CHECKPOINT_STRIP_REGEX, '')
                .replace(OLD_STATE_REMOVE_REGEX, '')
                .replace(UPDATE_BLOCK_REMOVE_REGEX, '')
                .trim();
            samSettings.regexes.forEach(rx => { if(rx.enabled && rx.regex_body) try { processed = processed.replace(new RegExp(rx.regex_body, 'g'), ''); }catch(e){} });
            return `${m.name}: ${processed}`;
        }).join('\n');

        const db_content = sam_db && sam_db.isInitialized ? Object.entries(sam_db.getAllMemosAsObject()).map(([k,v])=>`Key: ${k}\nContent: ${v}`).join('\n\n') : "无现有设定";
        const promptL2 = SillyTavern.getContext().substituteParamsExtended(samSettings.summary_prompt, { db_content, chat_content: contentStr });

        let resultL2;
        if (typeof toastr !== 'undefined') toastr.info(`[SAM] 开始生成摘要 (${startIndex}-${endIndex})...`);
        try {
            if (samSettings.summary_api_preset && apiManager) {
                resultL2 = await apiManager.generate([{ role: 'user', content: promptL2 }], samSettings.summary_api_preset);
            } else {
                resultL2 = await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: promptL2, skipWIAN: samSettings.skipWIAN_When_summarizing });
            }
        } catch (e) {
            logger.error("L2 Summary failed", e);
            if (typeof toastr !== 'undefined') toastr.error(`L2 摘要失败: ${e.message}`); return false; 
        }

        if (!resultL2) return false;

        const dbOperations = await extractOperationsFromText(resultL2);
        for (const op of dbOperations) {
            if (op.op === 'insert' && op.path && op.value && typeof op.value.content === 'string') {
                const pathParts = op.path.split('/');
                const key = pathParts[pathParts.length - 1];
                if (key) { sam_db.setMemo(key, op.value.content, Array.isArray(op.value.keywords) ? op.value.keywords :[]); }
            }
        }

        const cleanL2 = resultL2.replace(UPDATE_BLOCK_REMOVE_REGEX, '').trim();

        if (cleanL2) {
            samData.responseSummary.L2.push({ index_begin: startIndex, index_end: endIndex, content: cleanL2, level: 0 });
            return true;
        }
        return false;
    }

    async function processBatchSummarizationRun(targetIndex, force = false) {
        let last_progress = samData.summary_progress || 0;
        const l2_freq = samSettings.summary_levels.L2.frequency;
        let anySuccess = false;

        while (targetIndex - last_progress >= l2_freq) {
            const chunkEndIndex = last_progress + l2_freq;
            logger.info(`Running L2 summary for chunk ${last_progress} - ${chunkEndIndex}`);
            const success = await generateSingleL2Summary(last_progress, chunkEndIndex, force);
            if (!success) {
                logger.warn(`L2 summary failed at chunk ${last_progress} - ${chunkEndIndex}`);
                toastr.error(`[SAM] 摘要生成失败 [${last_progress} - ${chunkEndIndex}]`);
                break;
            }
            last_progress = chunkEndIndex;
            samData.summary_progress = last_progress;
            anySuccess = true;

            await checkAndGenerateL3Summaries();
        }
        
        if (anySuccess) {
            if (sam_db.isInitialized) samData.jsondb = sam_db.export();
            await applyDataToChat(samData);
            if (typeof toastr !== 'undefined') toastr.success("[SAM] 批量摘要生成完成");
            if (UI_STATE.panelOpen) renderTabContent();
        }
        return anySuccess;
    }

    async function processMessageState(index) {
        if (isProcessingState) { return; }
        isProcessingState = true;

        try {
            const chat = SillyTavern.getContext().chat;
            if (index === "{{lastMessageId}}") { index = chat.length - 1; }
            const lastAIMessage = chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) return;

            // [RESTORED FROM V5] Strict use of the prevState cache
            let state;
            if (prevState) { state = goodCopy(prevState); }
            else { state = await buildStateFromHistory(index - 1); }

            let messageContent = lastAIMessage.mes;

            const opsFromMessage = await extractOperationsFromText(messageContent);
            const periodicOps = samFunctions.filter(f => f.periodic).map(f => ({ op: 'func', func_name: f.func_name, params:[] }));

            const { state: newState, generatedDiffs } = await applyOperationsToState([...opsFromMessage, ...periodicOps], state, true);
            samData = newState;
            
            //[RESTORED FROM V5] Immediately push updated variable memory
            await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(newState)); return variables });

            // Build the new block HTML if needed
            let newBlockHTML = "";
            if (generatedDiffs && generatedDiffs.length > 0) {
                const updatedOps =[...opsFromMessage, ...generatedDiffs];
                const newBlockContent = JSON.stringify(updatedOps, null, 2);
                newBlockHTML = `<JSONPatch>\n${newBlockContent}\n</JSONPatch>`;
            } else if (opsFromMessage.length > 0) {
                const newBlockContent = JSON.stringify(opsFromMessage, null, 2);
                newBlockHTML = `<JSONPatch>\n${newBlockContent}\n</JSONPatch>`;
            }

            // [RESTORED FROM V5] Explicit cleanup to prevent duplicate blocks
            // Preserve the original location of the JSONPatch block
            let cleanNarrative = messageContent
                .replace(CHECKPOINT_STRIP_REGEX, '')
                .replace(OLD_STATE_REMOVE_REGEX, '');

            let patchReplaced = false;
            if (newBlockHTML !== "") {
                if (cleanNarrative.match(UPDATE_BLOCK_REMOVE_REGEX)) {
                    cleanNarrative = cleanNarrative.replace(UPDATE_BLOCK_REMOVE_REGEX, (match) => {
                        if (!patchReplaced) {
                            patchReplaced = true;
                            return newBlockHTML;
                        }
                        return ''; // Remove subsequent blocks
                    });
                } else {
                    cleanNarrative = cleanNarrative.trim() + `\n\n${newBlockHTML}`;
                }
            } else {
                cleanNarrative = cleanNarrative.replace(UPDATE_BLOCK_REMOVE_REGEX, '');
            }

            cleanNarrative = cleanNarrative.trim();

            const currentRound = chat.filter(m => !m.is_user).length;
            const shouldCheckpoint = samSettings.enable_auto_checkpoint &&
                                     samSettings.auto_checkpoint_frequency > 0 &&
                                     (currentRound > 0 && (currentRound % samSettings.auto_checkpoint_frequency === 0 || index === 0));

            if (shouldCheckpoint) {
                const stateString = await chunkedStringify(samData);
                cleanNarrative += `\n\n${OLD_START_MARKER}\n${stateString}\n${OLD_END_MARKER}`;
            }

            chat[index].mes = cleanNarrative;
            await setChatMessages([{ message_id: index, message: cleanNarrative }]);

            await applyDataToChat(samData);

            eventEmit(SAM_RESPONSE_PROCESSING_COMPLETED);

        } catch (error) {
            logger.error("Error in processMessageState:", error);
        } finally {
            isProcessingState = false;
        }
    }

    async function applyDataToChat(data) {
        await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(data)); return variables });
        
        await setChatMessages([{"message_id": SillyTavern.getContext().chat.length - 1},
            {"message_id": SillyTavern.getContext().chat.length - 2}
            ]
        );


    }

    // ========================================================================
    // FSM Dispatcher & Event Handling
    // ========================================================================

    async function dispatcher(event, ...args) {
        console.log(`[Dispatcher] Received Event: ${event}, Args:`, args);
        try {
            switch (curr_state) {
                case STATES.IDLE:
                    switch (event) {
                        case tavern_events.MESSAGE_SENT:
                        case tavern_events.GENERATION_STARTED:

                            const type = args[0];
                            
                            // DO NOT CHANGE ORDERING. [2] is the dry_run flag, which should prevent any state changes if true. This is critical for correct handling of generation runs.
                            // if you use args[1] it will read False, and return and early exit the cycle, causing silent fails
                            if (args[2]) { return; }

                            
                            if (type === "swipe" || type === "regenerate") {
                                logger.info(`Processing swipe or regenerate event, reconstructing from index ${findLatestUserMsgIndex()}`);
                                await loadStateToMemory(findLatestUserMsgIndex());
                                prevState = goodCopy(samData);
                            } else if (event === tavern_events.MESSAGE_SENT) {
                                const lastAiIndex = findLastAiMessageAndIndex();
                                prevState = await loadStateToMemory(lastAiIndex);
                            }
                            
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;

                        case tavern_events.MESSAGE_SWIPED:
                        case tavern_events.MESSAGE_DELETED:
                        case tavern_events.MESSAGE_EDITED:
                        case tavern_events.CHAT_CHANGED:
                            console.log(`common sync triggered by event ${event}`);
                            await sync_latest_state();
                            prevState = goodCopy(samData);
                            break;
                    }
                    break;

                case STATES.AWAIT_GENERATION:
                    switch (event) {
                        case tavern_events.GENERATION_STOPPED:
                        case FORCE_PROCESS_COMPLETION:
                        case tavern_events.GENERATION_ENDED:
                            stopGenerationWatcher();
                            if (current_run_is_dry) { current_run_is_dry = false; break; }
                            
                            curr_state = STATES.PROCESSING;
                            updateUIStatus();
                            
                            const chatLen = SillyTavern.getContext().chat.length;
                            await processMessageState(chatLen - 1);
                            await triggerSummaryCheck(chatLen);
                            
                            curr_state = STATES.IDLE;
                            prevState = null; // Clear snapshot properly
                            break;
                        case tavern_events.CHAT_CHANGED:
                            stopGenerationWatcher();
                            await sync_latest_state();
                            prevState = goodCopy(samData);
                            curr_state = STATES.IDLE;
                            break;
                    }
                    break;
                
                case STATES.PROCESSING:
                case STATES.SUMMARIZING:
                    logger.warn(`[FSM] Received event ${event} while in ${curr_state} state. Ignoring.`);
                    break;
            }
        } catch (e) {
            logger.error(`[Dispatcher] FSM failed. Error: ${e}`);
            stopGenerationWatcher();
            curr_state = STATES.IDLE;
            prevState = null;
            isProcessingState = false;
        }
        updateUIStatus();
    }

    async function unified_dispatch_executor() {
        if (isDispatching) return;
        isDispatching = true;
        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift();
            try { 
                    await dispatcher(event_id, ...args); 
                } 
                catch (error) { 
                    logger.error(`Unhandled error during dispatch of ${event_id}:`, error); 
                curr_state = STATES.IDLE;
            }
        }
        isDispatching = false;
        if (event_queue.length > 0) { 
            setTimeout(() => unified_dispatch_executor(), 10); 
        }
    }

    async function unifiedEventHandler(event, ...args) {
        // Yielding to main thread like in V5
        setTimeout(() => {
            event_queue.push({ event_id: event, args:[...args] });
            unified_dispatch_executor();
        }, 0);
    }

    const handlers = {
        handleMessageSent: () => unifiedEventHandler(tavern_events.MESSAGE_SENT),
        
        // no matter what do not change this, ST formatting issue
        handleGenerationStarted: async (event_obj, options, dry_run) => await unifiedEventHandler(tavern_events.GENERATION_STARTED, event_obj, options, dry_run),
        
        handleGenerationEnded: () => unifiedEventHandler(tavern_events.GENERATION_ENDED),
        handleGenerationStopped: () => unifiedEventHandler(tavern_events.GENERATION_STOPPED),
        handleMessageSwiped: () => unifiedEventHandler(tavern_events.MESSAGE_SWIPED),
        handleMessageDeleted: () => unifiedEventHandler(tavern_events.MESSAGE_DELETED),
        handleMessageEdited: () => unifiedEventHandler(tavern_events.MESSAGE_EDITED),
        handleChatChanged: () => unifiedEventHandler(tavern_events.CHAT_CHANGED),
    };

    // ========================================================================
    // 8. 内部悬浮窗 UI & 样式构建
    // ========================================================================
    function updateUIStatus() {
        if (k.statusText) {
            k.statusText.textContent = `引擎状态: ${curr_state} | 数据: ${go_flag && samSettings.data_enable ? '活跃' : '休眠'}`;
            k.statusText.style.color =["PROCESSING", "SUMMARIZING", "AWAIT_GENERATION"].includes(curr_state) ? "#f0ad4e" : "#5cb85c";
        }
        if (k.depsText) {
            const jr = local_jsonrepair ? 'green' : 'red';
            const ms = local_MiniSearch ? 'green' : 'red';
            const jp = 'green';

            k.depsText.innerHTML = `
                <div class="sam_dep_indicator" title="jsonrepair"><div class="sam_dep_dot ${jr}"></div></div>
                <div class="sam_dep_indicator" title="MiniSearch"><div class="sam_dep_dot ${ms}"></div></div>
                <div class="sam_dep_indicator" title="jsonpatch"><div class="sam_dep_dot ${jp}"></div></div>
            `;
        }
    }

    function clamp_max(val, min, max, defaultVal) {
        const o = Number(val);
        return Number.isFinite(o) ? Math.min(max, Math.max(min, o)) : defaultVal;
    }

    function Tn(leftTarget, topTarget, saveState) {
        if (!k.widget) return;
        const fabSize = UI_STATE.fabSizePx;
        const width = UI_STATE.panelOpen ? (k.widget.offsetWidth || 800) : fabSize;
        const height = UI_STATE.panelOpen ? (k.widget.offsetHeight || 600) : fabSize;
        
        const maxLeft = Math.max(8, y.innerWidth - width - 8);
        const maxTop = Math.max(8, y.innerHeight - height - 8);
        
        const safeLeft = clamp_max(leftTarget, 8, maxLeft, 8);
        const safeTop = clamp_max(topTarget, 8, maxTop, 8);
        
        k.widget.style.left = `${safeLeft}px`;
        k.widget.style.top = `${safeTop}px`;
        
        if (saveState) { UI_STATE.uiLeft = safeLeft; UI_STATE.uiTop = safeTop; }
    }

    function An() { if (!k.widget) return; const rect = k.widget.getBoundingClientRect(); Tn(rect.left, rect.top, false); }
    function En() { if (!k.widget) return; const rect = k.widget.getBoundingClientRect(); UI_STATE.uiLeft = rect.left; UI_STATE.uiTop = rect.top; }
  
    function Nn() {
        if (!v.head) return;
        if (v.getElementById(STYLE_ID)) v.getElementById(STYLE_ID).remove();
        const styleNode = v.createElement("style");
        styleNode.id = STYLE_ID;
        styleNode.textContent = `
          #${WIDGET_ID} { position: fixed; z-index: 99997; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; user-select: none; }
          #${WIDGET_ID} .th-asr-fab { width: 48px; height: 48px; border: none; border-radius: 14px; cursor: pointer; color: white; background: linear-gradient(135deg, #0f766e, #0f172a); box-shadow: 0 8px 20px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; touch-action: none; transition: transform 0.16s ease, box-shadow 0.16s ease; }
          #${WIDGET_ID} .th-asr-fab:hover { transform: translateY(-1px) scale(1.02); box-shadow: 0 10px 24px rgba(0,0,0,0.5); }
          #${WIDGET_ID} .th-asr-panel { margin-top: 10px; width: 95vw; height: 95vh; border-radius: 8px; background: #1e1e1e; border: 1px solid #333; box-shadow: 0 16px 36px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; color: #ddd; }
          #${WIDGET_ID} .th-asr-panel[hidden] { display: none !important; }
          .sam_modal_header { background: #252526; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: move; border-bottom: 1px solid #333; user-select: none; touch-action: none; }
          .sam_header_title { font-weight: bold; font-size: 14px; } .sam_brand { color: #4a6fa5; } .sam_version { font-size: 10px; color: #666; }
          .sam_close_icon { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; } .sam_close_icon:hover { color: #fff; }
          .sam_tabs { display: flex; background: #2d2d2d; border-bottom: 1px solid #333; flex-shrink:0; }
          .sam_tab { background: transparent; border: none; color: #888; padding: 10px 20px; cursor: pointer; font-size: 12px; border-right: 1px solid #333; transition: all 0.2s; }
          .sam_tab:hover { background: #333; color: #ccc; } .sam_tab.active { background: #1e1e1e; color: #4a6fa5; font-weight: bold; border-top: 2px solid #4a6fa5; }
          .sam_content_area { flex: 1; overflow:hidden; display:flex; flex-direction: column; }
          .sam_content_area > * { flex: 1; overflow-y: auto; padding: 15px; box-sizing: border-box; }
          .sam_modal_footer { height: 40px; background: #252526; border-top: 1px solid #333; display: flex; justify-content: space-between; align-items: center; padding: 0 15px; flex-shrink:0;}
          .sam_deps_bar { display: flex; gap: 8px; margin-left: 15px; border-left: 1px solid #444; padding-left: 15px; }
          .sam_dep_indicator { display: inline-flex; align-items: center; }
          .sam_dep_dot { width: 8px; height: 8px; border-radius: 50%; }
          .sam_dep_dot.green { background: #5cb85c; box-shadow: 0 0 4px #5cb85c; }
          .sam_dep_dot.red { background: #d9534f; box-shadow: 0 0 4px #d9534f; }
          .sam_status_bar { font-size: 11px; color: #666; } .sam_actions { display: flex; gap: 10px; }
          .sam_btn { padding: 6px 14px; border: none; font-size: 12px; cursor: pointer; border-radius: 2px; }
          .sam_btn_secondary { background: #3c3c3c; color: #ccc; } .sam_btn_secondary:hover { background: #4c4c4c; }
          .sam_btn_primary { background: #0e639c; color: white; } .sam_btn_primary:hover { background: #1177bb; }
          .sam_btn_small { background: #3c3c3c; border: none; color: white; width: 20px; height: 20px; cursor: pointer; border-radius: 3px; }
          .sam_form_row { margin-bottom: 15px; } .sam_form_grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
          .sam_label { display: block; margin-bottom: 5px; font-size: 11px; color: #aaa; }
          .sam_input, .sam_select { width: 100%; background: #2d2d2d; border: 1px solid #3e3e3e; color: white; padding: 6px; font-size: 12px; box-sizing: border-box; }
          .sam_textarea { width: 100%; min-height: 80px; background: #151515; border: 1px solid #333; color: #ccc; font-family: monospace; padding: 10px; box-sizing: border-box; resize: vertical; }
          .sam_code_editor { height: 100%; width: 100%; background: #151515; color: #dcdcaa; border: 1px solid #333; padding: 10px; font-family: 'Consolas', monospace; box-sizing: border-box; flex: 1; resize: none; }
          .sam_split { display: flex; height: 100%; gap: 15px; overflow: hidden;}
          .sam_sidebar { width: 220px; background: #252526; border: 1px solid #333; display: flex; flex-direction: column; flex-shrink:0; }
          .sam_sidebar_header { padding: 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items:center; font-size: 12px; font-weight: bold; }
          .sam_list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex:1; }
          .sam_list li { padding: 8px 10px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; }
          .sam_list li:hover { background: #2a2a2a; } .sam_list li.active { background: #37373d; color: white; }
          .sam_detail { flex: 1; overflow-y: auto; background: #1e1e1e; border: 1px solid #333; padding: 15px; box-sizing: border-box;}
          .sam_delete_icon { color: #666; font-weight: bold; cursor:pointer; } .sam_delete_icon:hover { color: #f86c6b; }
          .sam_toggle { cursor: pointer; display: inline-block; vertical-align: middle; }
          .sam_toggle_track { width: 36px; height: 18px; background: #333; border-radius: 9px; position: relative; transition: background 0.2s; }
          .sam_toggle_track.on { background: #4a6fa5; }
          .sam_toggle_thumb { width: 14px; height: 14px; background: white; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: left 0.2s; }
          .sam_toggle_track.on .sam_toggle_thumb { left: 20px; }
          .sam_summary_display { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; }
          .sam_summary_box { background: #252526; border: 1px solid #333; padding: 10px; border-radius: 4px; display: flex; flex-direction: column; }
          .sam_summary_box h4 { margin:0 0 10px 0; font-size: 12px; color:#888; border-bottom:1px solid #333; padding-bottom:5px; }
          .sam_summary_box textarea { min-height: 120px; }
        `;
        v.head.appendChild(styleNode);
    }
  
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
              
              <div class="sam_actions">
                  <button class="sam_btn sam_btn_primary" id="btn_save_summary">保存配置</button> 
                  <button class="sam_btn sam_btn_secondary" id="btn_run_summary">一键批量总结</button>
                  <button class="sam_btn sam_btn_secondary" id="btn_show_summary_prompt">查看下次提示词 (Debug)</button>
              </div>
              <div id="debug_prompt_container" style="display:none; margin-top:15px; background:#1a1a1a; padding:10px; border:1px dashed #555; border-radius:4px;">
                  <label class="sam_label" style="color:#f0ad4e;">下次 L2 摘要提示词预览 (范围: <span id="debug_prompt_range"></span>)</label>
                  <textarea class="sam_textarea" id="debug_prompt_area" readonly style="min-height:200px; background:#111; color:#ccc; margin-top:5px;"></textarea>
              </div>

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
              <div class="sam_form_row">
                  <label class="sam_label" style="display:inline-block; margin-right:10px;">启用自动检查点写入</label>
                  <div class="sam_toggle" id="toggle_checkpoint"><div class="sam_toggle_track ${samSettings.enable_auto_checkpoint?'on':''}"><div class="sam_toggle_thumb"></div></div></div>
              </div>
              <div class="sam_form_row"><label class="sam_label">检查点频率 (回合数)</label><input class="sam_input" type="number" id="sam_checkpoint_freq" value="${samSettings.auto_checkpoint_frequency}"></div>
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
                const text = C.querySelector('#data_json_area')?.value;
                if(text) {
                    let parsed; 
                    try { parsed = JSON.parse(text); } 
                    catch(e) { 
                        if (!local_jsonrepair) await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                        if (local_jsonrepair) { parsed = JSON.parse(local_jsonrepair(text)); } 
                        else { throw new Error("JSON invalid & jsonrepair fallback not available."); }
                    }
                    samData = parsed;
                }
                
                C.querySelectorAll('.sam_summary_display textarea').forEach(area => {
                    const {level, idx} = area.dataset;
                    if (samData.responseSummary[level]?.[idx]) { samData.responseSummary[level][idx].content = area.value; }
                });

                await updateVariablesWith(variables => { _.set(variables, "SAM_data", goodCopy(samData)); return variables });
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
                await processBatchSummarizationRun(chatLen, false);
                curr_state = STATES.IDLE; updateUIStatus();
            };
            C.querySelector('#btn_show_summary_prompt').onclick = () => {
                if(!go_flag || !samSettings.data_enable) { toastr.warning("摘要功能未激活。"); return; }
                
                const container = C.querySelector('#debug_prompt_container');
                const area = C.querySelector('#debug_prompt_area');
                const rangeSpan = C.querySelector('#debug_prompt_range');
                
                // 如果已经打开，则折叠关闭
                if (container.style.display === 'block') {
                    container.style.display = 'none';
                    return;
                }

                // 模拟 generateSingleL2Summary 的取值逻辑
                const chat = SillyTavern.getContext().chat;
                const startIndex = samData.summary_progress || 0;
                let endIndex = startIndex + samSettings.summary_levels.L2.frequency;
                
                rangeSpan.textContent = `${startIndex} - ${endIndex}`;

                if (startIndex >= chat.length) {
                    area.value = "没有待处理的摘要内容 (No pending content for summary).";
                } else {
                    const msgs = chat.slice(startIndex, endIndex);
                    if (msgs.length === 0) {
                        area.value = "待处理消息为空 (Pending messages empty).";
                    } else {
                        // 执行相同的消息清理过程
                        const contentStr = msgs.map(m => {
                            let processed = m.mes
                                .replace(CHECKPOINT_STRIP_REGEX, '')
                                .replace(OLD_STATE_REMOVE_REGEX, '')
                                .replace(UPDATE_BLOCK_REMOVE_REGEX, '')
                                .trim();
                            samSettings.regexes.forEach(rx => { 
                                if(rx.enabled && rx.regex_body) {
                                    try { processed = processed.replace(new RegExp(rx.regex_body, 'g'), ''); } catch(e){} 
                                }
                            });
                            return `${m.name}: ${processed}`;
                        }).join('\n');

                        // 获取数据库映射并注入宏
                        const db_content = sam_db && sam_db.isInitialized ? Object.entries(sam_db.getAllMemosAsObject()).map(([k,v])=>`Key: ${k}\nContent: ${v}`).join('\n\n') : "无现有设定";
                        const promptL2 = SillyTavern.getContext().substituteParamsExtended(samSettings.summary_prompt, { db_content, chat_content: contentStr });
                        
                        area.value = promptL2;
                    }
                }
                
                container.style.display = 'block';
            };
            C.querySelectorAll('.sam_summary_display .sam_delete_icon').forEach(icon => {
                icon.onclick = (e) => { const {level, idx} = e.target.dataset; samData.responseSummary[level].splice(idx, 1); renderTabContent(); };
            });
            C.querySelector('#btn_commit_data').onclick = commitDataFromUI;
        }
        else if (T === 'SETTINGS') {
            C.querySelector('#toggle_data').onclick = () => { samSettings.data_enable = !samSettings.data_enable; renderTabContent(); };
            C.querySelector('#toggle_skip').onclick = () => { samSettings.skipWIAN_When_summarizing = !samSettings.skipWIAN_When_summarizing; renderTabContent(); };
            C.querySelector('#toggle_checkpoint').onclick = () => { samSettings.enable_auto_checkpoint = !samSettings.enable_auto_checkpoint; renderTabContent(); };
            C.querySelector('#btn_save_global').onclick = () => { 
                samSettings.auto_checkpoint_frequency = parseInt(C.querySelector('#sam_checkpoint_freq').value) || 20;
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
                        const newSettings = JSON.parse(ev.target.result); Object.assign(samSettings, newSettings);
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
                    const li = e.target.closest('li'); if(!li) return;
                    const idx = parseInt(li.dataset.idx);
                    if (e.target.classList.contains('sam_delete_icon')) { sourceArr.splice(idx, 1); if (UI_STATE[selectedIdx] === idx) UI_STATE[selectedIdx] = -1; } 
                    else { UI_STATE[selectedIdx] = idx; }
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
  
    function togglePanel(open, initial = false) {
        if (!k.panel) return;
        if (UI_STATE.panelOpen === open && !initial) return;
        UI_STATE.panelOpen = open;
        k.panel.hidden = !open;
        if (open) { renderTabContent(); }
        An();
    }

    function setupWatchdog() {
        if (!v.body) return;
        const WATCHDOG_ID = "sam-watchdog-script";
        let wd = v.getElementById(WATCHDOG_ID);
        if (wd) wd.remove();
        
        wd = v.createElement("script");
        wd.id = WATCHDOG_ID;
        wd.textContent = `
            (function() {
                var lastSeenBeat = -1;
                var strikes = 0;
                var checkInterval = setInterval(function() {
                    var widget = document.getElementById('${WIDGET_ID}');
                    if (!widget) { clearInterval(checkInterval); return; }
                    
                    var currentBeat = parseInt(widget.getAttribute('data-beat') || '0', 10);
                    if (currentBeat > 0 && currentBeat === lastSeenBeat) {
                        strikes++;
                        if (strikes >= 2) {
                            widget.remove();
                            var s = document.getElementById('${STYLE_ID}'); if (s) s.remove();
                            var self = document.getElementById('${WATCHDOG_ID}'); if (self) self.remove();
                            clearInterval(checkInterval);
                            console.log('[SAM Watchdog] 核心引擎已断开，失效悬浮窗已自动清理。');
                        }
                    } else { strikes = 0; lastSeenBeat = currentBeat; }
                }, 2000);
            })();
        `;
        v.body.appendChild(wd);
        
        let beatCount = 1;
        if (k.widget) k.widget.setAttribute('data-beat', beatCount.toString());
        const hb = setInterval(() => { if (k.widget) { beatCount++; k.widget.setAttribute('data-beat', beatCount.toString()); } }, 2000);
        cleanup_pool.push(() => clearInterval(hb)); 
    }

    function sync_getVariables() {
        let data = SillyTavern.getContext().variables.local.get("SAM_data");
        if (!data || typeof data !== 'object') {
            data = goodCopy(INITIAL_STATE);
        } else {
            _.defaultsDeep(data, INITIAL_STATE);
        }
        return data;
    }

    function serialize_memory() {
    const data = sync_getVariables();
    let allSummaries =[];

    // Combine L2 and L3 summaries, adding a 'level' property to each
    if (data.responseSummary && Array.isArray(data.responseSummary.L2)) {
        allSummaries = allSummaries.concat(data.responseSummary.L2.map(summary => ({ ...summary, level: 'L2' })));
    }
    if (data.responseSummary && Array.isArray(data.responseSummary.L3)) {
        allSummaries = allSummaries.concat(data.responseSummary.L3.map(summary => ({ ...summary, level: 'L3' })));
    }

    // Sort the combin
    // ed array by the beginning of their range
    allSummaries.sort((a, b) => a.index_begin - b.index_begin);

    // Format the sorted summaries into strings
    const serialized_memory_parts = allSummaries.map(summary => {
        return `[${summary.level} Summary | Range: ${summary.index_begin}-${summary.index_end}]: ${summary.content}`;
    });

    return serialized_memory_parts.join('\n');
    }

    function buildWidgetHTML() {
        try {
            if (!v.body) return false;
            if (v.getElementById(WIDGET_ID)) v.getElementById(WIDGET_ID).remove();
            
            const c = v.createElement("div"); c.id = WIDGET_ID;
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
                    <div style="display: flex; align-items: center;">
                        <div class="sam_status_bar" id="sam_status_display">初始化中...</div>
                        <div class="sam_deps_bar" id="sam_deps_display"></div>
                    </div>
                    <div class="sam_actions"><button class="sam_btn sam_btn_secondary" id="sam_btn_refresh">重载数据</button></div>
                </div>
              </div>
            `;
            v.body.appendChild(c);
            
            k.widget = c; 
            k.panel = c.querySelector(".th-asr-panel"); 
            k.fab = c.querySelector(".th-asr-fab");
            k.header = c.querySelector(".sam_modal_header");
            k.contentArea = c.querySelector("#sam_tab_content"); 
            k.statusText = c.querySelector("#sam_status_display");
            k.depsText = c.querySelector("#sam_deps_display");
            
            if (!k.widget || !k.panel || !k.fab || !k.header) throw new Error("Missing Elements");
            
            add_event_listener(k.fab, "click", () => { if ("1" !== k.widget?.dataset?.dragging) { togglePanel(!UI_STATE.panelOpen); } });
            add_event_listener(c.querySelector("#sam_btn_close"), "click", () => togglePanel(false));
            add_event_listener(c.querySelector("#sam_btn_refresh"), async () => { await loadContextData(true); renderTabContent(); toastr.info("数据已重载"); });
            
            c.querySelectorAll('.sam_tab').forEach(tab => {
                add_event_listener(tab, "click", (e) => {
                    c.querySelectorAll('.sam_tab').forEach(t=>t.classList.remove('active'));
                    tab.classList.add('active');
                    UI_STATE.activeTab = tab.dataset.tab;
                    renderTabContent();
                });
            });

            (function () {
                if (!k.widget || !k.fab || !k.header) return;
                const dragState = { active: false, pointerId: null, startX: 0, startY: 0, originLeft: 0, originTop: 0, moved: false };
                
                function isInteractive(node) { return !!node && typeof node.closest === "function" && !!node.closest("button, input, select, textarea, label, a, .sam_toggle"); }
    
                function onPointerDown(n) {
                    if ("mouse" === n.pointerType && 0 !== n.button) return;
                    if (n.currentTarget === k.header && isInteractive(n.target)) return;
                    
                    const rect = k.widget.getBoundingClientRect();
                    dragState.active = true; dragState.pointerId = Number.isFinite(n.pointerId) ? n.pointerId : null;
                    dragState.startX = n.clientX; dragState.startY = n.clientY;
                    dragState.originLeft = rect.left; dragState.originTop = rect.top;
                    dragState.moved = false; k.widget.dataset.dragging = "0";
                    
                    if (typeof n.currentTarget?.setPointerCapture === "function" && null !== dragState.pointerId) { try { n.currentTarget.setPointerCapture(dragState.pointerId); } catch (err) {} }
                    n.preventDefault();
                }
    
                function onPointerMove(t) {
                    if (!dragState.active) return;
                    if (null !== dragState.pointerId && t.pointerId !== dragState.pointerId) return;
                    const dx = t.clientX - dragState.startX; const dy = t.clientY - dragState.startY;
                    if (Math.abs(dx) + Math.abs(dy) > 4) { dragState.moved = true; k.widget.dataset.dragging = "1"; }
                    Tn(dragState.originLeft + dx, dragState.originTop + dy, false);
                }
    
                function onPointerUp(t) {
                    if (dragState.active) {
                        if (null !== dragState.pointerId && t && Number.isFinite(t.pointerId) && t.pointerId !== dragState.pointerId) return;
                        dragState.active = false; dragState.pointerId = null; En();
                        setTimeout(() => { if (k.widget) k.widget.dataset.dragging = "0"; }, 0);
                    }
                }
    
                add_event_listener(k.fab, "pointerdown", onPointerDown);
                add_event_listener(k.header, "pointerdown", onPointerDown);
                add_event_listener(v, "pointermove", onPointerMove);
                add_event_listener(v, "pointerup", onPointerUp);
                add_event_listener(v, "pointercancel", onPointerUp);
            })();
            
            togglePanel(UI_STATE.panelOpen, true);
            if (null === UI_STATE.uiLeft || null === UI_STATE.uiTop) {
                const fabSize = UI_STATE.fabSizePx; const padding = 16;
                const defaultLeft = y.innerWidth - fabSize - padding;
                const defaultTop = Math.max(padding, Math.min(y.innerHeight - fabSize - padding, 120));
                Tn(defaultLeft, defaultTop, true);
            } else { Tn(UI_STATE.uiLeft, UI_STATE.uiTop, true); }
            add_event_listener(y, "resize", () => { An(); En(); });

            setupWatchdog();

            return true;
        } catch (e) { logger.error("Widget creation failed:", e); return false; }
    }
    
    // ========================================================================
    // 9. 初始化与上下文加载
    // ========================================================================
    async function loadContextData(forceRebuild = false) {
        await checkWorldInfoActivation();

        if (!go_flag) {
            logger.info("SAM identifier not found. Icon committing suicide.");
            cleanupDOM();
            return;
        }

        if (!k.widget) {
            logger.info("SAM identifier found. Resurrecting icon.");
            Nn();
            if (!buildWidgetHTML()) { logger.error("Icon failed to resurrect."); return; }
        }

        loadSamSettings();
        samFunctions = await getFunctionsFromWI();

        if (forceRebuild) {
            await sync_latest_state();
        } else {
            let d = SillyTavern.getContext().variables.local.get("SAM_data");
            if (d && typeof d === 'object') {
                _.defaultsDeep(d, INITIAL_STATE);
                samData = d;
            } else { await sync_latest_state(); }
        }

        await initializeDatabase(samData.jsondb);
        updateUIStatus();
    }

    // Manual Event Triggers corresponding to custom UI Buttons
    async function manualCheckpoint() {
        if (isCheckpointing || isProcessingState || curr_state !== STATES.IDLE) return;
        isCheckpointing = true;
        try {
            const chat = SillyTavern.getContext().chat;
            let lastAiIndex = findLastAiMessageAndIndex();
            if (lastAiIndex === -1) return;

            const lastAiMessage = chat[lastAiIndex];
            
            // [RESTORED FROM V5] Explicit cleanup of old blocks first
            const cleanNarrative = lastAiMessage.mes
                .replace(CHECKPOINT_STRIP_REGEX, '')
                .replace(OLD_STATE_REMOVE_REGEX, '')
                .trim();

            const stateString = await chunkedStringify(samData);
            const finalContent = `${cleanNarrative}\n\n${OLD_START_MARKER}\n${stateString}\n${OLD_END_MARKER}`;

            chat[lastAiIndex].mes = finalContent;
            await setChatMessages([{ message_id: lastAiIndex, message: finalContent }]);
            toastr.success("手动检查点已创建 (Manual checkpoint created)");
        } catch(e) {
            logger.error("Manual checkpoint failed", e);
            toastr.error("检查点创建失败");
        } finally {
            isCheckpointing = false;
        }
    }

    async function manualReset() {
        try {
            await sync_latest_state();
            toastr.success("SAM 内部状态已重置 (State reset)");
        } catch(e) { logger.error("Manual reset failed", e); toastr.error("状态重置失败"); }
    }

    async function initSAM() {
        if (typeof tavern_events === 'undefined') { logger.warn("Not in ST environment."); return; }

        //[RESTORED FROM V5] Clean up any old running instances first
        cleanupPreviousInstance();

        loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
        loadExternalLibrary(MINISEARCH_URL, 'MiniSearch');

        loadSamSettings();
        apiManager = new APIManager({ initialPresets: samSettings.api_presets, onUpdate: (p) => { samSettings.api_presets = p; saveSamSettings(); } });

        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        bindTavernEvent(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        bindTavernEvent(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        bindTavernEvent(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);
        bindTavernEvent(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        bindTavernEvent(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        bindTavernEvent(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        bindTavernEvent(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);

        //[RESTORED FROM V5] Store new handlers for future cleanup
        window[HANDLER_STORAGE_KEY] = handlers;

        try {
            if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
                const resetEvent = getButtonEvent("重置内部状态（慎用）");
                const checkpointEvent = getButtonEvent("手动检查点");
                if (resetEvent) eventOn(resetEvent, manualReset);
                if (checkpointEvent) eventOn(checkpointEvent, manualCheckpoint);
            }
        } catch (e) {}

        await loadContextData(true);
        SillyTavern.getContext().registerMacro('SAM_serialized_memory', serialize_memory);
        SillyTavern.getContext().registerMacro('SAM_serialized_db', serialize_db);

        logger.info(`SAM Core Engine V${SCRIPT_VERSION} fully loaded.`);
    }

    const startup = () => { initSAM(); };

    if (v.readyState === "loading") { add_event_listener(v, "DOMContentLoaded", startup, { once: true }); }
    else { startup(); }

  })());