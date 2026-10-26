class TranslatorAudio extends AudioWorkletProcessor {
  samples = []
  phase = 0
  total = 0
  count = 0

  stopped = false

  constructor() {
    super()
    this.port.onmessage = () => {
      this.stopped = true
      this.flush()
      this.port.postMessage('flushed')
    }
  }

  flush = () => {
    if (this.samples.length > 0) {
      const buffer = new ArrayBuffer(this.samples.length * 2)
      const view = new DataView(buffer)
      for (let n = 0; n < this.samples.length; ++n) {
        view.setInt16(n * 2, this.samples[n], true)
      }
      this.port.postMessage(buffer, [buffer])
      this.samples = []
    }
  }

  process(inputs) {
    if (this.stopped) {
      return false
    }
    const channel = inputs[0]?.[0]
    if (!channel) {
      return true
    }
    for (let n = 0; n < channel.length; ++n) {
      this.total += channel[n]
      ++this.count
      this.phase += 16000
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate
        const value = Math.max(-1, Math.min(1, this.total / this.count))
        this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)))
        this.total = 0
        this.count = 0
        if (this.samples.length === 1600) {
          this.flush()
        }
      }
    }
    return true
  }
}

registerProcessor('translator-audio', TranslatorAudio)
