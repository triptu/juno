import { Moon, Sun } from 'lucide-react'
import { Button, type ThemeName } from '@juno/ui'

export interface ThemeToggleViewProps {
  readonly theme: ThemeName
  /** Asks the owner to switch to the other theme. */
  readonly onToggle: () => void
}

/** One button that names the theme it switches to. Pressed means dark. */
export function ThemeToggleView({ theme, onToggle }: ThemeToggleViewProps) {
  const next: ThemeName = theme === 'light' ? 'dark' : 'light'
  return (
    <Button iconStart={theme === 'light' ? Moon : Sun} pressed={theme === 'dark'} onClick={onToggle}>
      {`Use ${next} theme`}
    </Button>
  )
}
