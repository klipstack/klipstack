import AVFoundation
import ExpoModulesCore
import Speech

/// Dictating a note: the microphone, recognized on the device only (`Listener`), so what is said
/// never leaves the iPhone. The app writes what it hears into the note as it comes.
public class KlipDictationModule: Module {
  private var listener: Listener?

  public func definition() -> ModuleDefinition {
    Name("KlipDictation")

    Events("onText", "onEnd")

    /// Asks for permission the first time, then listens. Nil when listening, or why not:
    /// "denied" (no microphone or speech recognition), "unsupported" (the language, here) or
    /// "busy" (the microphone, in a call).
    AsyncFunction("start") { (language: String) async -> String? in
      guard await Self.allowed() else { return "denied" }
      return await MainActor.run { () -> String? in
        self.listener?.cancel()
        let listener = Listener(
          onText: { [weak self] text, final in
            self?.sendEvent("onText", ["text": text, "final": final])
          },
          onEnd: { [weak self] error in
            self?.sendEvent("onEnd", ["error": error])
          })
        guard let problem = listener.start(language: language) else {
          self.listener = listener
          return nil
        }
        return problem
      }
    }

    AsyncFunction("stop") { () async in
      await MainActor.run { self.listener?.finish() }
    }

    OnDestroy {
      Task { @MainActor [weak self] in self?.listener?.cancel() }
    }
  }

  private static func allowed() async -> Bool {
    let speech = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
    guard speech == .authorized else { return false }
    if #available(iOS 17.0, *) {
      return await AVAudioApplication.requestRecordPermission()
    }
    return await withCheckedContinuation { continuation in
      AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
    }
  }
}

/// One dictation: the microphone into Apple's speech recognizer, on the device, with punctuation.
/// `finish` stops the microphone and waits for the last, final text; `cancel` drops it.
@MainActor
final class Listener {
  private let engine = AVAudioEngine()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private let onText: (String, Bool) -> Void
  private let onEnd: (String?) -> Void
  private var finishing = false
  private var ended = false
  private var interruptions: NSObjectProtocol?
  /// The audio session as it was: reading aloud plays again as it did once dictation ends.
  private var before: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

  init(onText: @escaping (String, Bool) -> Void, onEnd: @escaping (String?) -> Void) {
    self.onText = onText
    self.onEnd = onEnd
  }

  /// Nil once listening; "unsupported" when this language can't be recognized on the device, "busy"
  /// when the microphone can't be had.
  func start(language: String) -> String? {
    guard let recognizer = Self.offlineRecognizer(for: language) else { return "unsupported" }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = true
    request.addsPunctuation = true
    request.taskHint = .dictation
    let session = AVAudioSession.sharedInstance()
    before = (session.category, session.mode, session.categoryOptions)
    do {
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      // No input format: the microphone is held elsewhere (a call). Tapping it would raise.
      guard format.sampleRate > 0, format.channelCount > 0 else {
        restoreSession()
        return "busy"
      }
      input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.feeding(request))
      engine.prepare()
      try engine.start()
    } catch {
      stopAudio()
      restoreSession()
      return "busy"
    }
    // A call or an alarm takes the microphone: what was heard so far stays.
    interruptions = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: .main,
      using: Self.interrupting(self))
    self.recognizer = recognizer
    self.request = request
    task = recognizer.recognitionTask(with: request, resultHandler: Self.results(to: self))
    return nil
  }

  // The microphone's buffers and the recognizer's results come on their own threads: their blocks
  // are made outside the main actor, so they don't inherit it.

  nonisolated private static func feeding(
    _ request: SFSpeechAudioBufferRecognitionRequest
  ) -> AVAudioNodeTapBlock {
    return { buffer, _ in request.append(buffer) }
  }

  nonisolated private static func results(
    to listener: Listener
  ) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
    return { [weak listener] result, error in
      let text = result?.bestTranscription.formattedString
      let final = result?.isFinal ?? false
      let failed = error?.localizedDescription
      let target = listener
      Task { @MainActor in target?.heard(text, final: final, error: failed) }
    }
  }

  nonisolated private static func interrupting(_ listener: Listener) -> @Sendable (Notification) -> Void {
    return { [weak listener] _ in
      let target = listener
      Task { @MainActor in target?.finish() }
    }
  }

  /// The language as given ("en-ES"), else the language alone ("en"): a region the recognizer
  /// doesn't pair with the language mustn't refuse it. Only one that works offline.
  private static func offlineRecognizer(for language: String) -> SFSpeechRecognizer? {
    let code = Locale(identifier: language).languageCode
    for identifier in [language, code].compactMap({ $0 }) {
      if let recognizer = SFSpeechRecognizer(locale: Locale(identifier: identifier)),
        recognizer.supportsOnDeviceRecognition, recognizer.isAvailable
      {
        return recognizer
      }
    }
    return nil
  }

  func finish() {
    guard !ended else { return }
    finishing = true
    stopAudio()
    request?.endAudio()
    // The final text normally comes at once; never leave the app waiting for it.
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 2_000_000_000)
      self?.end(error: nil)
    }
  }

  func cancel() {
    task?.cancel()
    end(error: nil)
  }

  private func heard(_ text: String?, final: Bool, error: String?) {
    guard !ended else { return }
    if let text { onText(text, final) }
    // Stopped by the reader, nothing more heard is no failure ("No speech detected").
    if final || error != nil { end(error: final || finishing ? nil : error) }
  }

  private func stopAudio() {
    // Also after an interruption, which stops the engine but leaves the tap.
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
  }

  private func restoreSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    if let before {
      try? session.setCategory(before.0, mode: before.1, options: before.2)
    }
    before = nil
  }

  private func end(error: String?) {
    guard !ended else { return }
    ended = true
    stopAudio()
    task = nil
    request = nil
    recognizer = nil
    if let interruptions { NotificationCenter.default.removeObserver(interruptions) }
    interruptions = nil
    restoreSession()
    onEnd(error)
  }
}
