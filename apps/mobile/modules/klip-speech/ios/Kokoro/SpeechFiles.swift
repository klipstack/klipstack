import Foundation

/// The files reading aloud needs, and where they live. Kokoro's model, the pronunciation
/// dictionaries and the voices are downloaded when someone first wants a voice; only Kokoro's
/// `vocab.json` comes with the app, in the `KlipSpeech` bundle. Downloads are pinned to one
/// revision of each repository, so a change there can't surprise us.
enum SpeechFiles {
  struct Remote {
    let name: String
    let url: URL
    let bytes: Int64
  }

  private static let kokoro =
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231"
  private static let lexicons =
    "https://huggingface.co/FluidInference/kokoro-82m-coreml/resolve/006395f65025af251858b1ab0a7178a6a1e73f9f"
  private static let cmu =
    "https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690"
  private static let g2pEn =
    "https://raw.githubusercontent.com/Kyubyong/g2p/c6439c274c42b9724a7fee1dc07ca6a4c68a0538"

  /// Kokoro-82M v1.0, float32: every language uses it.
  static let model = Remote(
    name: "model.onnx", url: URL(string: "\(kokoro)/onnx/model.onnx")!, bytes: 325_532_232)

  static func lexicon(_ language: KokoroFrontend.Language) -> Remote {
    switch language {
    case .english:
      return Remote(
        name: "us_lexicon_cache.json", url: URL(string: "\(lexicons)/us_lexicon_cache.json")!,
        bytes: 10_444_631)
    case .spanish:
      return Remote(
        name: "es_lexicon_cache.json", url: URL(string: "\(lexicons)/es_lexicon_cache.json")!,
        bytes: 3_894_233)
    }
  }

  /// English words Kokoro's dictionary lacks, names mostly (`CMUDict`).
  static let cmudict = Remote(
    name: "cmudict.dict", url: URL(string: "\(cmu)/cmudict.dict")!, bytes: 3_618_488)

  /// The last resort for English words no dictionary has (`EnglishG2P`).
  static let g2pCheckpoint = Remote(
    name: "checkpoint20.npz", url: URL(string: "\(g2pEn)/g2p_en/checkpoint20.npz")!,
    bytes: 3_342_298)

  /// A voice: 510 styles of 256 floats, one per phoneme count.
  static func voice(_ id: String) -> Remote {
    Remote(
      name: "voices/\(id).bin", url: URL(string: "\(kokoro)/voices/\(id).bin")!, bytes: 522_240)
  }

  /// What a language needs: the model, its dictionaries and its voices.
  static func pack(_ language: KokoroFrontend.Language) -> [Remote] {
    let extra = language == .english ? [cmudict, g2pCheckpoint] : []
    return [model, lexicon(language)] + extra + Voices.all(language).map { voice($0.id) }
  }

  /// Application Support, not Caches: iOS may empty Caches, and this is 330 MB to get again.
  /// Left out of backups.
  static var directory: URL {
    get throws {
      var url = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("Speech", isDirectory: true)
      if !FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
      }
      return url
    }
  }

  static func local(_ file: Remote) throws -> URL {
    try directory.appendingPathComponent(file.name)
  }

  /// Present, and whole: its size is the one expected.
  static func has(_ file: Remote) -> Bool {
    guard let url = try? local(file),
      let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64
    else { return false }
    return size == file.bytes
  }

  static func bundled(_ name: String) throws -> URL {
    guard
      let bundleURL = Bundle(for: BundleToken.self).url(
        forResource: "KlipSpeech", withExtension: "bundle"),
      let url = Bundle(url: bundleURL)?.url(forResource: name, withExtension: nil)
    else { throw TTSError.processingFailed("Missing \(name) in the app") }
    return url
  }

  private final class BundleToken {}
}

/// The voices offered, by language: the best-rated of Kokoro's (its VOICES.md), US English only,
/// since the English frontend speaks American phonemes.
enum Voices {
  struct Voice {
    let id: String
    let name: String
  }

  static func all(_ language: KokoroFrontend.Language) -> [Voice] {
    switch language {
    case .english:
      return [
        Voice(id: "af_heart", name: "Heart"), Voice(id: "af_bella", name: "Bella"),
        Voice(id: "am_michael", name: "Michael"), Voice(id: "am_fenrir", name: "Fenrir"),
      ]
    case .spanish:
      return [Voice(id: "ef_dora", name: "Dora"), Voice(id: "em_alex", name: "Alex")]
    }
  }
}
