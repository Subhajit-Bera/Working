import { EventEmitter } from 'events';

const eventBus = new EventEmitter();

// optional: increase max listeners to avoid warnings in large apps
eventBus.setMaxListeners(100);

export default eventBus;
