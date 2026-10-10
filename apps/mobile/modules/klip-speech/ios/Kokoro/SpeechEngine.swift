import Foundation

/// Text in, samples out. Loads the model, a language's dictionaries and a voice on first use and
/// keeps them. The model runs on a queue of its own: it holds a thread for up to a second or two.
actor SpeechEngine {
  private let queue = DispatchQueue(label: "com.klipstack.speech.kokoro", qos: .userInitiated)
  private var vocab: KokoroAneVocab?
  private var model: KokoroModel?
  private var frontends: [KokoroFrontend.Language: KokoroFrontend] = [:]
  private var voices: [String: VoicePack] = [:]
  /// Bumped by `unload`: a load still running then doesn't keep what it loaded.
  private var epoch = 0

  /// Loads what `language` and `voice` need, so the first sentence doesn't wait for it.
  func prepare(language: KokoroFrontend.Language, voice: String) async throws {
    _ = try await frontend(language)
    _ = try await pack(voice)
    _ = try await kokoro()
  }

  /// `text` spoken, at Kokoro's normal speed; empty when there's nothing in it to say.
  func render(_ text: String, language: KokoroFrontend.Language, voice: String) async throws
    -> [Float]
  {
    let pieces = try await frontend(language).phonemes(for: text)
    guard !pieces.isEmpty else { return [] }
    let model = try await kokoro()
    let style = try await pack(voice)
    var samples: [Float] = []
    for piece in pieces {
      try Task.checkCancellation()
      samples += try await run { try model.speak(piece, voice: style) }
    }
    return samples
  }

  /// Frees the model and dictionaries (hundreds of MB); the next sentence loads them again.
  func unload() {
    epoch += 1
    model = nil
    frontends = [:]
    voices = [:]
  }

  /// What a load made, unless `unload` ran while it did (this actor takes other calls during an
  /// await): then it goes, and the caller learns the load was cancelled.
  private func keep<T>(_ value: T, loadedIn started: Int) throws -> T {
    guard started == epoch else { throw CancellationError() }
    return value
  }

  private func run<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { continuation.resume(with: Result { try work() }) }
    }
  }

  private func loadVocab() throws -> KokoroAneVocab {
    if let vocab { return vocab }
    let json = try JSONSerialization.jsonObject(
      with: Data(contentsOf: SpeechFiles.bundled("vocab.json")))
    guard let entries = json as? [String: Int] else {
      throw TTSError.processingFailed("Unreadable vocab.json")
    }
    var map: [Character: Int32] = [:]
    for (key, id) in entries where key.count == 1 { map[key.first!] = Int32(id) }
    let loaded = KokoroAneVocab(map: map)
    vocab = loaded
    return loaded
  }

  private func kokoro() async throws -> KokoroModel {
    if let model { return model }
    let started = epoch
    let vocab = try loadVocab()
    let url = try SpeechFiles.local(SpeechFiles.model)
    let made = try await run { try KokoroModel(model: url, vocab: vocab) }
    let loaded = try keep(made, loadedIn: started)
    model = loaded
    return loaded
  }

  private func frontend(_ language: KokoroFrontend.Language) async throws -> KokoroFrontend {
    if let frontend = frontends[language] { return frontend }
    let started = epoch
    let vocab = try loadVocab()
    let lexicon = try SpeechFiles.local(SpeechFiles.lexicon(language))
    let english = language == .english
    let names = english ? try SpeechFiles.local(SpeechFiles.cmudict) : nil
    let g2p = english ? try SpeechFiles.local(SpeechFiles.g2pCheckpoint) : nil
    let made = try await run {
      try KokoroFrontend(language: language, vocab: vocab, lexicon: lexicon, names: names, g2p: g2p)
    }
    let loaded = try keep(made, loadedIn: started)
    frontends[language] = loaded
    return loaded
  }

  private func pack(_ id: String) async throws -> VoicePack {
    if let voice = voices[id] { return voice }
    let loaded = try VoicePack(url: SpeechFiles.local(SpeechFiles.voice(id)))
    voices[id] = loaded
    return loaded
  }
}
