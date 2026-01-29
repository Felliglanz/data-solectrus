'use strict';

// Creates/extends ioBroker objects for this adapter.
// Goal: keep state/object boilerplate out of the runtime logic.

const { getItemOutputId } = require('./itemIds');

function getItemInfoBaseId(outputId) {
	return `items.${String(outputId)}`;
}

async function ensureChannelPath(adapter, id) {
	const raw = id ? String(id).trim() : '';
	if (!raw) return;
	const parts = raw.split('.').filter(Boolean);
	if (parts.length <= 1) return;

	let prefix = '';
	for (let i = 0; i < parts.length - 1; i++) {
		prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
		await adapter.setObjectNotExistsAsync(prefix, {
			type: 'channel',
			common: { name: parts[i] },
			native: {},
		});
	}
}

async function ensureOutputState(adapter, item) {
	const id = getItemOutputId(item);
	if (!id) return;

	await ensureChannelPath(adapter, id);

	const typeMap = {
		number: 'number',
		boolean: 'boolean',
		string: 'string',
		mixed: 'mixed',
	};
	const commonType = typeMap[item.type] || 'number';

	/** @type {ioBroker.SettableStateObject} */
	const obj = {
		type: 'state',
		common: {
			name: item.name || id,
			type: commonType,
			role: item.role || 'value',
			unit: item.unit || undefined,
			read: true,
			write: false,
		},
		native: {
			mode: item.mode || 'formula',
		},
	};

	const existing = await adapter.getObjectAsync(id);
	if (!existing) {
		await adapter.setObjectAsync(id, obj);
	} else {
		await adapter.extendObjectAsync(id, obj);
	}
}

async function ensureItemInfoStatesForCompiled(adapter, compiled) {
	if (!compiled || !compiled.outputId) return;
	const base = getItemInfoBaseId(compiled.outputId);

	await ensureChannelPath(adapter, `${base}.compiledOk`);

	await adapter.setObjectNotExistsAsync(`${base}.compiledOk`, {
		type: 'state',
		common: {
			name: 'Compiled OK',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.compileError`, {
		type: 'state',
		common: {
			name: 'Compile Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.lastError`, {
		type: 'state',
		common: {
			name: 'Last Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.lastOkTs`, {
		type: 'state',
		common: {
			name: 'Last OK Timestamp',
			type: 'string',
			role: 'date',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.lastEvalMs`, {
		type: 'state',
		common: {
			name: 'Last Evaluation Time (ms)',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
			unit: 'ms',
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.consecutiveErrors`, {
		type: 'state',
		common: {
			name: 'Consecutive Errors',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});
}

async function createInfoStates(adapter) {
	await adapter.setObjectNotExistsAsync('info.status', {
		type: 'state',
		common: {
			name: 'Status',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.itemsConfigured', {
		type: 'state',
		common: {
			name: 'Configured items',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.itemsEnabled', {
		type: 'state',
		common: {
			name: 'Enabled items',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.lastError', {
		type: 'state',
		common: {
			name: 'Last Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.lastRun', {
		type: 'state',
		common: {
			name: 'Last Run',
			type: 'string',
			role: 'date',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.evalTimeMs', {
		type: 'state',
		common: {
			name: 'Evaluation time (ms)',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.timeBudgetMs', {
		type: 'state',
		common: {
			name: 'Tick time budget (ms)',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.skippedItems', {
		type: 'state',
		common: {
			name: 'Skipped items (last tick)',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setStateAsync('info.status', 'starting', true);
	await adapter.setStateAsync('info.itemsConfigured', 0, true);
	await adapter.setStateAsync('info.itemsEnabled', 0, true);
	await adapter.setStateAsync('info.lastError', '', true);
	await adapter.setStateAsync('info.lastRun', '', true);
	await adapter.setStateAsync('info.evalTimeMs', 0, true);
	await adapter.setStateAsync('info.timeBudgetMs', 0, true);
	await adapter.setStateAsync('info.skippedItems', 0, true);
}

module.exports = {
	getItemInfoBaseId,
	ensureChannelPath,
	ensureOutputState,
	ensureItemInfoStatesForCompiled,
	createInfoStates,
};
