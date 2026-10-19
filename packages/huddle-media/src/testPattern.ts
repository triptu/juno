/**
 * A drawn screen for the fake's shares: colour bars, the owner's name and a
 * block that moves, so the video keeps sending frames. 15 frames a second,
 * as Slack caps a shared screen. Browser only (a canvas and `captureStream`).
 */
const WIDTH = 1280
const HEIGHT = 800
const FPS = 15
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']

export interface TestPattern {
  readonly stream: MediaStream
  stop(): void
}

export function createTestPattern(label: string): TestPattern {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  let frame = 0
  const draw = () => {
    if (context === null) return
    const bar = WIDTH / BARS.length
    BARS.forEach((colour, i) => {
      context.fillStyle = colour
      context.fillRect(i * bar, 0, bar, HEIGHT * 0.7)
    })
    context.fillStyle = '#202020'
    context.fillRect(0, HEIGHT * 0.7, WIDTH, HEIGHT * 0.3)
    context.fillStyle = '#ffffff'
    context.fillRect((frame * 8) % WIDTH, HEIGHT * 0.75, 80, 80)
    context.font = '48px sans-serif'
    context.fillText(label, 40, HEIGHT * 0.95)
    frame++
  }
  draw()
  const timer = setInterval(draw, 1000 / FPS)
  const stream = canvas.captureStream(FPS)
  return {
    stream,
    stop: () => {
      clearInterval(timer)
      for (const track of stream.getTracks()) track.stop()
    },
  }
}
