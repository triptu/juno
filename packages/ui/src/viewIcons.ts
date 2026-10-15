import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Book } from '@phosphor-icons/react/dist/icons/Book'
import { Briefcase } from '@phosphor-icons/react/dist/icons/Briefcase'
import { Bug } from '@phosphor-icons/react/dist/icons/Bug'
import { Calendar } from '@phosphor-icons/react/dist/icons/Calendar'
import { Code } from '@phosphor-icons/react/dist/icons/Code'
import { Coffee } from '@phosphor-icons/react/dist/icons/Coffee'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { Flag } from '@phosphor-icons/react/dist/icons/Flag'
import { Flask } from '@phosphor-icons/react/dist/icons/Flask'
import { Gift } from '@phosphor-icons/react/dist/icons/Gift'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { Heart } from '@phosphor-icons/react/dist/icons/Heart'
import { Leaf } from '@phosphor-icons/react/dist/icons/Leaf'
import { Lightning } from '@phosphor-icons/react/dist/icons/Lightning'
import { Megaphone } from '@phosphor-icons/react/dist/icons/Megaphone'
import { Robot } from '@phosphor-icons/react/dist/icons/Robot'
import { Rocket } from '@phosphor-icons/react/dist/icons/Rocket'
import { Shield } from '@phosphor-icons/react/dist/icons/Shield'
import { Star } from '@phosphor-icons/react/dist/icons/Star'
import { Trophy } from '@phosphor-icons/react/dist/icons/Trophy'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { Wrench } from '@phosphor-icons/react/dist/icons/Wrench'
import type { PhosphorIcon } from './Icon'

/**
 * The icons a sidebar view's pill can show (inventory 2.3): Phosphor icons
 * that read at 14px, in the order the view sheet offers them. The names are
 * what gets stored; `@juno/domain` repeats them as `VIEW_ICONS`.
 */
export const viewIcons = {
  robot: Robot,
  bell: Bell,
  lightning: Lightning,
  bug: Bug,
  rocket: Rocket,
  code: Code,
  megaphone: Megaphone,
  users: Users,
  briefcase: Briefcase,
  star: Star,
  flag: Flag,
  heart: Heart,
  eye: Eye,
  coffee: Coffee,
  calendar: Calendar,
  book: Book,
  globe: Globe,
  shield: Shield,
  wrench: Wrench,
  flask: Flask,
  leaf: Leaf,
  trophy: Trophy,
  gift: Gift,
} as const satisfies Record<string, PhosphorIcon>

export type ViewIconName = keyof typeof viewIcons

export const viewIconNames = Object.keys(viewIcons) as ReadonlyArray<ViewIconName>
