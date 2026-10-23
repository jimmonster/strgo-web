import { createAdmin } from './app.js';
createAdmin({ document, fetch: window.fetch.bind(window), confirm: window.confirm.bind(window), location: window.location }).start();
