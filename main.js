require('dotenv').config();

const { eventBus } = require('./Core/eventBus');
const { SystemBootstrapper } = require('./Core/bootstrapper');
const { TaskHandler } = require('./Core/taskHandler');
const { logFail, logProgress } = require('./Logs/logger');

/* ========================= Wire up modules ========================= */
const taskHandler = new TaskHandler(eventBus);
const bootstrapper = new SystemBootstrapper(eventBus, { taskHandler });

// When TaskHandler detects LOGIN_EXPIRED, delegate to bootstrapper
eventBus.on('system:login_expired', () => bootstrapper.restartForLoginExpired());

/* ========================= Boot ========================= */
(async () => {
  await bootstrapper.boot((task) => taskHandler.handleIncomingTask(task));
})();

/* ========================= Process-level safety ========================= */
process.on('uncaughtException', (err) => {
  bootstrapper.handleFatalError('Uncaught Exception', err);
});

process.on('unhandledRejection', (reason) => {
  bootstrapper.handleFatalError('Unhandled Promise Rejection', reason);
});

process.on('SIGINT', () => {
  logProgress('Received SIGINT, shutting down gracefully...');
  bootstrapper.shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  logProgress('Received SIGTERM, shutting down gracefully...');
  bootstrapper.shutdown('SIGTERM', { notify: false });
});
