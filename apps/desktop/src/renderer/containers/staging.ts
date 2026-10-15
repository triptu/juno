/**
 * Reading and staging attached files. Loaded on its own (a dynamic import in
 * `attachments.tsx`), so it is not in the first bundle.
 */
import { attachFiles, registry } from '@juno/state'

export const stageFiles = (key: string, files: ReadonlyArray<File>) => attachFiles(registry, key, files)
