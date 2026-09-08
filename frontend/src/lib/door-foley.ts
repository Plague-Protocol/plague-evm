/**
 * door-foley.ts — the footsteps and door impact under the ArenaDoors entrance.
 *
 * SYNTHESISED, NOT SAMPLED — on purpose. The alternative was shipping two more
 * MP3s next to the eight already in public/sounds, and this beat plays on EVERY
 * room entry: the audience is MiniPay users on metered mobile data, so a
 * recurring download for a half-second thud is the wrong trade. WebAudio gives
 * a serviceable footstep from a noise burst and a bandpass filter for 0 bytes.
 *
 * Everything here is best-effort. A suspended context, a browser with no
 * WebAudio, an autoplay policy that refuses to resume — all of it degrades to
 * silence and never to a thrown error, because this is decoration on top of an
 * animation that has to keep running regardless.
 */

type Ctor = typeof AudioContext
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const C: Ctor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
  if (!C) return null
  try { ctx = new C() } catch { return null }
  return ctx
}

/** Short filtered-noise burst — the body of a footfall on concrete. */
function thud(at: number, gain: number, freq: number, decay: number): void {
  const c = audio()
  if (!c) return
  const frames = Math.max(1, Math.floor(c.sampleRate * decay))
  const buf = c.createBuffer(1, frames, c.sampleRate)
  const data = buf.getChannelData(0)
  // Noise shaped by an exponential decay envelope — cheap, and the decay is
  // what makes it read as an impact rather than a hiss.
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3)
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.1
  const amp = c.createGain()
  amp.gain.value = gain
  src.connect(filter).connect(amp).connect(c.destination)
  src.start(at)
  src.stop(at + decay)
}

async function resume(): Promise<boolean> {
  const c = audio()
  if (!c) return false
  if (c.state === 'suspended') {
    try { await c.resume() } catch { return false }
  }
  return c.state === 'running'
}

/**
 * Footsteps closing on the door — `count` falls with a slight accelerando, so
 * it reads as someone running toward you rather than a metronome.
 */
export async function playFootsteps(count = 5, volume = 0.22): Promise<void> {
  if (volume <= 0) return
  if (!(await resume())) return
  const c = audio()
  if (!c) return
  let t = c.currentTime
  let gap = 0.19
  for (let i = 0; i < count; i++) {
    // Alternating pitch gives left/right feet instead of one foot hopping.
    thud(t, volume * (i % 2 ? 0.82 : 1), i % 2 ? 190 : 145, 0.1)
    t += gap
    gap *= 0.93
  }
}

/**
 * The doors reaching the end of their swing: the low boom of mass stopping,
 * then the latch hardware clanking a beat later.
 *
 * Not a closing slam — ArenaDoors opens its doors and leaves them open, so a
 * bolt throwing shut would be a sound with no picture behind it.
 */
export async function playDoorStop(volume = 0.3): Promise<void> {
  if (volume <= 0) return
  if (!(await resume())) return
  const c = audio()
  if (!c) return
  const t = c.currentTime
  thud(t, volume, 80, 0.26)                // boom — the doors meeting their stops
  thud(t + 0.13, volume * 0.7, 2400, 0.05) // latch — bright, metallic, short
}
