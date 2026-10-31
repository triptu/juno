// The features section: pointing at a label, or tapping it, lights up where that thing lives in the window and shows
// its line underneath. A thing the window does not show opens a small crop over it instead. Nothing here runs in a
// loop; each change sets a few CSS variables and a class, and the stylesheet moves the spot.
(() => {
  const section = document.querySelector('.features')
  if (!section) return
  const frame = section.querySelector('.window')
  const spot = section.querySelector('.spot')
  const inset = section.querySelector('.inset')
  const [insetLight, insetDark] = inset.querySelectorAll('img')
  const caption = section.querySelector('.feature-caption')
  const idle = caption.textContent
  const buttons = [...section.querySelectorAll('.feature')]
  let shown = null
  let held = null

  function show(button) {
    shown = button
    const area = button.dataset.spot
    if (area) {
      const [x, y, w, h] = area.split(' ')
      spot.style.setProperty('--x', x)
      spot.style.setProperty('--y', y)
      spot.style.setProperty('--w', w)
      spot.style.setProperty('--h', h)
      frame.classList.remove('whole')
    } else {
      insetLight.src = `/img/inset-${button.dataset.inset}-light.webp`
      insetDark.src = `/img/inset-${button.dataset.inset}-dark.webp`
      frame.classList.add('whole')
    }
    frame.classList.add('lit')
    caption.textContent = button.querySelector('.sr').textContent.trim()
  }
  function hide() {
    if (held) { show(held); return }
    shown = null
    frame.classList.remove('lit')
    caption.textContent = idle
  }
  function hold(button) {
    held = held === button ? null : button
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === held))
    if (held) show(held)
    else hide()
  }

  // A touch holds on release; the click that may follow is the same tap. Mouse and keyboard hold on click.
  let tapped = 0
  for (const button of buttons) {
    button.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') show(button) })
    button.addEventListener('focus', () => show(button))
    button.addEventListener('blur', () => { if (shown === button) hide() })
    button.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { tapped = performance.now(); hold(button) } })
    button.addEventListener('click', () => { if (performance.now() - tapped < 700) return; hold(button) })
  }
  section.querySelector('.feature-list').addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide() })
  frame.addEventListener('click', () => { if (held) hold(held) })
})()
