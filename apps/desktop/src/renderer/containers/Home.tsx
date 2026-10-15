import { WorkspaceEmpty } from '@juno/views'

/**
 * Home (spec section 12): the Home tab, and what the workspace shows with no
 * tab open. The living Home page (the scene, the greeting, what wants you and
 * Ask Juno, `docs/design/home/`) is not built yet, so Home shows the empty
 * workspace. It replaces this component's body.
 */
export function HomePage() {
  return <WorkspaceEmpty />
}
