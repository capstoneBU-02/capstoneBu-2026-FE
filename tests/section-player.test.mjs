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

function setup({
  repeat = true,
  range = { start: 10, end: 12 },
  onChange,
} = {}) {
  const audio = fakeAudio()
  const stops = []
  const errors = []
  const diagnostics = []
  const player = createSectionPlayer(buffer, {
    createContext: audio.createContext,
    onStop: () => stops.push('stop'),
    onError: (diagnostic) => {
      errors.push('error')
      diagnostics.push(diagnostic)
    },
    onChange,
    repeat,
    volume: 0.5,
  })
  player.setRange(range)
  return { ...audio, player, stops, errors, diagnostics }
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

// Resume settles after the user's next action in these output-failure cases.
function holdResume(context) {
  context.state = 'suspended'
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = () => {
      context.state = 'running'
      yes()
    }
    reject = () => no(new Error('Output unavailable'))
  })
  context.resume = () => promise
  return { resolve, reject }
}
const settleOutput = () => new Promise((resolve) => setImmediate(resolve))

test('a rejected output resume stops its source and can be retried at the same position', async () => {
  const { player, contexts, sources, errors } = setup()
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  const held = holdResume(contexts[0])
  player.play()
  held.reject()
  await settleOutput()
  assert.equal(player.playing(), false)
  assert.equal(player.position(), 10.5)
  assert.equal(sources[1].disconnected, true)
  assert.equal(sources[1].onended, null)
  assert.deepEqual(errors, ['error'])
  contexts[0].resume = () => {
    contexts[0].state = 'running'
    return Promise.resolve()
  }
  player.play()
  assert.equal(player.playing(), true)
  assert.equal(sources[2].started.offset, 10.5)
})

for (const action of [
  'pause',
  'dispose',
  'switch',
  'range',
  'seek',
  'restart',
  'repeat',
]) {
  test(`an old resume rejection after ${action} leaves the newer playback alone`, async () => {
    const { player, contexts, sources, errors } = setup()
    player.play()
    player.pause()
    const held = holdResume(contexts[0])
    player.play()
    const oldSource = sources.at(-1)
    // New sources can resume independently from the older pending request.
    contexts[0].resume = () => {
      contexts[0].state = 'running'
      return Promise.resolve()
    }
    switch (action) {
      case 'pause':
        player.pause()
        break
      case 'dispose':
        player.dispose()
        break
      case 'switch':
        player.switchAudio(guitar, guitarRange)
        break
      case 'range':
        player.setRange({ start: 20, end: 25 })
        break
      case 'seek':
        player.seek(0.5)
        break
      case 'restart':
        player.restart()
        break
      case 'repeat':
        player.setRepeat(false)
        break
    }
    const playing = player.playing()
    const latest = sources.at(-1)
    held.reject()
    await settleOutput()
    assert.equal(player.playing(), playing)
    assert.equal(oldSource.disconnected, true)
    if (playing) assert.equal(latest.disconnected, false)
    assert.deepEqual(errors, [])
  })
}

test('resuming after a pause never restarts the stopped source', async () => {
  const { player, contexts, sources, errors } = setup()
  player.play()
  player.pause()
  const held = holdResume(contexts[0])
  player.play()
  player.pause()
  held.resolve()
  await settleOutput()
  assert.equal(player.playing(), false)
  assert.equal(sources.at(-1).disconnected, true)
  assert.equal(sources.length, 2)
  assert.deepEqual(errors, [])
})

test('output creation and source start failures are reported and allow retry', () => {
  const audio = fakeAudio()
  const errors = []
  let broken = true
  const player = createSectionPlayer(buffer, {
    createContext() {
      if (broken) throw new Error('Output unavailable')
      return audio.createContext()
    },
    onStop() {},
    onError: () => errors.push('error'),
    repeat: true,
    volume: 0.5,
  })
  player.setRange({ start: 10, end: 12 })
  assert.doesNotThrow(() => player.play())
  assert.equal(player.playing(), false)
  assert.deepEqual(errors, ['error'])
  broken = false
  player.play()
  player.pause()
  const context = audio.contexts[0]
  const create = context.createBufferSource
  context.createBufferSource = () => {
    const node = create()
    node.start = () => {
      throw new Error('Cannot start output')
    }
    return node
  }
  assert.doesNotThrow(() => player.play())
  assert.equal(player.playing(), false)
  assert.equal(audio.sources.at(-1).disconnected, true)
  assert.deepEqual(errors, ['error', 'error'])
  context.createBufferSource = create
  player.play()
  assert.equal(player.playing(), true)
})

test('a rejection after seeking while the resume is pending keeps the sought position', async () => {
  const { player, contexts, sources, errors } = setup()
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  const held = holdResume(contexts[0])
  player.play()
  player.seek(1.5)
  held.reject()
  await settleOutput()
  assert.equal(player.playing(), false)
  assert.deepEqual(errors, ['error'])
  assert.equal(player.position(), 11.5)
  contexts[0].resume = () => {
    contexts[0].state = 'running'
    return Promise.resolve()
  }
  player.play()
  assert.equal(sources.at(-1).started.offset, 11.5)
})

test('a source that cannot start after a seek keeps the sought position', () => {
  const { player, contexts, sources, errors } = setup()
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  player.play()
  const create = contexts[0].createBufferSource
  contexts[0].createBufferSource = () => {
    const node = create()
    node.start = () => {
      throw new Error('Cannot start output')
    }
    return node
  }
  player.seek(1.5)
  assert.equal(player.playing(), false)
  assert.deepEqual(errors, ['error'])
  assert.equal(player.position(), 11.5)
  contexts[0].createBufferSource = create
  player.play()
  assert.equal(sources.at(-1).started.offset, 11.5)
})

test('a pending resume is observable and cancellation keeps the position', async () => {
  const changes = []
  const state = setup({ onChange: () => changes.push(state.player.pending()) })
  const { player, contexts } = state
  player.play()
  contexts[0].currentTime = 0.5
  player.pause()
  const held = holdResume(contexts[0])
  changes.length = 0
  player.play()
  assert.equal(player.pending(), true)
  assert.equal(changes.at(-1), true)
  player.pause()
  assert.equal(player.pending(), false)
  assert.equal(player.position(), 10.5)
  const count = changes.length
  held.resolve()
  await settleOutput()
  assert.equal(changes.length, count)
  assert.equal(player.playing(), false)
})

test('successful resume reports the end of the pending state', async () => {
  const changes = []
  const state = setup({ onChange: () => changes.push(state.player.pending()) })
  const { player, contexts } = state
  player.play()
  player.pause()
  const held = holdResume(contexts[0])
  player.play()
  assert.equal(player.pending(), true)
  held.resolve()
  await settleOutput()
  assert.equal(player.pending(), false)
  assert.equal(player.playing(), true)
  assert.equal(changes.at(-1), false)
})

for (const success of [true, false]) {
  test(`a retired resume (${success}) cannot settle the new pending attempt`, async () => {
    const { player, contexts, errors } = setup()
    player.play()
    player.pause()
    const first = holdResume(contexts[0])
    player.play()
    player.pause()
    const second = holdResume(contexts[0])
    player.play()
    first[success ? 'resolve' : 'reject']()
    await settleOutput()
    assert.equal(player.pending(), true)
    assert.deepEqual(errors, [])
    second.resolve()
    await settleOutput()
    assert.equal(player.pending(), false)
    assert.equal(player.playing(), true)
  })
}

test('a failed resume reports only its stage and classified reason', async () => {
  const { player, contexts, diagnostics } = setup()
  player.play()
  player.pause()
  contexts[0].state = 'suspended'
  contexts[0].resume = () =>
    Promise.reject(
      new DOMException(
        'private-song.mp3 https://private.invalid',
        'NotAllowedError',
      ),
    )
  player.play()
  await settleOutput()
  assert.deepEqual(diagnostics, [
    { stage: 'resume', reason: 'NotAllowedError' },
  ])
  assert.equal(player.pending(), false)
})

for (const stage of ['context', 'source', 'start', 'resume']) {
  test(`a synchronous ${stage} failure is classified without its private message`, () => {
    const audio = fakeAudio()
    const diagnostics = []
    const failure = new TypeError('private-song.mp3 https://private.invalid')
    const player = createSectionPlayer(buffer, {
      createContext() {
        if (stage === 'context') throw failure
        const context = audio.createContext()
        const create = context.createBufferSource
        context.createBufferSource = () => {
          if (stage === 'source') throw failure
          const node = create()
          if (stage === 'start')
            node.start = () => {
              throw failure
            }
          return node
        }
        if (stage === 'resume')
          context.resume = () => {
            throw failure
          }
        return context
      },
      onStop() {},
      onError: (diagnostic) => diagnostics.push(diagnostic),
      repeat: true,
      volume: 0.5,
    })
    player.setRange({ start: 10, end: 12 })
    player.play()
    assert.deepEqual(diagnostics, [{ stage, reason: 'TypeError' }])
    assert.equal(player.playing(), false)
    assert.equal(player.pending(), false)
  })
}

for (const failure of [
  new Error('private-song.mp3'),
  { name: 'private-song.mp3', message: 'private' },
  Object.defineProperty(new Error(), 'name', {
    get() {
      throw new Error('private')
    },
  }),
]) {
  test('unclassified output errors do not expose arbitrary names or break recovery', () => {
    const diagnostics = []
    const player = createSectionPlayer(buffer, {
      createContext() {
        throw failure
      },
      onStop() {},
      onError: (diagnostic) => diagnostics.push(diagnostic),
      repeat: true,
      volume: 0.5,
    })
    player.setRange({ start: 10, end: 12 })
    assert.doesNotThrow(() => player.play())
    assert.deepEqual(diagnostics, [{ stage: 'context', reason: 'unknown' }])
  })
}
