import ExpoModulesCore

/// Reading aloud, on the device (see `Narrator` and `SpeechEngine`), and the voice downloads it
/// needs. The app gives it the article's sentences; it tells the app which one is being read.
public class KlipSpeechModule: Module {
  private let downloader = Downloader()

  public func definition() -> ModuleDefinition {
    Name("KlipSpeech")

    Events("onSentence", "onState", "onDownload")

    OnCreate {
      Task { @MainActor [weak self] in
        Narrator.shared.onSentence = { index in self?.sendEvent("onSentence", ["index": index]) }
        Narrator.shared.onState = { state, error in
          self?.sendEvent("onState", ["state": state.rawValue, "error": error])
        }
      }
    }

    /// Each language: whether its files are here, how many bytes are missing, its voices.
    AsyncFunction("languages") { () -> [[String: Any]] in
      [KokoroFrontend.Language.english, .spanish].map { language in
        let files = SpeechFiles.pack(language)
        let missing = Downloader.missing(files)
        return [
          "language": language.rawValue,
          "installed": missing == 0,
          "missingBytes": missing,
          "totalBytes": files.reduce(0) { $0 + $1.bytes },
          "voices": Voices.all(language).map { ["id": $0.id, "name": $0.name] },
        ]
      }
    }

    AsyncFunction("download") { (code: String) async throws in
      let language = try Self.language(code)
      try await self.downloader.download(SpeechFiles.pack(language)) { [weak self] received, total in
        self?.sendEvent(
          "onDownload", ["language": code, "received": received, "total": total])
      }
    }

    AsyncFunction("cancelDownload") {
      self.downloader.cancel()
    }

    /// Deletes a language's dictionary and voices, and the model once no language is left.
    AsyncFunction("remove") { (code: String) async throws in
      let language = try Self.language(code)
      await MainActor.run { Narrator.shared.stop() }
      var files = [SpeechFiles.lexicon(language)] + Voices.all(language).map { SpeechFiles.voice($0.id) }
      let others = [KokoroFrontend.Language.english, .spanish].filter { $0 != language }
      if !others.contains(where: { SpeechFiles.has(SpeechFiles.lexicon($0)) }) {
        files.append(SpeechFiles.model)
      }
      for file in files { try? FileManager.default.removeItem(at: SpeechFiles.local(file)) }
    }

    AsyncFunction("speak") { (options: SpeakOptions) async throws in
      let script = Narrator.Script(
        sentences: options.sentences,
        pauses: options.pauses,
        language: try Self.language(options.language),
        voice: options.voice,
        title: options.title,
        artist: options.artist)
      guard !script.sentences.isEmpty else { return }
      guard Downloader.missing(SpeechFiles.pack(script.language)) == 0 else {
        throw TTSError.processingFailed("The \(options.language) voices aren't downloaded")
      }
      try await Narrator.shared.speak(script, from: options.start, rate: Float(options.rate))
    }

    AsyncFunction("pause") { () async in await MainActor.run { Narrator.shared.pause() } }
    AsyncFunction("resume") { () async in await MainActor.run { Narrator.shared.resume() } }
    AsyncFunction("stop") { () async in await MainActor.run { Narrator.shared.stop() } }
    AsyncFunction("seek") { (index: Int) async in
      await MainActor.run { Narrator.shared.seek(to: index) }
    }
    AsyncFunction("setRate") { (rate: Double) async in
      await MainActor.run { Narrator.shared.setRate(Float(rate)) }
    }
  }

  private static func language(_ code: String) throws -> KokoroFrontend.Language {
    guard let language = KokoroFrontend.Language(rawValue: code) else {
      throw TTSError.processingFailed("No voices for language \(code)")
    }
    return language
  }
}

struct SpeakOptions: Record {
  @Field var sentences: [String] = []
  @Field var pauses: [Double] = []
  @Field var start: Int = 0
  @Field var language: String = "en"
  @Field var voice: String = "af_heart"
  @Field var rate: Double = 1
  @Field var title: String = ""
  @Field var artist: String = ""
}
