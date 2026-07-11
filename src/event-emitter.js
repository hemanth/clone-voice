/**
 * Minimal EventEmitter compatible with both browser and Node environments.
 * Follows the EventTarget-style API used by pocket-voice.
 */
export class EventEmitter {
  constructor() {
    /** @type {Record<string, Array<{callback: Function, once: boolean}>>} */
    this._events = {};
  }

  /**
   * Register an event listener.
   * @param {string} event
   * @param {Function} listener
   * @param {{ once?: boolean }} [options]
   * @returns {this}
   */
  on(event, listener, options = {}) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push({
      callback: listener,
      once: options.once || false,
    });
    return this;
  }

  /**
   * Register a one-time event listener.
   * @param {string} event
   * @param {Function} listener
   * @returns {this}
   */
  once(event, listener) {
    return this.on(event, listener, { once: true });
  }

  /**
   * Remove an event listener.
   * @param {string} event
   * @param {Function} listener
   * @returns {this}
   */
  off(event, listener) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(
      (entry) => entry.callback !== listener
    );
    return this;
  }

  /**
   * Emit an event with optional data.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter((entry) => {
      entry.callback.call(this, data);
      return !entry.once;
    });
  }

  /**
   * Remove all listeners for an event, or all events if no event specified.
   * @param {string} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }
}
