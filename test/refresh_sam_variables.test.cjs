const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sam_state_manager.js'), 'utf8');

function makeRuntime(chat, baseStatic = { gold: 1 }) {
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
        '    window.__samTest = { dispatcher, queuePendingRefresh, setState: state => { curr_state = state; } };\n    const startup = () => { initSAM(); };',
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
        structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
        updateVariablesWith: async callback => callback(localVariables),
        setChatMessages: async messages => { messageWrites.push(messages); },
    });
    return { sam: win.__samTest, localVariables, messageWrites };
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
