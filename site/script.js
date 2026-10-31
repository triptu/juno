document.documentElement.classList.add('js')

// Appearance: the system's choice unless you picked one. The nav's one button flips light and dark. A choice that
// matches the system is not kept, so the page follows the system again; it is applied in <head> before the first
// paint. Pictures follow through CSS (.light-only, .dark-only).
const root = document.documentElement
const systemDark = matchMedia('(prefers-color-scheme: dark)')
const toggle = document.querySelector('.theme')

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches)

function applyAppearance() {
  const dark = isDark()
  toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} appearance`)
  speedSource(dark)
  window.junoFields?.retheme()
}

toggle.addEventListener('click', () => {
  const dark = !isDark()
  try {
    if (dark === systemDark.matches) localStorage.removeItem('juno-theme')
    else localStorage.setItem('juno-theme', dark ? 'dark' : 'light')
  } catch {}
  if (dark === systemDark.matches) delete root.dataset.theme
  else root.dataset.theme = dark ? 'dark' : 'light'
  applyAppearance()
})
systemDark.addEventListener('change', applyAppearance)

// The film: nothing loads until Play.
const player = document.querySelector('.player')
const trailer = document.querySelector('#trailer')
const play = document.querySelector('.player .play')
play.addEventListener('click', async () => {
  trailer.controls = true
  player.classList.add('playing')
  try {
    await trailer.play()
    trailer.focus({ preventScroll: true })
  } catch {
    player.classList.remove('playing')
  }
})
trailer.addEventListener('ended', () => {
  trailer.controls = false
  player.classList.remove('playing')
})
document.querySelector('.film-link').addEventListener('click', () => {
  setTimeout(() => play.focus({ preventScroll: true }), 400)
})

// The speed clip: a muted loop in the page's appearance. Under reduced motion it waits as a poster with a Play button.
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const clip = document.querySelector('.speed-video')
const clipPlay = document.querySelector('.clip-play')
let clipTheme = null
function speedSource(dark) {
  const theme = dark ? 'dark' : 'light'
  if (theme === clipTheme) return
  clipTheme = theme
  const wasPlaying = !clip.paused
  clip.poster = clip.dataset[`poster${theme[0].toUpperCase()}${theme.slice(1)}`]
  // H.264 where it plays, the VP9 file otherwise.
  clip.src = clip.canPlayType('video/mp4') ? clip.dataset[theme] : clip.dataset[`${theme}Webm`]
  clip.load()
  if (wasPlaying || (!reduced.matches && clipSeen)) clip.play().catch(() => {})
}
let clipSeen = false
clipPlay.addEventListener('click', () => { clipPlay.hidden = true; clip.play().catch(() => {}) })
function clipMotion() {
  if (reduced.matches) { clip.pause(); clipPlay.hidden = false }
  else { clipPlay.hidden = true; if (clipSeen) clip.play().catch(() => {}) }
}
reduced.addEventListener('change', clipMotion)
new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) { clipSeen = true; if (!reduced.matches) clip.play().catch(() => {}) }
    else clip.pause()
  }
}, { threshold: 0.25 }).observe(clip)
clipMotion()
applyAppearance()

// One thing settles into place as it scrolls into view: the toast after Resolve. Reduced motion shows it at once.
const settling = document.querySelectorAll('.settle')
if (reduced.matches || !('IntersectionObserver' in window)) {
  for (const el of settling) el.classList.add('in')
} else {
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in')
      seen.unobserve(entry.target)
    }
  }, { threshold: 0.6 })
  for (const el of settling) seen.observe(el)
}
