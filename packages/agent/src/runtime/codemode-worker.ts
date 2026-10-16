/**
 * The worker entry of the codemode sandbox. A bundled app has no
 * `node_modules`, so its build makes a file of this module and passes its
 * URL as `CodemodeRunner.workerUrl` (`runtime/codemode.ts`).
 */
import '@earendil-works/pi-codemode/worker'
