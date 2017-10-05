'use strict';

const { Class, Mixin, toExtendable, mix } = require('foibles');
const HANDLE = Symbol('deviceHandle');

const Metadata = require('./lib/metadata');
const merge = require('./lib/utils/merge');

const th = require('./');

function traversePrototype(root, name, func) {
	let prototype = root.constructor;
	while(prototype != Device) {
		if(prototype.hasOwnProperty(name)) {
			// If this property belongs to this prototype get the value
			const value = prototype[name];
			if(typeof value !== 'undefined') {
				func(value);
			}
		}

		prototype = Object.getPrototypeOf(prototype);
	}
}

const Device = module.exports = toExtendable(class Device {
	constructor() {
		this.metadata = new Metadata();

		traversePrototype(this, 'availableAPI', items => this.metadata.expose(...items));
		traversePrototype(this, 'types', types => this.metadata.type(...types));
		traversePrototype(this, 'type', type => this.metadata.type(type));
		traversePrototype(this, 'capabilities', caps => this.metadata.capability(...caps));
	}

	/**
	 * Register this device and expose it over the network.
	 */
	register() {
		if(! this.id) {
			throw new Error('`id` must be set for device');
		}
		this[HANDLE] = th.devices.register(this.id, this);
	}

	/**
	 * Remove this device, will stop exposing it over the network.
	 */
	remove() {
		this[HANDLE].remove();
		delete this[HANDLE];
	}

	/**
	 * Emit an event with the given name and data.
	 *
	 * @param {string} event
	 * @param {*} data
	 */
	emitEvent(event, data) {
		const handle = this[HANDLE];
		if(! handle) return;

		handle.emit(event, data);
	}

	debug() {
		if(! this[HANDLE]) return;
		this[HANDLE].debug.apply(this[HANDLE], arguments);
	}

	/**
	 * Create a new type that can be mixed in with a Device.
	 *
	 * @param {function} func
	 */
	static type(func) {
		return Class(Device, func);
	}

	/**
	 * Create a new capability that can be mixed in with a Device.
	 *
	 * @param {function} func
	 */
	static capability(func) {
		return Mixin(func);
	}

	static mixin(obj, ...mixins) {
		const direct = Object.getPrototypeOf(obj);
		const parent = Object.getPrototypeOf(direct);

		const proto = {};
		for(let name of Object.getOwnPropertyNames(direct)) {
			proto[name] = direct[name];
		}
		const base = mix(parent.constructor, ...mixins);
		Object.setPrototypeOf(proto, base.prototype);

		Object.setPrototypeOf(obj, proto);

		const data = new base();
		merge(obj, data);
	}

	mixin(...mixins) {
		Device.mixin(this, ...mixins);
	}
});
