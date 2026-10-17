/**
 * Character Preset + Global Lorebook Binder for SillyTavern.
 * - Identifies characters by their local avatar file key, not character display name.
 * - Preset binding is per character and API; global lorebook binding is per character.
 * - Disabling lorebook control leaves current global lorebooks untouched.
 * - Explicitly binding an empty lorebook list clears all global lorebooks on activation.
 */
import { selected_world_info, world_names } from '../../../world-info.js';

const EXTENSION_KEY = 'st_character_preset_binder';
const ROOT_ID = 'cpb-settings-root';
const APPLY_DELAY_MS = 160;
let started = false;
let pendingApply = null;
let applyRevision = 0;
let elements = null;

function context() { return SillyTavern.getContext(); }
function getSettings() {
    const ctx = context();
    if (!ctx.extensionSettings[EXTENSION_KEY] || typeof ctx.extensionSettings[EXTENSION_KEY] !== 'object') {
        ctx.extensionSettings[EXTENSION_KEY] = { enabled: true, bindings: {}, worldBindings: {} };
        ctx.saveSettingsDebounced();
    }
    const settings = ctx.extensionSettings[EXTENSION_KEY];
    if (typeof settings.enabled !== 'boolean') settings.enabled = true;
    if (!settings.bindings || typeof settings.bindings !== 'object' || Array.isArray(settings.bindings)) settings.bindings = {};
    if (!settings.worldBindings || typeof settings.worldBindings !== 'object' || Array.isArray(settings.worldBindings)) settings.worldBindings = {};
    return settings;
}
function saveSettings() { context().saveSettingsDebounced(); }

/** characterId is an unstable array index; persist avatar filename instead. */
function activeCharacter() {
    const ctx = context();
    if (ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '') return null;
    if (ctx.characterId === undefined || ctx.characterId === null || ctx.characterId === '') return null;
    const character = ctx.characters?.[Number(ctx.characterId)];
    if (!character) return null;
    const key = String(character.avatar ?? character.data?.avatar ?? '').trim();
    return key ? { key, name: String(character.name ?? character.data?.name ?? '未命名角色') } : null;
}
function activePresetManager() {
    const ctx = context();
    const manager = ctx.getPresetManager?.();
    if (!manager) return null;
    return { manager, apiId: String(manager.apiId || ctx.mainApi || 'openai') };
}
function presetBindingFor(key, apiId) { return getSettings().bindings[key]?.[apiId] ?? null; }
function worldBindingFor(key) { return getSettings().worldBindings[key] ?? null; }
function availableWorldNames() { return Array.isArray(world_names) ? world_names : []; }
function activeWorldNames() { return Array.isArray(selected_world_info) ? [...new Set(selected_world_info)] : []; }

function status(message, kind = 'normal') {
    if (!elements) return;
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
}
function currentApiText(apiId) {
    const names = { openai: 'Chat Completion', textgenerationwebui: 'Text Completion', novel: 'NovelAI', kobold: 'KoboldAI', koboldhorde: 'AI Horde' };
    return names[apiId] || apiId;
}
function makeElement(tag, className = '', text = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}
function selectedWorldsFromUI() {
    return [...elements.worldList.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}
function rebuildWorldChooser(savedWorlds) {
    const names = availableWorldNames();
    elements.worldList.replaceChildren();
    if (!names.length) {
        elements.worldList.append(makeElement('p', 'cpb-muted', '尚未创建或导入世界书。'));
        return;
    }
    for (const name of names) {
        const label = makeElement('label', 'cpb-world-choice');
        const input = makeElement('input');
        input.type = 'checkbox';
        input.value = name;
        input.checked = savedWorlds.includes(name);
        const text = makeElement('span', '', name);
        label.append(input, text);
        elements.worldList.append(label);
    }
}
function updatePanel() {
    if (!elements) return;
    const settings = getSettings();
    const card = activeCharacter();
    const active = activePresetManager();
    const presetRule = card && active ? presetBindingFor(card.key, active.apiId) : null;
    const worldRule = card ? worldBindingFor(card.key) : null;
    elements.enabled.checked = settings.enabled;
    elements.currentCharacter.textContent = card
        ? `${card.name}（角色卡文件：${card.key}）`
        : '没有选中单人角色卡（群聊暂不支持）';
    elements.api.textContent = active ? currentApiText(active.apiId) : '当前 API 暂无可用预设管理器';

    const names = active?.manager.getAllPresets?.() ?? [];
    const selected = elements.preset.value;
    elements.preset.replaceChildren();
    for (const name of names) elements.preset.add(new Option(name, name));
    const defaultName = presetRule?.preset || active?.manager.getSelectedPresetName?.() || '';
    const target = names.includes(selected) && document.activeElement === elements.preset ? selected : defaultName;
    if (names.includes(target)) elements.preset.value = target;
    elements.preset.disabled = !card || !active || !names.length;
    elements.savePreset.disabled = !card || !active || !names.length;
    elements.removePreset.disabled = !presetRule;

    const bookNames = availableWorldNames();
    const selectedBooks = Array.isArray(worldRule?.worlds) ? worldRule.worlds : activeWorldNames();
    elements.manageWorlds.checked = Boolean(worldRule);
    elements.manageWorlds.disabled = !card;
    elements.worldControl.disabled = !card || !elements.manageWorlds.checked;
    rebuildWorldChooser(selectedBooks);
    elements.saveWorlds.disabled = !card;
    elements.clearWorlds.disabled = !card || !elements.manageWorlds.checked;
    elements.removeWorlds.disabled = !worldRule;
    elements.worldCurrent.textContent = `当前全局启用：${activeWorldNames().join('、') || '无'}`;
    const missing = (worldRule?.worlds || []).filter(name => !bookNames.includes(name));
    elements.worldWarning.textContent = missing.length ? `注意：绑定的世界书已找不到：${missing.join('、')}。重新选择并保存后即可修复。` : '';
    elements.alias.disabled = !card;
    elements.alias.value = worldRule?.alias ?? presetRule?.alias ?? '';

    const segments = [];
    if (presetRule) segments.push(`预设：${presetRule.preset}`);
    if (worldRule) segments.push(`全局世界书：${worldRule.worlds.length ? worldRule.worlds.join('、') : '明确不启用任何世界书'}`);
    if (!card) status('请先打开一张角色卡的单人聊天。');
    else if (presetRule && !names.includes(presetRule.preset)) status(`找不到已绑定预设「${presetRule.preset}」，预设将保持原状。`, 'warning');
    else if (missing.length) status('已绑定的部分世界书不存在，请检查世界书名称。', 'warning');
    else if (segments.length) status(`已绑定 ${segments.join('；')}${settings.enabled ? '' : '（自动应用已暂停）'}`, 'success');
    else status('当前角色尚未绑定预设或全局世界书。');
    updateBindingList();
}
function updateBindingList() {
    if (!elements) return;
    const settings = getSettings();
    const allKeys = new Set([...Object.keys(settings.bindings), ...Object.keys(settings.worldBindings)]);
    const rows = [];
    for (const key of allKeys) {
        const presets = Object.entries(settings.bindings[key] || {})
            .filter(([, rule]) => typeof rule?.preset === 'string')
            .map(([apiId, rule]) => `${currentApiText(apiId)}：${rule.preset}`);
        const worldRule = settings.worldBindings[key];
        if (!presets.length && !worldRule) continue;
        const presetRule = Object.values(settings.bindings[key] || {}).find(rule => rule?.name);
        rows.push({ key, presets, worldRule, name: worldRule?.name || presetRule?.name || '未命名角色', alias: worldRule?.alias || presetRule?.alias || '' });
    }
    rows.sort((a, b) => (a.alias || a.name).localeCompare(b.alias || b.name, 'zh'));
    elements.list.replaceChildren();
    if (!rows.length) {
        elements.list.append(makeElement('p', 'cpb-muted', '还没有保存任何绑定。'));
        return;
    }
    const knownCards = new Set((context().characters ?? []).map(ch => String(ch.avatar ?? ch.data?.avatar ?? '')));
    for (const item of rows) {
        const row = makeElement('div', 'cpb-row');
        const body = makeElement('div', 'cpb-row-body');
        body.append(makeElement('div', 'cpb-row-title', item.alias || item.name));
        for (const line of item.presets) body.append(makeElement('div', 'cpb-muted', `预设 · ${line}`));
        if (item.worldRule) body.append(makeElement('div', 'cpb-muted', `全局世界书 · ${item.worldRule.worlds.length ? item.worldRule.worlds.join('、') : '不启用任何世界书'}`));
        body.append(makeElement('div', 'cpb-file', `${item.key}${knownCards.has(item.key) ? '' : ' · 本地找不到该角色卡'}`));
        const remove = makeElement('button', 'cpb-delete', '全部解除');
        remove.type = 'button';
        remove.title = '仅删除该角色的全部绑定，不删除卡片、预设或世界书';
        remove.addEventListener('click', () => {
            delete getSettings().bindings[item.key];
            delete getSettings().worldBindings[item.key];
            saveSettings();
            updatePanel();
        });
        row.append(body, remove);
        elements.list.append(row);
    }
}
function deletePresetBinding(key, apiId) {
    const settings = getSettings();
    if (!settings.bindings[key]?.[apiId]) return;
    delete settings.bindings[key][apiId];
    if (!Object.keys(settings.bindings[key]).length) delete settings.bindings[key];
    saveSettings();
}
function deleteWorldBinding(key) {
    delete getSettings().worldBindings[key];
    saveSettings();
}
async function saveCurrentPresetBinding() {
    const card = activeCharacter();
    const active = activePresetManager();
    const name = elements.preset.value;
    if (!card || !active || !active.manager.getAllPresets?.().includes(name)) {
        status('无法保存：请先打开角色卡，并选择有效的预设。', 'warning');
        return;
    }
    const settings = getSettings();
    settings.bindings[card.key] ??= {};
    settings.bindings[card.key][active.apiId] = { name: card.name, alias: elements.alias.value.trim(), preset: name };
    if (settings.worldBindings[card.key]) settings.worldBindings[card.key].alias = elements.alias.value.trim();
    saveSettings();
    updatePanel();
    status(`预设绑定成功：${card.name} → ${name}`, 'success');
    if (settings.enabled) await applyBinding('preset saved');
}
function saveCurrentWorldBinding() {
    const card = activeCharacter();
    if (!card) { status('请先打开一张角色卡。', 'warning'); return; }
    const settings = getSettings();
    if (!elements.manageWorlds.checked) {
        deleteWorldBinding(card.key);
        updatePanel();
        status('已取消接管这张卡的全局世界书；当前启用状态保持不变。', 'success');
        return;
    }
    const worlds = selectedWorldsFromUI();
    settings.worldBindings[card.key] = { name: card.name, alias: elements.alias.value.trim(), worlds };
    for (const presetRule of Object.values(settings.bindings[card.key] || {})) {
        if (presetRule && typeof presetRule === 'object') presetRule.alias = elements.alias.value.trim();
    }
    saveSettings();
    if (settings.enabled) applyWorldBinding(card, settings.worldBindings[card.key]);
    updatePanel();
    status(worlds.length ? `全局世界书绑定成功：${worlds.join('、')}` : '已绑定为空列表：进入该角色时关闭全部全局世界书。', 'success');
}
/** Native SillyTavern select element triggers official persistence and update events. */
function applyWorldBinding(card, rule) {
    if (!rule || !Array.isArray(rule.worlds)) return;
    const allNames = availableWorldNames();
    const missing = rule.worlds.filter(name => !allNames.includes(name));
    if (missing.length) {
        console.warn('[Character Preset Binder] Missing global lorebooks:', missing);
        status(`以下全局世界书不存在：${missing.join('、')}；已保持当前世界书不变。`, 'warning');
        return;
    }
    const current = activeWorldNames();
    if (current.length === rule.worlds.length && current.every(name => rule.worlds.includes(name))) return;
    // Recheck as switches can race while a user browses quickly.
    if (activeCharacter()?.key !== card.key) return;
    const nativeSelect = document.getElementById('world_info');
    if (!nativeSelect || typeof $ !== 'function') {
        status('找不到酒馆的全局世界书选择器，无法自动切换。', 'warning');
        return;
    }
    const indexes = rule.worlds.map(name => String(allNames.indexOf(name)));
    $(nativeSelect).val(indexes).trigger('change');
    console.debug('[Character Preset Binder] Global lorebooks:', card.key, rule.worlds);
}
async function applyBinding(reason = 'chat') {
    if (!getSettings().enabled) return;
    const card = activeCharacter();
    if (!card) return;
    const worldRule = worldBindingFor(card.key);
    if (worldRule) {
        applyWorldBinding(card, worldRule);
        updatePanel();
    }
    const active = activePresetManager();
    if (!active) return;
    const rule = presetBindingFor(card.key, active.apiId);
    if (!rule?.preset) return;
    const { manager } = active;
    if (manager.getSelectedPresetName?.() === rule.preset) return;
    const names = manager.getAllPresets?.() || [];
    if (!names.includes(rule.preset)) {
        status(`找不到已绑定预设「${rule.preset}」，当前预设保持不变。`, 'warning');
        return;
    }
    const value = manager.findPreset?.(rule.preset);
    if (value === undefined || value === null) {
        status('无法解析预设，请检查预设管理器。', 'warning');
        return;
    }
    if (activeCharacter()?.key !== card.key || activePresetManager()?.apiId !== active.apiId) return;
    try {
        await manager.selectPreset(value);
        console.debug('[Character Preset Binder]', reason, card.key, '→', rule.preset);
        // If the selected chat was replaced while an async operation was in progress,
        // reapply the correct card on the next turn of the event loop.
        if (activeCharacter()?.key !== card.key) scheduleApply('switch reconciliation');
        updatePanel();
    } catch (error) {
        console.error('[Character Preset Binder] Failed to switch preset:', error);
        status('预设自动切换失败，可查看浏览器控制台。', 'warning');
    }
}
function scheduleApply(reason = 'chat') {
    const token = ++applyRevision;
    if (pendingApply !== null) clearTimeout(pendingApply);
    pendingApply = setTimeout(() => {
        pendingApply = null;
        if (token !== applyRevision) return;
        void applyBinding(reason);
    }, APPLY_DELAY_MS);
}
function installUI() {
    if (document.getElementById(ROOT_ID)) return;
    const parent = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!parent) { console.warn('[Character Preset Binder] Extension settings container not found.'); return; }
    const root = makeElement('section', 'cpb-root');
    root.id = ROOT_ID;
    root.innerHTML = `
      <details class="cpb-details">
        <summary>🔗 角色卡 · 预设与世界书绑定器</summary>
        <div class="cpb-content">
          <label class="cpb-switch"><input id="cpb-enabled" type="checkbox"/> 角色切换时自动应用绑定</label>
          <p class="cpb-muted">用本地角色卡文件区分同名角色；仅管理你主动绑定的内容，不更换 API 或模型。</p>
          <div class="cpb-field"><strong>当前角色</strong><div id="cpb-character" class="cpb-current"></div></div>
          <div class="cpb-field"><strong>当前 API</strong><div id="cpb-api"></div></div>
          <label class="cpb-field" for="cpb-alias"><strong>备注（可选）</strong><input id="cpb-alias" class="text_pole" maxlength="80" type="text" placeholder="修仙梨子 / 现代梨子" /></label>
          <div class="cpb-section-title">① 预设绑定（可不绑定）</div>
          <label class="cpb-field" for="cpb-preset"><strong>选择预设</strong><select id="cpb-preset" class="text_pole"></select></label>
          <div class="cpb-actions"><button id="cpb-save-preset" type="button" class="menu_button">保存预设绑定</button><button id="cpb-remove-preset" type="button" class="menu_button">解除预设绑定</button></div>
          <div class="cpb-section-title">② 全局世界书绑定（可不绑定）</div>
          <label class="cpb-switch"><input id="cpb-manage-worlds" type="checkbox"/> 启用这张卡的全局世界书自动切换</label>
          <p class="cpb-muted">不勾选＝完全不接管世界书，保持当前启用状态；勾选后，将全局世界书替换为下方选择的组合。</p>
          <fieldset id="cpb-world-control" class="cpb-world-control"><legend>选择世界书（支持多选）</legend><div id="cpb-world-list" class="cpb-world-list"></div><button id="cpb-clear-worlds" type="button" class="menu_button">取消勾选全部（保存后自动关闭所有全局世界书）</button></fieldset>
          <div id="cpb-world-current" class="cpb-muted"></div>
          <div id="cpb-world-warning" class="cpb-warning"></div>
          <div class="cpb-actions"><button id="cpb-save-worlds" type="button" class="menu_button">保存世界书设置</button><button id="cpb-remove-worlds" type="button" class="menu_button">解除世界书绑定</button></div>
          <div id="cpb-status" class="cpb-status" aria-live="polite"></div>
          <hr/><strong>已保存的绑定</strong><div id="cpb-list" class="cpb-list"></div>
        </div>
      </details>`;
    parent.append(root);
    const query = id => root.querySelector(`#${id}`);
    elements = {
        enabled: query('cpb-enabled'), currentCharacter: query('cpb-character'), api: query('cpb-api'), alias: query('cpb-alias'),
        preset: query('cpb-preset'), savePreset: query('cpb-save-preset'), removePreset: query('cpb-remove-preset'),
        manageWorlds: query('cpb-manage-worlds'), worldControl: query('cpb-world-control'), worldList: query('cpb-world-list'),
        clearWorlds: query('cpb-clear-worlds'), saveWorlds: query('cpb-save-worlds'), removeWorlds: query('cpb-remove-worlds'),
        worldCurrent: query('cpb-world-current'), worldWarning: query('cpb-world-warning'), status: query('cpb-status'), list: query('cpb-list'),
    };
    elements.enabled.addEventListener('change', () => {
        getSettings().enabled = elements.enabled.checked;
        saveSettings();
        if (elements.enabled.checked) scheduleApply('enabled');
        updatePanel();
    });
    elements.manageWorlds.addEventListener('change', () => {
        elements.worldControl.disabled = !elements.manageWorlds.checked;
        elements.clearWorlds.disabled = !elements.manageWorlds.checked;
        // The toggle is a draft until "保存世界书设置" is clicked.
    });
    elements.clearWorlds.addEventListener('click', () => {
        for (const checkbox of elements.worldList.querySelectorAll('input[type="checkbox"]')) checkbox.checked = false;
    });
    elements.savePreset.addEventListener('click', () => void saveCurrentPresetBinding());
    elements.removePreset.addEventListener('click', () => {
        const card = activeCharacter(), active = activePresetManager();
        if (!card || !active) return;
        deletePresetBinding(card.key, active.apiId);
        updatePanel();
        status('已解除当前 API 的预设绑定，其他绑定不受影响。', 'success');
    });
    elements.saveWorlds.addEventListener('click', () => saveCurrentWorldBinding());
    elements.removeWorlds.addEventListener('click', () => {
        const card = activeCharacter();
        if (!card) return;
        deleteWorldBinding(card.key);
        updatePanel();
        status('已解除全局世界书绑定；当前启用的世界书不会被改动。', 'success');
    });
    root.querySelector('summary').addEventListener('click', () => setTimeout(updatePanel, 0));
    updatePanel();
}
function initialize() {
    if (started) return;
    started = true;
    getSettings();
    installUI();
    const { eventSource, event_types } = context();
    eventSource.on(event_types.CHAT_CHANGED, () => { updatePanel(); scheduleApply('chat'); });
    if (event_types.MAIN_API_CHANGED) eventSource.on(event_types.MAIN_API_CHANGED, () => { updatePanel(); scheduleApply('api'); });
    if (event_types.PRESET_CHANGED) eventSource.on(event_types.PRESET_CHANGED, () => updatePanel());
    if (event_types.CHARACTER_EDITED) eventSource.on(event_types.CHARACTER_EDITED, () => updatePanel());
    scheduleApply('startup');
}
try {
    const ctx = context();
    ctx.eventSource.on(ctx.event_types.APP_READY, initialize);
} catch (error) {
    console.error('[Character Preset Binder] Initialization failed:', error);
}
