import AVFoundation
import MediaPlayer
import os

/// Reads a list of sentences aloud. It renders a few sentences ahead of what plays, plays them
/// through AVAudioEngine (speed changes keep the pitch), says which sentence is being read, and
/// answers the lock screen, AirPods and Control Center. Keeps playing with the screen locked (the
/// app has the audio background mode); the model runs on the CPU, which iOS allows there.
@MainActor
final class Narrator {
  static let shared = Narrator()

  struct Script {
    let sentences: [String]
    /// Silence after each sentence, in seconds: longer at the end of a paragraph.
    let pauses: [Double]
    let language: KokoroFrontend.Language
    let voice: String
    let title: String
    let artist: String
  }

  enum State: String {
    case idle, loading, playing, paused, ended
  }

  var onSentence: ((Int) -> Void)?
  var onState: ((State, String?) -> Void)?

  private(set) var state: State = .idle
  private(set) var current: Int?

  private let engine = SpeechEngine()
  private let audio = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let pitch = AVAudioUnitTimePitch()
  private let format = AVAudioFormat(standardFormatWithSampleRate: KokoroModel.sampleRate, channels: 1)!
  private var configured = false
  private var script: Script?
  /// Characters before each sentence: the lock screen's timeline, estimated from them.
  private var offsets: [Int] = []
  private var rate: Float = 1
  /// Bumped on every start, seek and stop: callbacks from older audio are ignored.
  private var generation = 0
  private var next = 0
  /// Sentences scheduled to play, in order; the first is playing.
  private var queued: [Int] = []
  private var rendered = false
  private var rendering: Task<Void, Never>?
  private var room: CheckedContinuation<Void, Never>?
  private var interrupted = false
  /// Sentences rendered ahead of the one playing.
  private let ahead = 3
  /// Kokoro reads about 17 characters a second at 1×.
  private let charactersPerSecond = 17.0
  private let log = Logger(subsystem: "com.klipstack.speech", category: "Narrator")

  // MARK: - Controls

  func speak(_ script: Script, from index: Int, rate: Float) async throws {
    stopPlayback()
    let run = generation
    self.script = script
    offsets = script.sentences.reduce(into: [0]) { $0.append($0.last! + $1.count) }
    setRate(rate)
    try configure()
    set(.loading)
    do {
      try await engine.prepare(language: script.language, voice: script.voice)
    } catch {
      // Stopped while it loaded: the stop has said all there is to say.
      guard run == generation else { return }
      set(.idle, error.localizedDescription)
      throw error
    }
    // Stopped, or moved elsewhere, while the model loaded (a few seconds the first time): nothing
    // starts behind the reader's back.
    guard run == generation else { return }
    let paused = state == .paused
    start(at: min(max(index, 0), script.sentences.count - 1))
    // Paused while it loaded: ready, waiting for play.
    if paused { pause() }
  }

  func pause() {
    guard state == .playing || state == .loading else { return }
    player.pause()
    set(.paused)
  }

  func resume() {
    guard state == .paused || state == .ended, script != nil else { return }
    if state == .ended {
      start(at: 0)
      return
    }
    guard startAudio() else { return }
    player.play()
    set(queued.isEmpty ? .loading : .playing)
  }

  func seek(to index: Int) {
    guard let script else { return }
    start(at: min(max(index, 0), script.sentences.count - 1))
  }

  func skip(_ by: Int) {
    seek(to: (current ?? next) + by)
  }

  func setRate(_ value: Float) {
    rate = min(max(value, 0.5), 2)
    pitch.rate = rate
    updateNowPlaying()
  }

  func stop() {
    stopPlayback()
    script = nil
    current = nil
    audio.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    set(.idle)
    Task { await engine.unload() }
  }

  // MARK: - Rendering and playing

  private func start(at index: Int) {
    stopPlayback()
    let run = generation
    next = index
    guard startAudio() else { return }
    player.play()
    set(.loading)
    rendering = Task { await fill(run) }
  }

  /// The player can't play while the engine is stopped: it would raise an exception.
  private func startAudio() -> Bool {
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      if !audio.isRunning { try audio.start() }
      return true
    } catch {
      set(.idle, error.localizedDescription)
      return false
    }
  }

  /// Ends what plays and what renders; the script stays.
  private func stopPlayback() {
    generation += 1
    rendering?.cancel()
    rendering = nil
    // Its buffers' completion handlers run now, for an old generation: ignored.
    if configured { player.stop() }
    queued = []
    rendered = false
    openRoom()
  }

  private func fill(_ run: Int) async {
    guard let script else { return }
    while run == generation, next < script.sentences.count {
      if queued.count >= ahead {
        await withCheckedContinuation { room = $0 }
        continue
      }
      let index = next
      next += 1
      let samples: [Float]
      let began = Date()
      do {
        samples = try await engine.render(
          script.sentences[index], language: script.language, voice: script.voice)
        // How much faster than real time the phone renders: under 1 and reading stalls.
        let seconds = Double(samples.count) / KokoroModel.sampleRate
        let took = Date().timeIntervalSince(began)
        log.info(
          "Sentence \(index): \(seconds, format: .fixed(precision: 1)) s in \(took, format: .fixed(precision: 2)) s, \(seconds / max(took, 0.001), format: .fixed(precision: 1))× real time"
        )
      } catch {
        if run == generation, !(error is CancellationError) { set(.idle, error.localizedDescription) }
        return
      }
      guard run == generation else { return }
      if samples.isEmpty { continue }
      schedule(samples, pause: script.pauses[safe: index] ?? 0.3, index: index, run: run)
    }
    guard run == generation else { return }
    rendered = true
    if queued.isEmpty { finish() }
  }

  private func schedule(_ samples: [Float], pause: Double, index: Int, run: Int) {
    let silence = Int(pause * KokoroModel.sampleRate)
    let frames = AVAudioFrameCount(samples.count + silence)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
      let channel = buffer.floatChannelData?[0]
    else { return }
    buffer.frameLength = frames
    samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: samples.count) }
    (channel + samples.count).update(repeating: 0, count: silence)
    let wasEmpty = queued.isEmpty
    queued.append(index)
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      Task { @MainActor in self?.played(index, run: run) }
    }
    if wasEmpty { reading(index) }
  }

  private func played(_ index: Int, run: Int) {
    guard run == generation, queued.first == index else { return }
    queued.removeFirst()
    openRoom()
    if let upcoming = queued.first {
      reading(upcoming)
    } else if rendered {
      finish()
    } else if state == .playing {
      // Rendering fell behind: the next sentence plays when it's ready.
      set(.loading)
    }
  }

  private func reading(_ index: Int) {
    current = index
    onSentence?(index)
    if state == .loading { set(.playing) } else { updateNowPlaying() }
  }

  private func finish() {
    current = nil
    set(.ended)
  }

  private func openRoom() {
    room?.resume()
    room = nil
  }

  private func set(_ new: State, _ error: String? = nil) {
    state = new
    onState?(new, error)
    updateNowPlaying()
  }

  // MARK: - Audio session, lock screen

  private func configure() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .spokenAudio)
    try session.setActive(true)
    guard !configured else { return }
    configured = true
    audio.attach(player)
    audio.attach(pitch)
    audio.connect(player, to: pitch, format: format)
    audio.connect(pitch, to: audio.mainMixerNode, format: format)
    audio.prepare()

    let center = NotificationCenter.default
    center.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: .main
    ) { note in
      let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
        .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
      let options = AVAudioSession.InterruptionOptions(
        rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
      MainActor.assumeIsolated { self.interruption(type, resume: options.contains(.shouldResume)) }
    }
    center.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
    ) { note in
      let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
        .flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
      // Headphones unplugged: stop talking out loud.
      if reason == .oldDeviceUnavailable { MainActor.assumeIsolated { self.pause() } }
    }
    center.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main
    ) { _ in
      MainActor.assumeIsolated {
        guard self.state == .playing || self.state == .loading, self.startAudio() else { return }
        self.player.play()
      }
    }

    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.addTarget { _ in
      MainActor.assumeIsolated { self.resume() }
      return .success
    }
    commands.pauseCommand.addTarget { _ in
      MainActor.assumeIsolated { self.pause() }
      return .success
    }
    commands.togglePlayPauseCommand.addTarget { _ in
      MainActor.assumeIsolated { self.state == .paused ? self.resume() : self.pause() }
      return .success
    }
    commands.nextTrackCommand.addTarget { _ in
      MainActor.assumeIsolated { self.skip(1) }
      return .success
    }
    commands.previousTrackCommand.addTarget { _ in
      MainActor.assumeIsolated { self.skip(-1) }
      return .success
    }
    // Dragging the lock screen's timeline: to the sentence at that point.
    commands.changePlaybackPositionCommand.addTarget { event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      MainActor.assumeIsolated { self.seek(toTime: event.positionTime) }
      return .success
    }
  }

  private func interruption(_ type: AVAudioSession.InterruptionType?, resume: Bool) {
    if type == .began, state == .playing || state == .loading {
      interrupted = true
      pause()
    } else if type == .ended, interrupted {
      interrupted = false
      if resume { self.resume() }
    }
  }

  private func seek(toTime seconds: TimeInterval) {
    let characters = Int(seconds * charactersPerSecond)
    let index = (offsets.lastIndex { $0 <= characters } ?? 0)
    seek(to: min(index, (script?.sentences.count ?? 1) - 1))
  }

  private func updateNowPlaying() {
    guard let script, state != .idle else { return }
    let at = offsets[safe: current ?? next] ?? 0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: script.title,
      MPMediaItemPropertyArtist: script.artist,
      MPMediaItemPropertyPlaybackDuration: Double(offsets.last ?? 0) / charactersPerSecond,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(at) / charactersPerSecond,
      MPNowPlayingInfoPropertyPlaybackRate: state == .playing ? Double(rate) : 0,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
