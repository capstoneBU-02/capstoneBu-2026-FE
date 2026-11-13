import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSectionPlayer,
  playableRange,
  sectionPosition,
} from '../src/features/player/sectionPlayer.ts'

// A stand-in for AudioContext: time moves only when a test says so.
function fakeAudio() {
  const sources = []
  const gains = []
  const contexts = []
  function createContext() {
    const context = {
      currentTime: 0,
      state: 'suspended',
      destination: { name: 'destination' },
      resumes: 0,
      createGain() {
        const gain = {
          gain: {
            value: 1,
            targets: [],
            setTargetAtTime(value, when, constant) {
              gain.gain.targets.push([value, when, constant])
            },
          },
          connectedTo: null,
        }
        gain.connect = (target) => {
          gain.connectedTo = target
        }
        gains.push(gain)
        return gain
      },
      createBufferSource() {
        const node = {
          buffer: null,
          loop: false,
          loopStart: 0,
          loopEnd: 0,
          onended: null,
          started: null,
          stops: [],
          connectedTo: null,
          disconnected: false,
          connect(target) {
            node.connectedTo = target
          },
          disconnect() {
            node.disconnected = true
          },
          start(when, offset) {
            node.started = { when, offset }
          },
          stop(when = context.currentTime) {
            node.stops.push(when)
          },
        }
        sources.push(node)
        return node
      },
      resume() {
        context.resumes += 1
        context.state = 'running'
        return Promise.resolve()
      },
      close() {
        context.state = 'closed'
        return Promise.resolve()
      },
    }
    contexts.push(context)
    return context
  }
  return { createContext, sources, gains, contexts }
}

const buffer = { duration: 252 }

function setup({ repeat = true, range = { start: 10, end: 12 } } = {}) {
  const audio = fakeAudio()
  const stops = []
  const player = createSectionPlayer(buffer, {
    createContext: audio.createContext,
    onStop: () => stops.push('stop'),
    repeat,
    volume: 0.5,
  })
  player.setRange(range)
  return { ...audio, player, stops }
}

test('the position wraps inside the section only while repeating', () => {
  const range = { start: 10, end: 12 }
  assert.equal(sectionPosition(10.5, 1, range, true), 11.5)
  assert.equal(sectionPosition(10.5, 2, range, true), 10.5)
  assert.equal(sectionPosition(11, 5, range, true), 10)
  assert.equal(sectionPosition(10.5, 0, range, false), 10.5)
  assert.equal(sectionPosition(10.5, 9, range, false), 12)
})

test('nothing touches audio output before the first play', () => {
  const { player, contexts } = setup()
  assert.equal(contexts.length, 0)
  assert.equal(player.position(), 10)
  assert.equal(player.playing(), false)
  player.dispose()
  assert.equal(contexts.length, 0)
})

test('playing loops the section from its start', () => {
  const { player, contexts, sources, gains } = setup()
  player.play()
  const [context] = contexts
  const [source] = sources
  assert.equal(context.resumes, 1)
  assert.equal(source.buffer, buffer)
  assert.equal(source.loop, true)
  assert.equal(source.loopStart, 10)
  assert.equal(source.loopEnd, 12)
  assert.deepEqual(source.started, { when: 0, offset: 10 })
  assert.deepEqual(source.stops, [])
  assert.equal(source.connectedTo, gains[0])
  assert.equal(gains[0].connectedTo, context.destination)
  assert.equal(gains[0].gain.value, 0.5)
  assert.equal(player.playing(), true)

  context.currentTime = 3
  assert.equal(player.position(), 11)
})

test('without repeat the section plays once and comes back to its start', () => {
  const { player, contexts, sources, stops } = setup({ repeat: false })
  player.play()
  const [source] = sources
  assert.equal(source.loop, false)
  assert.deepEqual(source.stops, [2])

  contexts[0].currentTime = 2
  source.onended()
  assert.deepEqual(stops, ['stop'])
  assert.equal(player.playing(), false)
  assert.equal(player.position(), 10)
  assert.equal(source.disconnected, true)
})

test('pausing keeps the position and play resumes from it', () => {
  const { player, contexts, sources, stops } = setup()
  player.play()
  contexts[0].currentTime = 0.75
  player.pause()
  assert.equal(player.playing(), false)
  assert.equal(player.position(), 10.75)
  assert.deepEqual(sources[0].stops, [0.75])
  assert.equal(sources[0].onended, null)
  // A pause is the user's own; it is not reported as a stop.
  assert.deepEqual(stops, [])

  contexts[0].currentTime = 5
  player.play()
  assert.deepEqual(sources[1].started, { when: 5, offset: 10.75 })
  contexts[0].currentTime = 5.5
  assert.equal(player.position(), 11.25)
})

test('going back to the start works while playing and while paused', () => {
  const { player, contexts, sources } = setup()
  player.play()
  contexts[0].currentTime = 1
  player.restart()
  assert.equal(sources.length, 2)
  assert.deepEqual(sources[1].started, { when: 1, offset: 10 })
  assert.equal(player.position(), 10)

  contexts[0].currentTime = 1.5
  player.pause()
  assert.equal(player.position(), 10.5)
  player.restart()
  assert.equal(player.position(), 10)
  assert.equal(sources.length, 2)
})

test('a new range keeps playing when the position is still inside it', () => {
  const { player, contexts, sources } = setup({ repeat: false })
  player.play()
  contexts[0].currentTime = 1
  player.setRange({ start: 9, end: 15 })
  assert.equal(sources.length, 1)
  assert.equal(sources[0].loopStart, 9)
  assert.equal(sources[0].loopEnd, 15)
  // The end moved, so the scheduled stop moves with it.
  assert.deepEqual(sources[0].stops, [2, 5])
  contexts[0].currentTime = 2
  assert.equal(player.position(), 12)
})

test('a new range that leaves the position behind starts from its start', () => {
  const { player, contexts, sources } = setup()
  player.play()
  contexts[0].currentTime = 1.5
  player.setRange({ start: 20, end: 22 })
  assert.equal(sources.length, 2)
  assert.deepEqual(sources[0].stops, [1.5])
  assert.deepEqual(sources[1].started, { when: 1.5, offset: 20 })
  assert.equal(player.position(), 20)
})

test('losing the range stops playback and is reported', () => {
  const { player, sources, stops } = setup()
  player.play()
  player.setRange(null)
  assert.equal(player.playing(), false)
  assert.deepEqual(stops, ['stop'])
  assert.equal(sources[0].disconnected, true)
  player.play()
  assert.equal(sources.length, 1)
})

test('before the first play the player follows the section start', () => {
  const { player, sources } = setup()
  player.setRange({ start: 30, end: 40 })
  assert.equal(player.position(), 30)
  player.setRange({ start: 20, end: 40 })
  assert.equal(player.position(), 20)
  assert.equal(player.elapsed(), 0)
  player.play()
  assert.equal(sources[0].started.offset, 20)
})

test('a paused position stays inside a new range and resets outside it', () => {
  const { player, contexts } = setup({ range: { start: 10, end: 20 } })
  player.play()
  contexts[0].currentTime = 4
  player.pause()
  player.setRange({ start: 8, end: 20 })
  assert.equal(player.position(), 14)
  player.setRange({ start: 15, end: 20 })
  assert.equal(player.position(), 15)
  // Back at the start, it moves with the start again.
  player.setRange({ start: 12, end: 20 })
  assert.equal(player.position(), 12)
})

test('after going back or playing through, the start can still move', () => {
  const { player, contexts, sources } = setup({ repeat: false })
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  player.restart()
  player.setRange({ start: 8, end: 12 })
  assert.equal(player.position(), 8)

  player.play()
  contexts[0].currentTime = 5
  sources[1].onended()
  assert.equal(player.position(), 8)
  player.setRange({ start: 6, end: 12 })
  assert.equal(player.position(), 6)
})

test('the section never reaches past the decoded audio', () => {
  const { player, sources, stops } = setup({ range: { start: 250, end: 260 } })
  player.play()
  assert.equal(sources[0].loopEnd, 252)
  player.setRange({ start: 253, end: 260 })
  assert.equal(player.playing(), false)
  assert.deepEqual(stops, ['stop'])
})

test('the playable part of a section ends with the decoded audio', () => {
  assert.deepEqual(playableRange({ start: 10, end: 12 }, 252), {
    start: 10,
    end: 12,
  })
  assert.deepEqual(playableRange({ start: 245, end: 252.4 }, 250), {
    start: 245,
    end: 250,
  })
  assert.equal(playableRange({ start: 251, end: 252.4 }, 250), null)
  assert.equal(playableRange(null, 250), null)
})

test('a section that comes back resumes where playback stopped', () => {
  const { player, contexts } = setup({ range: { start: 10, end: 20 } })
  player.play()
  contexts[0].currentTime = 8
  player.setRange(null)
  assert.equal(player.position(), 18)
  player.setRange({ start: 10, end: 20 })
  assert.equal(player.position(), 18)
  player.setRange({ start: 10, end: 15 })
  assert.equal(player.position(), 10)
})

test('turning repeat on or off continues from the same position', () => {
  const { player, contexts, sources } = setup()
  player.play()
  contexts[0].currentTime = 0.5
  player.setRepeat(false)
  assert.equal(sources.length, 2)
  assert.equal(sources[1].loop, false)
  assert.deepEqual(sources[1].started, { when: 0.5, offset: 10.5 })
  assert.deepEqual(sources[1].stops, [2])
  player.setRepeat(true)
  assert.equal(sources[2].loop, true)
  assert.deepEqual(sources[2].stops, [])
})

test('volume applies before the output exists and glides after', () => {
  const { player, gains, contexts } = setup()
  player.setVolume(0.2)
  player.play()
  assert.equal(gains[0].gain.value, 0.2)
  contexts[0].currentTime = 3
  player.setVolume(0)
  // A jump in gain clicks; a short glide does not.
  assert.deepEqual(gains[0].gain.targets, [[0, 3, 0.015]])
})

test('disposing stops the sound and closes the output', () => {
  const { player, contexts, sources, stops } = setup()
  player.play()
  player.dispose()
  assert.equal(sources[0].disconnected, true)
  assert.equal(contexts[0].state, 'closed')
  assert.deepEqual(stops, [])
  player.play()
  assert.equal(sources.length, 1)
})

test('elapsed time counts from the section start', () => {
  const { player, contexts } = setup()
  assert.equal(player.elapsed(), 0)
  player.play()
  contexts[0].currentTime = 1.5
  assert.equal(player.elapsed(), 1.5)
  contexts[0].currentTime = 2.5
  assert.equal(player.elapsed(), 0.5)
  player.setRange(null)
  assert.equal(player.elapsed(), 0)
})

test('seeking while paused moves where play resumes', () => {
  const { player, contexts, sources } = setup()
  player.seek(1.25)
  assert.equal(player.position(), 11.25)
  assert.equal(player.elapsed(), 1.25)
  assert.equal(player.playing(), false)
  // Seeking alone opens no output.
  assert.equal(contexts.length, 0)
  player.play()
  assert.deepEqual(sources[0].started, { when: 0, offset: 11.25 })
})

test('seeking while playing continues from the new time', () => {
  const { player, contexts, sources, stops } = setup({ repeat: false })
  player.play()
  contexts[0].currentTime = 1
  player.seek(0.5)
  assert.equal(sources.length, 2)
  assert.deepEqual(sources[0].stops, [2, 1])
  assert.equal(sources[0].onended, null)
  assert.deepEqual(sources[1].started, { when: 1, offset: 10.5 })
  // Playing once, the new source still stops at the section end.
  assert.deepEqual(sources[1].stops, [2.5])
  assert.equal(player.playing(), true)
  assert.deepEqual(stops, [])
  contexts[0].currentTime = 1.25
  assert.equal(player.elapsed(), 0.75)
})

test('seeking stays inside the section', () => {
  const { player } = setup()
  player.seek(-3)
  assert.equal(player.position(), 10)
  player.seek(99)
  assert.ok(player.position() < 12)
  assert.ok(player.position() > 11.9)
})

test('seeking without a section or after disposing does nothing', () => {
  const { player, sources } = setup({ range: null })
  player.seek(1)
  assert.equal(player.elapsed(), 0)
  player.setRange({ start: 10, end: 12 })
  player.play()
  player.dispose()
  player.seek(1)
  assert.equal(sources.length, 1)
})

// The separated guitar covers the section alone, from 0 s.
const guitar = { duration: 2 }
const guitarRange = { start: 0, end: 2 }

test('switching audio while playing keeps the time and the output', () => {
  const { player, contexts, sources, stops } = setup()
  player.play()
  contexts[0].currentTime = 0.75
  player.switchAudio(guitar, guitarRange)
  assert.equal(contexts.length, 1)
  assert.equal(sources.length, 2)
  assert.equal(sources[0].disconnected, true)
  assert.equal(sources[0].onended, null)
  assert.equal(sources[1].buffer, guitar)
  assert.equal(sources[1].loopStart, 0)
  assert.equal(sources[1].loopEnd, 2)
  assert.deepEqual(sources[1].started, { when: 0.75, offset: 0.75 })
  assert.equal(player.playing(), true)
  assert.deepEqual(stops, [])
  contexts[0].currentTime = 1
  assert.equal(player.elapsed(), 1)
  assert.equal(player.position(), 1)
})

test('switching audio while paused keeps where play resumes', () => {
  const { player, contexts, sources } = setup()
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  player.switchAudio(guitar, guitarRange)
  assert.equal(sources.length, 1)
  assert.equal(player.playing(), false)
  assert.equal(player.position(), 0.5)
  player.play()
  assert.equal(sources[1].buffer, guitar)
  assert.deepEqual(sources[1].started, { when: 0.5, offset: 0.5 })
})

test('switching audio before the first play stays at the section start', () => {
  const { player, contexts } = setup()
  player.switchAudio(guitar, guitarRange)
  assert.equal(player.position(), 0)
  assert.equal(player.elapsed(), 0)
  assert.equal(contexts.length, 0)
  // Back on the first audio, the start follows its section again.
  player.switchAudio(buffer, { start: 10, end: 12 })
  assert.equal(player.position(), 10)
})

test('switching to audio that ends sooner starts it from the section start', () => {
  const { player, contexts, sources } = setup({
    range: { start: 10, end: 20 },
  })
  player.play()
  contexts[0].currentTime = 5
  player.switchAudio(guitar, { start: 0, end: 10 })
  assert.deepEqual(sources[1].started, { when: 5, offset: 0 })
  assert.equal(sources[1].loopEnd, 2)

  contexts[0].currentTime = 6.5
  player.pause()
  player.switchAudio(buffer, { start: 10, end: 20 })
  assert.equal(player.position(), 11.5)
})

test('switching audio while playing once keeps the section end', () => {
  const { player, contexts, sources } = setup({ repeat: false })
  player.play()
  contexts[0].currentTime = 0.75
  player.switchAudio(guitar, guitarRange)
  assert.equal(sources[1].loop, false)
  assert.deepEqual(sources[1].stops, [2])
})

test('switching to audio without the section stops and is reported', () => {
  const { player, sources, stops } = setup()
  player.play()
  player.switchAudio({ duration: 0 }, guitarRange)
  assert.equal(player.playing(), false)
  assert.deepEqual(stops, ['stop'])
  assert.equal(sources[0].disconnected, true)
  player.play()
  assert.equal(sources.length, 1)
})

test('switching audio after disposing does nothing', () => {
  const { player, sources } = setup()
  player.play()
  player.dispose()
  player.switchAudio(guitar, guitarRange)
  player.play()
  assert.equal(sources.length, 1)
})
