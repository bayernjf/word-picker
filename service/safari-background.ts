/**
 * Safari background page entry point.
 *
 * Safari does not support MV3 service_worker. This non-persistent background
 * page loads the polyfill and then imports the shared service worker logic.
 */

// The service worker module's top-level statements (onInstalled, onStartup, etc.)
// are executed when this script is loaded as a non-persistent background page.
import "../service/service-worker.js";
