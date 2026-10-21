import * as stylex from '@stylexjs/stylex'
import { colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

/** How big or how far a picture is (`@juno/pictures`'s `PictureScale` has this shape). */
export type PictureScaleView =
  | { readonly kind: 'size'; readonly widthCm: number; readonly heightCm: number }
  | { readonly kind: 'distance'; readonly lightYears: number; readonly note?: string }
  | { readonly kind: 'distance'; readonly km: number; readonly note?: string }

export interface PictureScaleProps {
  readonly scale: PictureScaleView
  /** The picture's file, drawn to scale next to the person; undefined shows its shape in the secondary fill. */
  readonly src: string | undefined
}

/**
 * The picture page's scale (SPEC 12, "Pictures and the gallery"): an
 * artwork drawn to scale next to a person 170 cm tall, or how far away the
 * subject is on a line from Earth past the Moon, the Sun and the stars, with
 * how long its light took. Drawn once, from data; nothing in it moves.
 */
export function PictureScale({ scale, src }: PictureScaleProps) {
  return scale.kind === 'size' ? <SizeScale widthCm={scale.widthCm} heightCm={scale.heightCm} src={src} /> : <DistanceScale km={'km' in scale ? scale.km : scale.lightYears * KM_PER_LIGHT_YEAR} lightYears={'lightYears' in scale ? scale.lightYears : undefined} note={scale.note} />
}

const PERSON_CM = 170
/** The person's outline is 28 by 100 units; at 170 cm tall that is about 48 cm across. */
const PERSON_PATH = 'M14 0.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13ZM5 18c0-2.5 2-4 4.5-4h9c2.5 0 4.5 1.5 4.5 4v30c0 1.6-1.2 2.6-2.6 2.6-1.3 0-2.4-1-2.4-2.4V24h-1v73c0 1.8-1.4 3-3 3s-3-1.2-3-3V58h-1v39c0 1.8-1.4 3-3 3s-3-1.2-3-3V24H8v24.2c0 1.4-1.1 2.4-2.4 2.4C4.2 50.6 3 49.6 3 48Z'
const PERSON_WIDTH = (28 / 100) * PERSON_CM
/** The room between the person and the artwork, in cm. */
const GAP_CM = 30

function SizeScale({ widthCm, heightCm, src }: { readonly widthCm: number; readonly heightCm: number; readonly src: string | undefined }) {
  // Drawn in centimetres: the SVG scales the whole scene to fit the box, so a large canvas and a small print both fit.
  const width = PERSON_WIDTH + GAP_CM + widthCm
  const height = Math.max(PERSON_CM, heightCm)
  const left = PERSON_WIDTH + GAP_CM
  const words = `${cm(heightCm)} × ${cm(widthCm)} cm, beside a person ${PERSON_CM} cm tall`
  return (
    <figure data-picture-scale="size" {...stylex.props(styles.figure)}>
      <Text variant="sectionLabel" tone="muted" as="p">
        How big
      </Text>
      <div {...stylex.props(styles.ground)}>
        <svg role="img" aria-label={words} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMax meet" {...stylex.props(styles.drawing)}>
          <path d={PERSON_PATH} transform={`translate(0 ${height - PERSON_CM}) scale(${PERSON_CM / 100})`} {...stylex.props(styles.person)} />
          <rect x={left} y={height - heightCm} width={widthCm} height={heightCm} {...stylex.props(styles.artwork)} />
          {src === undefined ? null : <image href={src} x={left} y={height - heightCm} width={widthCm} height={heightCm} preserveAspectRatio="xMidYMax meet" />}
        </svg>
      </div>
      <Text variant="meta" tone="muted" as="figcaption" numeric selectable sx={styles.caption}>
        {words}
      </Text>
    </figure>
  )
}

const KM_PER_LIGHT_YEAR = 9.4607e12
const LIGHT_KM_PER_SECOND = 299_792.458
/** The line runs from 10,000 km to about 17 billion light-years, on a log scale. */
const LOG_FROM = 4
const LOG_TO = 23.2
/** Landmarks on the line, in km from Earth. NASA's figures: the Moon's average distance, 1 au, Neptune's average distance, Proxima Centauri at 4.25 light-years, the galactic centre at about 26,000 light-years, Andromeda at about 2.5 million light-years. */
const LANDMARKS: ReadonlyArray<{ readonly name: string; readonly km: number }> = [
  { name: 'Moon', km: 384_400 },
  { name: 'Sun', km: 149_600_000 },
  { name: 'Neptune', km: 4.5e9 },
  { name: 'Nearest star', km: 4.25 * KM_PER_LIGHT_YEAR },
  { name: 'Milky Way’s centre', km: 26_000 * KM_PER_LIGHT_YEAR },
  { name: 'Andromeda', km: 2.5e6 * KM_PER_LIGHT_YEAR },
]

const along = (km: number): number => Math.min(100, Math.max(0, ((Math.log10(km) - LOG_FROM) / (LOG_TO - LOG_FROM)) * 100))

function DistanceScale({ km, lightYears, note }: { readonly km: number; readonly lightYears: number | undefined; readonly note: string | undefined }) {
  // The distance, then the note when the picture has one, else how long its light took, worked out from the distance.
  const away = lightYears === undefined ? `About ${amount(km)} kilometres away.` : `About ${amount(lightYears)} light-years away.`
  const light = note ?? (lightYears === undefined ? `Light from there takes ${lightTime(km / LIGHT_KM_PER_SECOND)} to reach Earth.` : `The light in this picture left about ${amount(lightYears)} years ago.`)
  return (
    <figure data-picture-scale="distance" {...stylex.props(styles.figure)}>
      <Text variant="sectionLabel" tone="muted" as="p">
        How far
      </Text>
      <div aria-hidden {...stylex.props(styles.ruler)}>
        <span {...stylex.props(styles.rule)} />
        <span {...stylex.props(styles.earth)} />
        <span {...stylex.props(styles.label, styles.below, styles.start)}>Earth</span>
        {LANDMARKS.map((mark, index) => (
          <span key={mark.name}>
            <span {...stylex.props(styles.tick, styles.at(along(mark.km)))} />
            <span {...stylex.props(styles.label, index % 2 === 0 ? styles.above : styles.below, styles.centred, styles.at(along(mark.km)))}>{mark.name}</span>
          </span>
        ))}
        <span data-picture-scale-here="" {...stylex.props(styles.here, styles.at(along(km)))} />
      </div>
      <Text variant="body" tone="secondary" as="figcaption" numeric selectable>
        {away} {light}
      </Text>
    </figure>
  )
}

/** 7600 as "7,600"; 2.5e6 as "2.5 million"; 6e9 as "6 billion". */
function amount(value: number): string {
  const round = (n: number) => String(Math.round(n * 10) / 10)
  if (value >= 1e9) return `${round(value / 1e9)} billion`
  if (value >= 1e6) return `${round(value / 1e6)} million`
  return Math.round(value).toLocaleString('en-GB')
}

/** 48 as "48", 45.5 as "45.5". */
const cm = (value: number): string => (Math.round(value * 10) / 10).toLocaleString('en-GB')

function lightTime(seconds: number): string {
  if (seconds < 90) return Math.round(seconds) <= 1 ? 'about a second' : `about ${Math.round(seconds)} seconds`
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`
  return `about ${Math.round(seconds / 3600)} hours`
}

const styles = stylex.create({
  figure: { display: 'flex', flexDirection: 'column', margin: 0, marginTop: spacing['--space-7'] },
  // The line both stand on.
  ground: {
    display: 'flex',
    marginTop: spacing['--space-2-5'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-strong'],
  },
  drawing: { display: 'block', height: sizes['--picture-scale-height'], maxWidth: '100%' },
  person: { fill: colors['--foreground-muted'] },
  artwork: { fill: colors['--secondary-default'] },
  caption: { marginTop: spacing['--space-2'] },
  // The distance line: labels above and below the line, alternating, so neighbours never touch.
  ruler: { position: 'relative', height: sizes['--picture-scale-ruler'], marginTop: spacing['--space-2'], marginBottom: spacing['--space-2'] },
  rule: { position: 'absolute', insetInline: 0, top: '50%', height: spacing['--space-pixel'], backgroundColor: colors['--border-strongest'] },
  earth: {
    position: 'absolute',
    left: 0,
    top: '50%',
    width: sizes['--picture-scale-dot'],
    height: sizes['--picture-scale-dot'],
    borderRadius: '50%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--foreground-muted'],
    backgroundColor: colors['--background'],
    transform: 'translateY(-50%)',
  },
  tick: { position: 'absolute', top: '50%', width: spacing['--space-pixel'], height: sizes['--picture-scale-dot'], backgroundColor: colors['--foreground-muted'], transform: 'translateY(-50%)' },
  here: {
    position: 'absolute',
    top: '50%',
    width: sizes['--picture-scale-here'],
    height: sizes['--picture-scale-here'],
    borderRadius: '50%',
    backgroundColor: colors['--foreground-default'],
    transform: 'translate(-50%, -50%)',
  },
  at: (percent: number) => ({ left: `${percent}%` }),
  label: {
    position: 'absolute',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    color: colors['--foreground-muted'],
  },
  above: { top: 0 },
  below: { bottom: 0 },
  start: { left: 0 },
  centred: { transform: 'translateX(-50%)' },
})
