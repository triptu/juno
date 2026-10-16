import type { ComponentProps } from 'react'
import { AccountMenu } from '@juno/views'
import { Session } from './Session'

export default function AccountMenuContent(props: Omit<ComponentProps<typeof AccountMenu>, 'sections'>) {
  return <AccountMenu {...props} sections={[{ title: 'Session', content: <Session /> }]} />
}
