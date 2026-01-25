/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Custom Master/Detail editor for ioBroker Admin jsonConfig.
// - Supports both modern (module federation) and legacy (global customComponents) loading.
// - Exposes: DataSolectrusItems/Components -> default export object containing { DataSolectrusItemsEditor }.
(function () {
    'use strict';

    const REMOTE_NAME = 'DataSolectrusItems';
    const UI_VERSION = '2026-01-25 20260125-3';
    const DEBUG = false;
    let shareScope;

        // Neutral (self-created) inline logo for the editor header.
        // Intentionally NOT using third-party trademarks/logos.
        const HEADER_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffb000"/>
            <stop offset="1" stop-color="#ff5a00"/>
        </linearGradient>
    </defs>
    <rect x="12" y="18" width="104" height="92" rx="18" fill="#1f2937"/>
    <circle cx="44" cy="56" r="16" fill="url(#g)"/>
    <path d="M44 34v-8M44 86v-8M22 56h-8M74 56h-8M29 41l-6-6M65 77l-6-6M29 71l-6 6M65 35l-6 6" stroke="#ffb000" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
    <path d="M78 44h26M78 58h26M78 72h26" stroke="#93c5fd" stroke-width="6" stroke-linecap="round"/>
    <path d="M78 88h18" stroke="#34d399" stroke-width="6" stroke-linecap="round"/>
</svg>`;

    function compareVersions(a, b) {
        const pa = String(a)
            .split('.')
            .map(n => parseInt(n, 10));
        const pb = String(b)
            .split('.')
            .map(n => parseInt(n, 10));
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            const da = Number.isFinite(pa[i]) ? pa[i] : 0;
            const db = Number.isFinite(pb[i]) ? pb[i] : 0;
            if (da !== db) {
                return da - db;
            }
        }
        return 0;
    }

    async function loadShared(moduleName) {
        const scope = shareScope;
        if (!scope || !scope[moduleName]) {
            return null;
        }

        const versions = Object.keys(scope[moduleName]);
        if (!versions.length) {
            return null;
        }

        versions.sort(compareVersions);
        const best = versions[versions.length - 1];
        const entry = scope[moduleName][best];
        if (!entry || typeof entry.get !== 'function') {
            return null;
        }

        const factory = await entry.get();
        const mod = typeof factory === 'function' ? factory() : null;
        return mod && mod.__esModule && mod.default ? mod.default : mod;
    }

    function normalizeItems(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(item, t) {
        const enabled = !!(item && item.enabled);
        const group = item && item.group ? String(item.group).trim() : '';
        const targetId = item && item.targetId ? String(item.targetId).trim() : '';
        const id = (group && targetId) ? `${group}.${targetId}` : (targetId || group);
        const name = item && (item.name || id) ? String(item.name || id) : (t ? t('Item') : 'Item');
        return `${enabled ? '🟢 ' : '⚪ '}${name}`;
    }

    function ensureTitle(item, t) {
        return Object.assign({}, item || {}, { _title: calcTitle(item || {}, t) });
    }

    function makeNewItem(t) {
        const item = {
            enabled: false,
            name: '',
            group: '',
            targetId: '',
            mode: 'formula',
            sourceState: '',
            inputs: [],
            formula: '',
            type: '',
            role: '',
            unit: '',
            noNegative: false,
            clamp: false,
            min: '',
            max: '',
        };
        return ensureTitle(item, t);
    }

    function createDataSolectrusItemsEditor(React, AdapterReact) {
        return function DataSolectrusItemsEditor(props) {
            const DEFAULT_ITEMS_ATTR = 'items';
            const attr = (props && typeof props.attr === 'string' && props.attr) ? props.attr : DEFAULT_ITEMS_ATTR;
            const dataIsArray = Array.isArray(props && props.data);
            const dataIsObject = !!(props && props.data && typeof props.data === 'object' && !dataIsArray);

            const getDomThemeType = () => {
                try {
                    const doc = globalThis.document;
                    const root = doc && doc.documentElement ? doc.documentElement : null;

                    const rootAttrTheme = root ? root.getAttribute('data-theme') : '';
                    if (rootAttrTheme === 'dark' || rootAttrTheme === 'light') return rootAttrTheme;

                    // MUI v5 color scheme (some Admin versions)
                    const muiScheme = root ? root.getAttribute('data-mui-color-scheme') : '';
                    if (muiScheme === 'dark' || muiScheme === 'light') return muiScheme;

                    const colorScheme = root ? root.getAttribute('data-color-scheme') : '';
                    if (colorScheme === 'dark' || colorScheme === 'light') return colorScheme;

                    const body = doc ? doc.body : null;
                    if (body && body.classList) {
                        if (body.classList.contains('mui-theme-dark') || body.classList.contains('iob-theme-dark')) {
                            return 'dark';
                        }
                        if (body.classList.contains('mui-theme-light') || body.classList.contains('iob-theme-light')) {
                            return 'light';
                        }
                    }

                    if (root && root.classList) {
                        if (root.classList.contains('mui-theme-dark') || root.classList.contains('iob-theme-dark')) return 'dark';
                        if (root.classList.contains('mui-theme-light') || root.classList.contains('iob-theme-light')) return 'light';
                    }
                } catch {
                    // ignore
                }
                return '';
            };

            const getThemeType = () => {
                // DOM is the source of truth for the currently active Admin theme.
                // Some Admin theme switches do not trigger a re-render of custom components.
                const domTheme = getDomThemeType();
                if (domTheme === 'dark' || domTheme === 'light') {
                    return domTheme;
                }

                if (props && typeof props.themeType === 'string' && (props.themeType === 'dark' || props.themeType === 'light')) {
                    return props.themeType;
                }

                const mode = props && props.theme && props.theme.palette && props.theme.palette.mode;
                if (mode === 'dark' || mode === 'light') {
                    return mode;
                }

                return '';
            };

            const [themeType, setThemeType] = React.useState(() => getThemeType());

            React.useEffect(() => {
                let observer;
                let interval;
                let media;

                const update = () => {
                    const next = getThemeType();
                    if (next === 'dark' || next === 'light') {
                        setThemeType(prev => (prev === next ? prev : next));
                    }
                };

                // Sync once on mount.
                update();

                // Best-effort: detect theme changes without relying on custom component re-render.
                try {
                    const doc = globalThis.document;
                    if (doc && typeof globalThis.MutationObserver === 'function') {
                        observer = new globalThis.MutationObserver(update);

                        // Observe root/body + body subtree for attribute-based theme markers.
                        const attributeFilter = ['data-theme', 'data-mui-color-scheme', 'data-color-scheme', 'class'];
                        if (doc.documentElement) {
                            observer.observe(doc.documentElement, { attributes: true, attributeFilter });
                        }
                        if (doc.body) {
                            observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
                            observer.observe(doc.body, { attributes: true, subtree: true, attributeFilter });
                        }
                    }
                } catch {
                    // ignore
                }

                // Fallback: periodic check (cheap) for Admin versions that don't mutate attributes we track.
                try {
                    interval = globalThis.setInterval(update, 500);
                } catch {
                    // ignore
                }

                // Browser/OS theme changes.
                try {
                    if (globalThis.matchMedia) {
                        media = globalThis.matchMedia('(prefers-color-scheme: dark)');
                        if (media && typeof media.addEventListener === 'function') {
                            media.addEventListener('change', update);
                        } else if (media && typeof media.addListener === 'function') {
                            media.addListener(update);
                        }
                    }
                } catch {
                    // ignore
                }

                return () => {
                    try {
                        observer && observer.disconnect();
                    } catch {
                        // ignore
                    }
                    try {
                        interval && globalThis.clearInterval(interval);
                    } catch {
                        // ignore
                    }
                    try {
                        if (media && typeof media.removeEventListener === 'function') {
                            media.removeEventListener('change', update);
                        } else if (media && typeof media.removeListener === 'function') {
                            media.removeListener(update);
                        }
                    } catch {
                        // ignore
                    }
                };
            }, []);

            const isDark = themeType === 'dark';
            const theme = (props && props.theme) || null;
            const themePalette = theme && theme.palette ? theme.palette : null;
            const paletteMatches = !!(themePalette && (themePalette.mode === 'dark' || themePalette.mode === 'light') && themePalette.mode === themeType);
            const effectivePalette = paletteMatches ? themePalette : null;

            const fallbackColors = isDark
                ? {
                      panelBg: '#1f1f1f',
                      panelBg2: '#242424',
                      text: '#ffffff',
                      textMuted: 'rgba(255,255,255,0.75)',
                      border: 'rgba(255,255,255,0.16)',
                      rowBorder: 'rgba(255,255,255,0.10)',
                      hover: 'rgba(255,255,255,0.06)',
                      active: 'rgba(255,255,255,0.10)',
                  }
                : {
                      panelBg: '#ffffff',
                      panelBg2: '#ffffff',
                      text: '#111111',
                      textMuted: 'rgba(0,0,0,0.70)',
                      border: 'rgba(0,0,0,0.15)',
                      rowBorder: 'rgba(0,0,0,0.10)',
                      hover: 'rgba(0,0,0,0.05)',
                      active: 'rgba(0,0,0,0.08)',
                  };

            // Prefer the surrounding Admin theme to keep this editor visually consistent.
            // Fallback to the self-defined palette if theme is unavailable.
            const colors = Object.assign({}, fallbackColors, {
                panelBg: (effectivePalette && effectivePalette.background && effectivePalette.background.paper) || fallbackColors.panelBg,
                panelBg2:
                    (effectivePalette && effectivePalette.background && (effectivePalette.background.paper || effectivePalette.background.default)) ||
                    fallbackColors.panelBg2,
                text: (effectivePalette && effectivePalette.text && effectivePalette.text.primary) || fallbackColors.text,
                textMuted: (effectivePalette && effectivePalette.text && effectivePalette.text.secondary) || fallbackColors.textMuted,
                border: (effectivePalette && effectivePalette.divider) || fallbackColors.border,
                rowBorder: (effectivePalette && effectivePalette.divider) || fallbackColors.rowBorder,
                hover: (effectivePalette && effectivePalette.action && effectivePalette.action.hover) || fallbackColors.hover,
                active: (effectivePalette && effectivePalette.action && effectivePalette.action.selected) || fallbackColors.active,
                inputBg:
                    (effectivePalette && effectivePalette.background && effectivePalette.background.paper) ||
                    (isDark ? 'rgba(255,255,255,0.06)' : '#ffffff'),
            });

            const DialogSelectID = AdapterReact && (AdapterReact.DialogSelectID || AdapterReact.SelectID);
            const socket = (props && props.socket) || globalThis.socket || globalThis._socket || null;

            const t = text => {
                try {
                    if (props && typeof props.t === 'function') {
                        return props.t(text);
                    }
                } catch {
                    // ignore
                }

                const I18n =
                    (AdapterReact && AdapterReact.I18n) ||
                    globalThis.I18n ||
                    (globalThis.window && globalThis.window.I18n);

                try {
                    if (I18n && typeof I18n.t === 'function') {
                        return I18n.t(text);
                    }
                    if (I18n && typeof I18n.getTranslation === 'function') {
                        return I18n.getTranslation(text);
                    }
                } catch {
                    // ignore
                }

                return text;
            };

            const items = dataIsArray
                ? normalizeItems(props.data)
                : normalizeItems(
                      (props.data && props.data[DEFAULT_ITEMS_ATTR]) ||
                          (props.data && props.data[attr]) ||
                          (props.data && props.data.itemsEditor)
                  );

            const [selectedIndex, setSelectedIndex] = React.useState(0);
            const [selectContext, setSelectContext] = React.useState(null);
            const [openDropdown, setOpenDropdown] = React.useState(null);

            React.useEffect(() => {
                const onDocMouseDown = e => {
                    if (!openDropdown) return;
                    try {
                        const target = e && e.target;
                        if (target && target.closest && target.closest('[data-ds-dropdown="1"]')) {
                            return;
                        }
                    } catch {
                        // ignore
                    }
                    setOpenDropdown(null);
                };

                try {
                    globalThis.document && globalThis.document.addEventListener('mousedown', onDocMouseDown);
                } catch {
                    // ignore
                }

                return () => {
                    try {
                        globalThis.document && globalThis.document.removeEventListener('mousedown', onDocMouseDown);
                    } catch {
                        // ignore
                    }
                };
            }, [openDropdown]);

            React.useEffect(() => {
                if (selectedIndex > items.length - 1) {
                    setSelectedIndex(Math.max(0, items.length - 1));
                }
            }, [items.length, selectedIndex]);

            const setByPath = (rootObj, path, value) => {
                if (!path) {
                    return value;
                }

                const parts = String(path).split('.').filter(Boolean);
                const clonedRoot = Array.isArray(rootObj)
                    ? rootObj.slice()
                    : Object.assign({}, rootObj || {});
                let cursor = clonedRoot;

                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    const isArrayIndex = Array.isArray(cursor) && /^\d+$/.test(part);
                    const key = isArrayIndex ? parseInt(part, 10) : part;
                    const existing = cursor[key];

                    const next = Array.isArray(existing)
                        ? existing.slice()
                        : existing && typeof existing === 'object'
                          ? Object.assign({}, existing)
                          : {};

                    cursor[key] = next;
                    cursor = next;
                }

                const last = parts[parts.length - 1];
                const lastKey = Array.isArray(cursor) && /^\d+$/.test(last) ? parseInt(last, 10) : last;
                cursor[lastKey] = value;

                return clonedRoot;
            };

            const updateItems = nextItems => {
                if (typeof props.onChange !== 'function') {
                    return;
                }

                const onChange = props.onChange;
                const cb = () => {
                    try {
                        if (props && typeof props.forceUpdate === 'function') {
                            props.forceUpdate([attr], props.data);
                        }
                    } catch {
                        // ignore
                    }
                };

                const safeItems = normalizeItems(nextItems).map(it => ensureTitle(it, t));

                if (props && props.custom) {
                    // Some Admin versions do NOT allow passing `attr` in jsonConfig for custom controls.
                    // So we always write to native.items, regardless of the schema field name.
                    try {
                        onChange(DEFAULT_ITEMS_ATTR, safeItems);
                    } catch {
                        // ignore
                    }
                    // Best-effort: also update the field that hosts this custom control to keep the UI in sync.
                    if (attr !== DEFAULT_ITEMS_ATTR) {
                        try {
                            onChange(attr, safeItems);
                        } catch {
                            // ignore
                        }
                    }
                    return;
                }

                if (dataIsObject) {
                    const nextData = setByPath(props.data, attr, safeItems);
                    onChange(nextData);
                    cb();
                    return;
                }

                onChange(safeItems);
            };

            const selectedItem = items[selectedIndex] || null;

            const updateSelected = (field, value) => {
                const nextItems = items.map((it, i) => {
                    if (i !== selectedIndex) return it;
                    const next = Object.assign({}, it || {});
                    next[field] = value;
                    return ensureTitle(next, t);
                });
                updateItems(nextItems);
            };

            const moveSelected = direction => {
                const from = selectedIndex;
                const to = from + direction;
                if (to < 0 || to >= items.length) return;

                const nextItems = items.slice();
                const tmp = nextItems[from];
                nextItems[from] = nextItems[to];
                nextItems[to] = tmp;

                updateItems(nextItems);
                setSelectedIndex(to);
            };

            const addItem = () => {
                const nextItems = items.concat([makeNewItem(t)]);
                updateItems(nextItems);
                setSelectedIndex(nextItems.length - 1);
            };

            const cloneSelected = () => {
                if (!selectedItem) return;
                const clone = ensureTitle(Object.assign({}, selectedItem), t);
                const nextItems = items.slice();
                nextItems.splice(selectedIndex + 1, 0, clone);
                updateItems(nextItems);
                setSelectedIndex(selectedIndex + 1);
            };

            const deleteSelected = () => {
                if (!selectedItem) return;
                const nextItems = items.slice();
                nextItems.splice(selectedIndex, 1);
                updateItems(nextItems);
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            };

            const updateInput = (index, field, value) => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
                const cur = inputs[index] && typeof inputs[index] === 'object' ? Object.assign({}, inputs[index]) : {};
                cur[field] = value;
                inputs[index] = cur;
                updateSelected('inputs', inputs);
            };

            const addInput = () => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
				inputs.push({ key: '', sourceState: '', noNegative: false });
                updateSelected('inputs', inputs);
            };

            const deleteInput = index => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
                inputs.splice(index, 1);
                updateSelected('inputs', inputs);
            };

            const rootStyle = {
                display: 'flex',
                gap: 12,
                width: '100%',
                minHeight: 360,
                height: '70vh',
                color: colors.text,
                position: 'relative',
                alignItems: 'stretch',
            };

            const leftStyle = {
                width: 340,
                maxWidth: '40%',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                background: colors.panelBg,
                height: '100%',
            };

            const rightStyle = {
                flex: 1,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 12,
                background: colors.panelBg2,
                height: '100%',
                overflow: 'auto',
            };

            const toolbarStyle = {
                display: 'flex',
                gap: 8,
                padding: 10,
                borderBottom: `1px solid ${colors.rowBorder}`,
                flexWrap: 'wrap',
            };

            const listStyle = {
                overflowY: 'auto',
                overflowX: 'hidden',
                flex: 1,
            };

            const btnStyle = {
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                cursor: 'pointer',
                color: colors.text,
            };

            const btnDangerStyle = Object.assign({}, btnStyle, {
                border: `1px solid ${isDark ? 'rgba(255,120,120,0.5)' : 'rgba(200,0,0,0.25)'}`,
            });

            const listBtnStyle = isActive => ({
                width: '100%',
                textAlign: 'left',
                padding: '10px 10px',
                border: 'none',
                borderBottom: `1px solid ${colors.rowBorder}`,
                background: isActive ? colors.active : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                overflow: 'hidden',
                color: colors.text,
            });

            const labelStyle = { display: 'block', fontSize: 12, color: colors.textMuted, marginTop: 10 };
            const inputStyle = {
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                fontFamily: 'inherit',
                fontSize: 14,
                color: colors.text,
                background: colors.inputBg,
            };

            // Chrome/OS dropdowns may render <option> on a light surface even in dark mode,
            // but inherit the white text color -> white on white. Force readable option styling.
            const selectStyle = Object.assign({}, inputStyle, {
                backgroundColor: colors.panelBg,
                color: colors.text,
                colorScheme: isDark ? 'dark' : 'light',
                WebkitTextFillColor: colors.text,
            });

            const optionStyle = {
                background: colors.panelBg,
                color: colors.text,
            };

            // Native <select>/<option> popups can ignore styles in Chrome dark mode (OS-rendered).
            // Use a custom dropdown to ensure readable options.
            // Match the visual style of normal inputs in this editor.
            // In dark mode, inputStyle.background is slightly transparent (rgba). For dropdown menus
            // that looks wrong because the page background shines through. Use an opaque panel color.
            const bgStr = String(inputStyle.background || '');
            const isTranslucent = isDark && bgStr.startsWith('rgba(');
            const dropdownBg = isTranslucent ? colors.panelBg : inputStyle.background;
            const dropdownText = colors.text;

            const dropdownButtonStyle = Object.assign({}, inputStyle, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: dropdownBg,
                color: dropdownText,
                cursor: 'pointer',
                userSelect: 'none',
            });

            const dropdownMenuStyle = {
                position: 'absolute',
                zIndex: 2000,
                left: 0,
                right: 0,
                marginTop: 6,
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: dropdownBg,
                color: dropdownText,
                boxShadow: isDark ? '0 10px 30px rgba(0,0,0,0.45)' : '0 10px 30px rgba(0,0,0,0.18)',
                maxHeight: 260,
                overflowY: 'auto',
                padding: 6,
            };

            const dropdownItemStyle = isActive => ({
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isActive ? colors.active : 'transparent',
                color: dropdownText,
            });

            const rowStyle2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

            const headerBarStyle = {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                marginBottom: 12,
            };

            const logoUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(HEADER_LOGO_SVG);

            const renderSelectButton = onClick =>
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        style: Object.assign({}, btnStyle, { padding: '8px 10px' }),
                        disabled: !(DialogSelectID && socket && theme),
                        title: DialogSelectID && socket && theme ? t('Select from existing states') : t('Selection dialog not available'),
                        onClick,
                    },
                    t('Select')
                );

            const renderStatePicker = () => {
                if (!selectContext || !(DialogSelectID && socket && theme)) return null;

                const selected = (() => {
                    if (!selectedItem) return '';
                    if (selectContext.kind === 'itemSource') {
                        return selectedItem.sourceState || '';
                    }
                    if (selectContext.kind === 'input' && Number.isFinite(selectContext.index)) {
                        const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs : [];
                        const inp = inputs[selectContext.index];
                        return inp && inp.sourceState ? inp.sourceState : '';
                    }
                    return '';
                })();

                return React.createElement(DialogSelectID, {
                    key: 'selectStateId',
                    imagePrefix: '../..',
                    dialogName: (props && (props.adapterName || props.adapter)) || 'data-solectrus',
                    themeType: themeType,
                    theme: theme,
                    socket: socket,
                    types: 'state',
                    selected: selected,
                    onClose: () => setSelectContext(null),
                    onOk: sel => {
                        const selectedStr = Array.isArray(sel) ? sel[0] : sel;
                        setSelectContext(null);
                        if (!selectedStr) return;
                        if (selectContext.kind === 'itemSource') {
                            updateSelected('sourceState', selectedStr);
                        }
                        if (selectContext.kind === 'input' && Number.isFinite(selectContext.index)) {
                            updateInput(selectContext.index, 'sourceState', selectedStr);
                        }
                    },
                });
            };

            return React.createElement(
                'div',
                { style: rootStyle },
                DEBUG
                    ? React.createElement(
                          'div',
                          {
                              style: {
                                  position: 'absolute',
                                  right: 14,
                                  marginTop: -22,
                                  fontSize: 11,
                                  opacity: 0.7,
                                  color: colors.textMuted,
                                  pointerEvents: 'none',
                              },
                          },
                          `Items UI ${UI_VERSION}`
                      )
                    : null,
                React.createElement(
                    'div',
                    { style: leftStyle },
                    React.createElement(
                        'div',
                        { style: toolbarStyle },
                        React.createElement('button', { type: 'button', style: btnStyle, onClick: addItem }, t('Add')),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: cloneSelected, disabled: !selectedItem },
                            t('Duplicate')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnDangerStyle, onClick: deleteSelected, disabled: !selectedItem },
                            t('Delete')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 },
                            t('Up')
                        ),
                        React.createElement(
                            'button',
                            {
                                type: 'button',
                                style: btnStyle,
                                onClick: () => moveSelected(1),
                                disabled: selectedIndex >= items.length - 1,
                            },
                            t('Down')
                        )
                    ),
                    React.createElement(
                        'div',
                        { style: listStyle },
                        items.length
                            ? items.map((it, i) =>
                                  React.createElement(
                                      'button',
                                      {
                                          key: i,
                                          type: 'button',
                                          style: listBtnStyle(i === selectedIndex),
                                          onClick: () => setSelectedIndex(i),
                                      },
                                      React.createElement('span', { style: { width: 22 } }, it.enabled ? '🟢' : '⚪'),
                                      React.createElement(
                                          'span',
                                          {
                                              style: {
                                                  fontWeight: 600,
                                                  flex: 1,
                                                  minWidth: 0,
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                              },
                                              title: it.name || it.targetId || t('Unnamed'),
                                          },
                                          it.name || it.targetId || t('Unnamed')
                                      )
                                  )
                              )
                            : React.createElement(
                                  'div',
                                  { style: { padding: 12, opacity: 0.9, color: colors.textMuted } },
                                  t('No items configured.')
                              )
                    )
                ),
                React.createElement(
                    'div',
                    { style: rightStyle },
                    selectedItem
                        ? React.createElement(
                              React.Fragment,
                              null,
                              React.createElement(
                                  'div',
                                  { style: headerBarStyle },
                                  React.createElement(
                                      'div',
                                      { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
                                      React.createElement('img', {
                                          src: logoUrl,
                                          width: 28,
                                          height: 28,
                                          style: { display: 'block', borderRadius: 6 },
                                          alt: 'Data-Solectrus',
                                      }),
                                      React.createElement(
                                          'div',
                                          { style: { minWidth: 0 } },
                                          React.createElement(
                                              'div',
                                              { style: { fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                              'Data-Solectrus'
                                          ),
                                          React.createElement(
                                              'div',
                                              { style: { fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                              t('Configured values')
                                          )
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 11, opacity: 0.7, color: colors.textMuted } },
                                      `UI ${UI_VERSION}`
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 16, fontWeight: 700 } },
                                      calcTitle(selectedItem, t)
                                  )
                              ),
                              React.createElement(
                                  'label',
                                  { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                                  React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!selectedItem.enabled,
                                      onChange: e => updateSelected('enabled', !!e.target.checked),
                                  }),
                                  React.createElement('span', null, t('Enabled'))
                              ),
                              React.createElement('label', { style: labelStyle }, t('Name')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.name || '',
                                  onChange: e => updateSelected('name', e.target.value),
                              }),
                              React.createElement('label', { style: labelStyle }, t('Folder/Group')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.group || '',
                                  onChange: e => updateSelected('group', e.target.value),
                                  placeholder: 'pv',
                              }),
                              React.createElement('label', { style: labelStyle }, t('Target ID')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.targetId || '',
                                  onChange: e => updateSelected('targetId', e.target.value),
                                  placeholder: 'pv.pvGesamt',
                              }),
                              React.createElement('label', { style: labelStyle }, t('Mode')),
                              React.createElement(
                                  'div',
                                  { style: { position: 'relative' }, 'data-ds-dropdown': '1' },
                                  React.createElement(
                                      'div',
                                      {
                                          style: dropdownButtonStyle,
                                          role: 'button',
                                          tabIndex: 0,
                                          onClick: () => setOpenDropdown(openDropdown === 'mode' ? null : 'mode'),
                                          onKeyDown: e => {
                                              if (e && (e.key === 'Enter' || e.key === ' ')) {
                                                  e.preventDefault();
                                                  setOpenDropdown(openDropdown === 'mode' ? null : 'mode');
                                              }
                                          },
                                      },
                                      React.createElement(
                                          'span',
                                          null,
                                          (selectedItem.mode || 'formula') === 'source' ? t('Source') : t('Formula')
                                      ),
                                      React.createElement('span', { style: { opacity: 0.75 } }, '▾')
                                  ),
                                  openDropdown === 'mode'
                                      ? React.createElement(
                                            'div',
                                            { style: dropdownMenuStyle },
                                            React.createElement(
                                                'div',
                                                {
                                                    style: dropdownItemStyle((selectedItem.mode || 'formula') === 'formula'),
                                                    onClick: () => {
                                                        updateSelected('mode', 'formula');
                                                        setOpenDropdown(null);
                                                    },
                                                },
                                                t('Formula')
                                            ),
                                            React.createElement(
                                                'div',
                                                {
                                                    style: dropdownItemStyle((selectedItem.mode || 'formula') === 'source'),
                                                    onClick: () => {
                                                        updateSelected('mode', 'source');
                                                        setOpenDropdown(null);
                                                    },
                                                },
                                                t('Source')
                                            )
                                        )
                                      : null
                              ),
                              (selectedItem.mode || 'formula') === 'source'
                                  ? React.createElement(
                                        React.Fragment,
                                        null,
                                        React.createElement('label', { style: labelStyle }, t('ioBroker Source State')),
                                        React.createElement(
                                            'div',
                                            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                                            React.createElement('input', {
                                                style: Object.assign({}, inputStyle, { flex: 1 }),
                                                type: 'text',
                                                value: selectedItem.sourceState || '',
                                                onChange: e => updateSelected('sourceState', e.target.value),
                                                placeholder: t('e.g. some.adapter.0.channel.state'),
                                            }),
                                            renderSelectButton(() => setSelectContext({ kind: 'itemSource' }))
                                        )
                                    )
                                  : React.createElement(
                                        React.Fragment,
                                        null,
                                        React.createElement(
                                            'div',
                                            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 } },
                                            React.createElement('div', { style: labelStyle }, t('Inputs')),
                                            React.createElement(
                                                'button',
                                                { type: 'button', style: btnStyle, onClick: addInput },
                                                t('Add input')
                                            )
                                        ),
                                        (Array.isArray(selectedItem.inputs) ? selectedItem.inputs : []).map((inp, idx) =>
                                            React.createElement(
                                                'div',
                                                {
                                                    key: idx,
                                                    style: {
                                                        display: 'grid',
                                                        gridTemplateColumns: '140px 1fr 90px 90px',
                                                        gap: 8,
                                                        alignItems: 'center',
                                                        marginTop: 8,
                                                    },
                                                },
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: (inp && inp.key) || '',
                                                    placeholder: t('Key'),
                                                    onChange: e => updateInput(idx, 'key', e.target.value),
                                                }),
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: (inp && inp.sourceState) || '',
                                                    placeholder: t('ioBroker Source State'),
                                                    onChange: e => updateInput(idx, 'sourceState', e.target.value),
                                                }),
                                                React.createElement(
                                                    'div',
                                                    { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' } },
                                                    React.createElement(
                                                        'label',
                                                        {
                                                            style: {
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 6,
                                                                fontSize: 11,
                                                                color: colors.textMuted,
                                                                cursor: 'pointer',
                                                            },
                                                            title: t('Clamp input negative to 0'),
                                                        },
                                                        React.createElement('input', {
                                                            type: 'checkbox',
                                                            checked: !!(inp && inp.noNegative),
                                                            onChange: e => updateInput(idx, 'noNegative', !!e.target.checked),
                                                        }),
                                                        React.createElement('span', null, 'neg→0')
                                                    ),
                                                    renderSelectButton(() => setSelectContext({ kind: 'input', index: idx }))
                                                ),
                                                React.createElement(
                                                    'button',
                                                    { type: 'button', style: btnDangerStyle, onClick: () => deleteInput(idx) },
                                                    t('Delete')
                                                )
                                            )
                                        ),
                                        React.createElement('label', { style: labelStyle }, t('Formula expression')),
                                        React.createElement('textarea', {
                                            style: Object.assign({}, inputStyle, { minHeight: 80 }),
                                            value: selectedItem.formula || '',
                                            onChange: e => updateSelected('formula', e.target.value),
                                            placeholder: t('e.g. pv1 + pv2 + pv3'),
                                        })
                                    ),
                              React.createElement(
                                  'div',
                                  { style: rowStyle2 },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Datatype')),
                                      React.createElement(
                                          'div',
                                          { style: { position: 'relative' }, 'data-ds-dropdown': '1' },
                                          React.createElement(
                                              'div',
                                              {
                                                  style: dropdownButtonStyle,
                                                  role: 'button',
                                                  tabIndex: 0,
                                                  onClick: () => setOpenDropdown(openDropdown === 'datatype' ? null : 'datatype'),
                                                  onKeyDown: e => {
                                                      if (e && (e.key === 'Enter' || e.key === ' ')) {
                                                          e.preventDefault();
                                                          setOpenDropdown(openDropdown === 'datatype' ? null : 'datatype');
                                                      }
                                                  },
                                              },
                                              React.createElement(
                                                  'span',
                                                  null,
                                                  selectedItem.type === 'number'
                                                      ? t('Number')
                                                      : selectedItem.type === 'boolean'
                                                            ? t('Boolean')
                                                            : selectedItem.type === 'string'
                                                                  ? t('String')
                                                                  : selectedItem.type === 'mixed'
                                                                        ? t('Mixed')
                                                                        : t('Standard')
                                              ),
                                              React.createElement('span', { style: { opacity: 0.75 } }, '▾')
                                          ),
                                          openDropdown === 'datatype'
                                              ? React.createElement(
                                                    'div',
                                                    { style: dropdownMenuStyle },
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(!selectedItem.type),
                                                            onClick: () => {
                                                                updateSelected('type', '');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Standard')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'number'),
                                                            onClick: () => {
                                                                updateSelected('type', 'number');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Number')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'boolean'),
                                                            onClick: () => {
                                                                updateSelected('type', 'boolean');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Boolean')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'string'),
                                                            onClick: () => {
                                                                updateSelected('type', 'string');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('String')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'mixed'),
                                                            onClick: () => {
                                                                updateSelected('type', 'mixed');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Mixed')
                                                    )
                                                )
                                              : null
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Role')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: selectedItem.role || '',
                                          onChange: e => updateSelected('role', e.target.value),
                                          placeholder: 'value.power',
                                      })
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  { style: rowStyle2 },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Unit')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: selectedItem.unit || '',
                                          onChange: e => updateSelected('unit', e.target.value),
                                          placeholder: 'W',
                                      })
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement(
                                          'label',
                                          { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                                          React.createElement('input', {
                                              type: 'checkbox',
                                              checked: !!selectedItem.clamp,
                                              onChange: e => updateSelected('clamp', !!e.target.checked),
                                          }),
                                          React.createElement('span', null, t('Clamp result'))
                                      )
                                  )
                              ),
                              React.createElement(
                                  'label',
                                  { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                                  React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!selectedItem.noNegative,
                                      onChange: e => updateSelected('noNegative', !!e.target.checked),
                                  }),
                                  React.createElement('span', null, t('Clamp negative to 0'))
                              ),
                              selectedItem.clamp
                                  ? React.createElement(
                                        'div',
                                        { style: rowStyle2 },
                                        React.createElement(
                                            'div',
                                            null,
                                            React.createElement('label', { style: labelStyle }, t('Min')),
                                            React.createElement('input', {
                                                style: inputStyle,
                                                type: 'number',
                                                value: selectedItem.min || '',
                                                onChange: e => updateSelected('min', e.target.value),
                                            })
                                        ),
                                        React.createElement(
                                            'div',
                                            null,
                                            React.createElement('label', { style: labelStyle }, t('Max')),
                                            React.createElement('input', {
                                                style: inputStyle,
                                                type: 'number',
                                                value: selectedItem.max || '',
                                                onChange: e => updateSelected('max', e.target.value),
                                            })
                                        )
                                    )
                                  : null,
                              renderStatePicker()
                          )
                        : React.createElement(
                              'div',
                              { style: { opacity: 0.9, color: colors.textMuted } },
                              t('Select an item on the left or add a new one.')
                          )
                )
            );
        };
    }

    const moduleMap = {
        './Components': async function () {
            const React = globalThis.React || (await loadShared('react'));
            const AdapterReact = await loadShared('@iobroker/adapter-react-v5');
            if (!React) {
                throw new Error('DataSolectrusItems custom UI: React not available.');
            }
            const DataSolectrusItemsEditor = createDataSolectrusItemsEditor(React, AdapterReact);

            // Legacy global registry (best-effort)
            try {
                globalThis.customComponents = globalThis.customComponents || {};
                globalThis.customComponents.DataSolectrusItemsEditor = DataSolectrusItemsEditor;
            } catch {
                // ignore
            }

            return {
                default: {
                    DataSolectrusItemsEditor,
                },
            };
        },
        'Components': async function () {
            return moduleMap['./Components']();
        },
    };

    function get(module) {
        const factoryFn = moduleMap[module];
        if (!factoryFn) {
            return Promise.reject(new Error(`Module ${module} not found in ${REMOTE_NAME}`));
        }
        return Promise.resolve()
            .then(() => factoryFn())
            .then(mod => () => mod);
    }

    function init(scope) {
        shareScope = scope;
    }

    globalThis[REMOTE_NAME] = {
        get,
        init,
    };
})();
