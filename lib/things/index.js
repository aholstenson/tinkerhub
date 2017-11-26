'use strict';

const values = require('abstract-things/values');
const { EventEmitter } = require('abstract-things/events');

const createAdapter = require('./adapter');
const idGenerator = require('../utils/id');

const Instance = require('./instance');
const Collection = require('./collection');

const ALWAYS_TRUE = () => true;

/**
 * The public API for working with a layer.
 */
class Things {
	constructor(layer) {
		this.on = layer.on.bind(layer);
		this.off = layer.off.bind(layer);

		this.register = layer.register.bind(layer);
		this.registerDiscovery = layer.registerDiscovery.bind(layer);

		this.get = layer.get.bind(layer);
		this.all = layer.all.bind(layer);

		this.toString = this.inspect = () => 'Things{type=' + layer.type + '}';

		this.version = 0;
	}
}

/**
 * Layer on top of services that provides sugar on top of services for easier
 * discovery and use.
 */
module.exports = class {
	constructor(services) {
		this.services = services;
		this.type = 'things';

		this.publicApi = new Things(this);
		this.events = new EventEmitter(this.publicApi);
		this.instances = new Map();
		this.collections = new Set();

		services.on('available', this._handleServiceAvailable.bind(this));
		services.on('unavailable', this._handleServiceUnavailable.bind(this));
	}

	on(event, listener) {
		return this.events.on(event, listener);
	}

	off(event, listener) {
		return this.events.off(event, listener);
	}

	updateCollectionReference(collection, keepReference) {
		if(keepReference) {
			this.collections.add(collection);
		} else {
			this.collections.delete(collection);
		}
	}

	/**
	 * Go through all hard referenced collections and make sure that they
	 * reflect thing availability.
	 *
	 * @param {*} instance
	 */
	updateCollectionAvailability(instance) {
		this.version++;

		for(const c of this.collections) {
			if(c.filter(instance.publicApi)) {
				// Request that a thing should be added if not in collection
				c._add(instance);
			} else {
				// Delete a thing from the collection if it does not match
				c._delete(instance);
			}
		}
	}

	/**
	* A new service is available, wrap it into this layer
	*/
	_handleServiceAvailable(service) {
		if(service.id.indexOf(this.type + ':') !== 0) {
			// This service is not part of this layer
			return;
		}

		const metadata = service.metadata;
		let instance = this.instances.get(metadata.id);
		if(! instance) {
			instance = new Instance(this, metadata.id);
			instance.addService(service);

			this.instances.set(metadata.id, instance);
			this.events.emit('available', instance.publicApi);
		} else {
			instance.addService(service);
		}

		this.updateCollectionAvailability(instance);
	}

	_handleServiceUnavailable(service) {
		if(service.id.indexOf(this.type + ':') !== 0) {
			// This service is not part of this layer
			return;
		}

		const metadata = service.metadata;
		let instance = this.instances.get(metadata.id);
		if(! instance) return;

		this.version++;

		instance.removeService(service);
		if(instance.services.size == 0) {
			this.instances.delete(metadata.id);

			this.events.emit('unavailable', instance.publicApi);
		}

		this.updateCollectionAvailability(instance);
	}

	register(instance) {
		if(! instance.id) {
			throw new Error('The property `id` is required');
		}

		if(instance.id.indexOf(':') < 0) {
			throw new Error('The `id` must contain a namespace separated with a `:`');
		}

		return createAdapter(instance)
			.then(adapter => {
				const id = this.type + ':' + idGenerator();
				const handle = this.services.register(id, adapter);
				adapter[createAdapter.handle] = handle;
				if(instance.onAny) {
					instance.onAny((event, data) => {
						switch(event) {
							case 'thing:available':
								this.register(data)
									.then(h => data[createAdapter.handle] = h);
								break;
							case 'thing:unavailable':
								if(data[createAdapter.handle]) {
									data[createAdapter.handle].remove();
								}
								break;
							case 'thing:metadata':
								adapter[createAdapter.change]();
								break;
							default:
								handle.emitEvent(event, values.toJSON('mixed', data));
								break;
						}
					});
				}

				const promises = [];

				// Register children if they are available
				const children = instance.children;
				if(children && typeof children[Symbol.iterator] === 'function') {
					for(const child of instance.children) {
						promises.push(this.register(child));
					}
				}

				return Promise.all(promises)
					.then(() => handle);
			});
	}

	registerDiscovery(discovery) {
		// Automatically start the discovery
		discovery.start();

		const registered = new Map();

		const available = service => {
			this.register(service)
				.then(handle => registered.set(service.id, handle));
		};

		function unavailable(service) {
			const handle = registered.get(service.id);
			if(handle) {
				registered.delete(service.id);
				handle.remove();
			}
		}

		// Start listening for changes in instances
		discovery.on('available', available);
		discovery.on('unavailable', unavailable);

		return {
			remove: function() {
				discovery.off('available', available);
				discovery.off('unavailable', unavailable);

				// Remove all of the instances that come from this discovery
				for(const handle of registered) {
					handle.remove();
				}
			}
		};
	}

	/**
	 * Iterate over all of the instances.
	 */
	[Symbol.iterator]() {
		return this.instances.values();
	}

	/**
	* Get objects with certain tags.
	*/
	get(...tags) {
		return new Collection(this, a => {
			const md = a.metadata;
			for(const tag of tags) {
				// Check against both tags and id of device
				if(md.id !== tag && ! md.hasTag(tag)) return false;
			}

			return true;
		}).publicApi;
	}

	/**
	* Get all objects this layer makes available.
	*/
	all() {
		return new Collection(this, ALWAYS_TRUE).publicApi;
	}
};