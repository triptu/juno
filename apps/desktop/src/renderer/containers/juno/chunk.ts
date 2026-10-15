/**
 * The Juno chat's containers as one chunk (performance 2.1: pages other than
 * the sidebar and the topic view load apart), fetched on idle once the window
 * is up, so the Juno tab and the panel are ready before they are asked for.
 */
export { JunoBackup, JunoConnections, JunoPageTab, JunoSettings } from './JunoPages'
export { JunoPanel } from './JunoPanel'
export { JunoTab } from './JunoTab'
