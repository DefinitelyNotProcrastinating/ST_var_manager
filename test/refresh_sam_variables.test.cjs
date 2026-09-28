const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sam_state_manager.js'), 'utf8');

function makeRuntime(chat, baseStatic = { gold: 1 }, options = {}) {
    const localVariables = {};
    const messageWrites = [];
    const doc = { readyState: 'loading', addEventListener() {}, removeEventListener() {} };
    const win = { document: doc };
    win.top = win;
    const context = {
        chat,
        characterId: 0,
        characters: [{ data: { extensions: { world: 'character-world' } } }],
        loadWorldInfo: async () => ({ entries: { 0: { comment: '__SAM_base_data__', content: JSON.stringify(baseStatic) } } }),
        variables: { local: { get: key => localVariables[key] } },
        substituteParamsExtended: (template, values) => Object.entries(values).reduce(
            (text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template,
        ),
        ConnectionManagerRequestService: {
            sendRequest: options.sendRequest || (async () => '<JSONPatch>[]</JSONPatch>'),
        },
    };
    const lodash = {
        cloneDeep: value => structuredClone(value),
        isEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        merge(target, ...sources) {
            for (const sourceValue of sources) {
                for (const [key, value] of Object.entries(sourceValue || {})) {
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        target[key] = this.merge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
                    } else {
                        target[key] = structuredClone(value);
                    }
                }
            }
            return target;
        },
        get(object, keys) { return keys.reduce((value, key) => value?.[key], object); },
        set(object, keys, value) {
            const parts = Array.isArray(keys) ? keys : keys.split('.');
            let current = object;
            for (const part of parts.slice(0, -1)) current = current[part] ??= {};
            current[parts.at(-1)] = value;
            return object;
        },
        unset(object, keys) {
            const parts = Array.isArray(keys) ? keys : keys.split('.');
            const parent = parts.slice(0, -1).reduce((value, key) => value?.[key], object);
            if (parent) delete parent[parts.at(-1)];
        },
    };
    const injected = source.replace(
        '    const startup = () => { initSAM(); };',
        '    window.__samTest = { dispatcher, queuePendingRefresh, regenerateLatestVariableUpdate, setState: state => { curr_state = state; }, setUpdateMode: mode => { samSettings.update_mode = mode; }, renderUpdateHtml: () => { k.contentArea = { innerHTML: "", firstElementChild: null }; UI_STATE.activeTab = "UPDATE"; renderTabContent(); return k.contentArea.innerHTML; }, enableIndependent: () => { go_flag = true; samSettings.update_mode = "independent"; samSettings.independent_update.connection_profile_id = "test-profile"; } };\n    const startup = () => { initSAM(); };',
    );
    assert.notEqual(injected, source, 'test hook insertion point must exist');
    vm.runInNewContext(injected, {
        window: win,
        document: doc,
        navigator: { userAgent: 'Node test' },
        SillyTavern: { getContext: () => context },
        tavern_events: {},
        _: lodash,
        $: () => {},
        toastr: { warning() {}, error() {}, success() {} },
        getWorldbook: async () => options.worldbookEntries ?? [{ name: '[update_rule] test', content: 'Update gold according to the reply.' }],
        eventEmit() {},
        structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
        updateVariablesWith: async callback => callback(localVariables),
        setChatMessages: async messages => {
            messageWrites.push(messages);
            if (options.failMessageWrite?.(messageWrites.length)) throw new Error('test message write failure');
        },
    });
    return { sam: win.__samTest, localVariables, messageWrites, context };
}

test('broadcast rebuilds from latest checkpoint and replays later patch', async () => {
    const chat = [
        { is_user: false, mes: '<JSONPatch>[{"op":"replace","path":"/gold","value":9}]</JSONPatch>' },
        { is_user: false, mes: '$$$$$$data_block$$$$$$\n{"static":{"gold":20}}\n$$$$$$data_block_end$$$$$$' },
        { is_user: true, mes: '继续' },
        { is_user: false, mes: '<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>' },
    ];
    const { sam, localVariables, messageWrites } = makeRuntime(chat);
    localVariables.database_script_value = { untouched: true };
    await sam.dispatcher('REFRESH_SAM_VARIABLES');
    assert.equal(localVariables.SAM_data.static.gold, 25);
    assert.deepEqual(localVariables.database_script_value, { untouched: true });
    assert.equal(messageWrites.length, 0);
});

test('broadcast initializes from base data when chat has no AI message', async () => {
    const { sam, localVariables, messageWrites } = makeRuntime([], { gold: 42 });
    await sam.dispatcher('REFRESH_SAM_VARIABLES');
    assert.equal(localVariables.SAM_data.static.gold, 42);
    assert.equal(messageWrites.length, 0);
});

test('broadcast waits until generation becomes idle', async () => {
    const chat = [{ is_user: false, mes: '<JSONPatch>[{"op":"replace","path":"/gold","value":7}]</JSONPatch>' }];
    const { sam, localVariables } = makeRuntime(chat);
    sam.setState('AWAIT_GENERATION');
    await sam.dispatcher('REFRESH_SAM_VARIABLES');
    assert.equal(localVariables.SAM_data, undefined);
    sam.setState('IDLE');
    await sam.dispatcher('NOOP');
    assert.equal(localVariables.SAM_data.static.gold, 7);
});

test('broadcast queued during manual summary is rebuilt after summary finishes', async () => {
    const chat = [{ is_user: false, mes: '<JSONPatch>[{"op":"replace","path":"/gold","value":11}]</JSONPatch>' }];
    const { sam, localVariables } = makeRuntime(chat);
    sam.setState('SUMMARIZING');
    await sam.dispatcher('REFRESH_SAM_VARIABLES');
    assert.equal(localVariables.SAM_data, undefined);
    sam.setState('IDLE');
    sam.queuePendingRefresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(localVariables.SAM_data.static.gold, 11);
});

test('re-update replaces the latest patch from the previous-floor state', async () => {
    const original = 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const chat = [{ is_user: false, mes: original }];
    const requests = [];
    const { sam, localVariables, messageWrites } = makeRuntime(chat, { gold: 1 }, {
        sendRequest: async (profile, messages) => {
            requests.push({ profile, prompt: messages[0].content, floor: chat[0].mes, cachedGold: localVariables.SAM_data.static.gold });
            return '<JSONPatch>[{"op":"inc","path":"/gold","value":3}]</JSONPatch>';
        },
    });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].profile, 'test-profile');
    assert.equal(requests[0].cachedGold, 1);
    assert.equal(requests[0].floor, original, 'old message remains persisted until the new request succeeds');
    assert.equal(requests[0].prompt.includes('"gold": 1'), true);
    assert.equal(requests[0].prompt.includes('"value":5'), false);
    assert.equal(localVariables.SAM_data.static.gold, 4);
    assert.equal((chat[0].mes.match(/<JSONPatch>/g) || []).length, 1);
    assert.equal(chat[0].mes.includes('"value": 3'), true);
    assert.equal(messageWrites.some(write => write[0].message === 'story'), true);
});

test('re-update refreshes an existing checkpoint without losing summary metadata', async () => {
    const checkpoint = {
        static: { gold: 6 },
        responseSummary: { L1: [], L2: [{ index_begin: 0, index_end: 2, content: 'summary' }], L3: [] },
        summary_progress: 2,
    };
    const chat = [{
        is_user: false,
        mes: `story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>\n$$$$$$data_block$$$$$$\n${JSON.stringify(checkpoint)}\n$$$$$$data_block_end$$$$$$`,
    }];
    const { sam, localVariables } = makeRuntime(chat, { gold: 1 }, {
        sendRequest: async () => '<JSONPatch>[{"op":"inc","path":"/gold","value":3}]</JSONPatch>',
    });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), true);
    assert.equal(localVariables.SAM_data.static.gold, 4);
    assert.equal(localVariables.SAM_data.summary_progress, 2);
    assert.equal(localVariables.SAM_data.responseSummary.L2.length, 1);
    assert.equal((chat[0].mes.match(/\$\$\$\$\$\$data_block\$\$\$\$\$\$/g) || []).length, 1);
    await sam.dispatcher('REFRESH_SAM_VARIABLES');
    assert.equal(localVariables.SAM_data.static.gold, 4);
    assert.equal(localVariables.SAM_data.summary_progress, 2);
});

test('failed re-update keeps the original patch and restores cached state', async () => {
    const original = 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const chat = [{ is_user: false, mes: original }];
    const { sam, localVariables, messageWrites } = makeRuntime(chat, { gold: 1 }, {
        sendRequest: async () => { throw new Error('test request failure'); },
    });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), false);
    assert.equal(chat[0].mes, original);
    assert.equal(localVariables.SAM_data.static.gold, 6);
    assert.equal(messageWrites.length, 0);
});

test('re-update does not write to a different chat after an asynchronous request', async () => {
    const original = 'old story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const oldChat = [{ is_user: false, mes: original }];
    const newChat = [{ is_user: false, mes: '<JSONPatch>[{"op":"replace","path":"/gold","value":9}]</JSONPatch>' }];
    let runtime;
    runtime = makeRuntime(oldChat, { gold: 1 }, {
        sendRequest: async () => {
            runtime.context.chat = newChat;
            return '<JSONPatch>[{"op":"inc","path":"/gold","value":3}]</JSONPatch>';
        },
    });
    runtime.sam.enableIndependent();
    assert.equal(await runtime.sam.regenerateLatestVariableUpdate(), false);
    assert.equal(oldChat[0].mes, original);
    assert.equal(newChat[0].mes.includes('"value":9'), true);
    assert.equal(runtime.localVariables.SAM_data.static.gold, 9);
    assert.equal(runtime.messageWrites.length, 0);
});

test('repeated re-updates never accumulate the previous result', async () => {
    const chat = [{ is_user: false, mes: 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>' }];
    let nextValue = 3;
    const { sam, localVariables } = makeRuntime(chat, { gold: 1 }, {
        sendRequest: async () => `<JSONPatch>[{"op":"inc","path":"/gold","value":${nextValue}}]</JSONPatch>`,
    });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), true);
    assert.equal(localVariables.SAM_data.static.gold, 4);
    nextValue = 2;
    assert.equal(await sam.regenerateLatestVariableUpdate(), true);
    assert.equal(localVariables.SAM_data.static.gold, 3);
    assert.equal((chat[0].mes.match(/<JSONPatch>/g) || []).length, 1);
});

test('re-update without update rules leaves the old result untouched', async () => {
    const original = 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const chat = [{ is_user: false, mes: original }];
    const { sam, localVariables, messageWrites } = makeRuntime(chat, { gold: 1 }, { worldbookEntries: [] });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), false);
    assert.equal(chat[0].mes, original);
    assert.equal(localVariables.SAM_data.static.gold, 6);
    assert.equal(messageWrites.length, 0);
});

test('re-update restores the original patch when writing the replacement fails', async () => {
    const original = 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const chat = [{ is_user: false, mes: original }];
    const { sam, localVariables, messageWrites } = makeRuntime(chat, { gold: 1 }, {
        sendRequest: async () => '<JSONPatch>[{"op":"inc","path":"/gold","value":3}]</JSONPatch>',
        failMessageWrite: writeNumber => writeNumber === 2,
    });
    sam.enableIndependent();
    assert.equal(await sam.regenerateLatestVariableUpdate(), false);
    assert.equal(chat[0].mes, original);
    assert.equal(localVariables.SAM_data.static.gold, 6);
    assert.equal(messageWrites.length, 3);
});

test('merged mode keeps the visible re-update button disabled and rejects invocation', async () => {
    const original = 'story\n<JSONPatch>[{"op":"inc","path":"/gold","value":5}]</JSONPatch>';
    const chat = [{ is_user: false, mes: original }];
    const { sam, messageWrites } = makeRuntime(chat);
    sam.enableIndependent();
    sam.setUpdateMode('merged');
    const mergedHtml = sam.renderUpdateHtml();
    assert.match(mergedHtml, /id="btn_regenerate_update"[^>]*disabled/);
    assert.equal(await sam.regenerateLatestVariableUpdate(), false);
    assert.equal(chat[0].mes, original);
    assert.equal(messageWrites.length, 0);
    sam.setUpdateMode('independent');
    const independentHtml = sam.renderUpdateHtml();
    assert.match(independentHtml, /id="btn_regenerate_update"/);
    assert.doesNotMatch(independentHtml, /id="btn_regenerate_update"[^>]*disabled/);
});
