import Foundation

/// Text to Kokoro phonemes, for one language. English: numbers spelled out, then Kokoro's own
/// pronunciation dictionary (Misaki), word by word. Spanish: spelling rules plus a list of
/// exceptions. The result comes in pieces Kokoro can take at once (510 phonemes at most).
final class KokoroFrontend: @unchecked Sendable {
  enum Language: String {
    case english = "en"
    case spanish = "es"
  }

  let language: Language
  private let english: KokoroAneEnglishPhonemizer?
  private let fallback: EnglishFallback?
  private let spanish: KokoroAneLexicon?
  /// Words no dictionary had: skipped, and kept here to see how often it happens.
  private(set) var unknownWords: [String] = []

  /// - Parameters:
  ///   - vocab: Kokoro's phoneme vocabulary (its `config.json`), which also says which
  ///     punctuation it reads as pauses.
  ///   - lexicon: `us_lexicon_cache.json` for English, `es_lexicon_cache.json` for Spanish.
  ///   - names: for English, CMU's `cmudict.dict`, and `g2p`, g2p_en's `checkpoint20.npz` (see
  ///     `EnglishFallback`).
  init(
    language: Language, vocab: KokoroAneVocab, lexicon: URL, names: URL? = nil, g2p: URL? = nil
  ) throws {
    self.language = language
    switch language {
    case .english:
      let payload = try JSONDecoder().decode(
        EnglishLexicon.self, from: Data(contentsOf: lexicon))
      let allowed = Set(vocab.map.keys.map(String.init))
      let keep = { (tokens: [String]) in tokens.filter { allowed.contains($0) } }
      let lower = payload.lower.mapValues(keep)
      english = KokoroAneEnglishPhonemizer(
        wordToPhonemes: lower,
        caseSensitiveWordToPhonemes: payload.caseSensitive.mapValues(keep),
        allowedPunctuation: Set(
          vocab.map.keys.filter { !$0.isLetter && !$0.isNumber && !$0.isWhitespace }))
      var letters: [Character: String] = [:]
      for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
        if let tokens = payload.caseSensitive[String(letter)] { letters[letter] = keep(tokens).joined() }
      }
      fallback = EnglishFallback(
        lexicon: lower.mapValues { $0.joined() },
        names: try names.map(CMUDict.load) ?? [:],
        letters: letters,
        g2p: try g2p.map(EnglishG2P.init(checkpoint:)))
      spanish = nil
    case .spanish:
      english = nil
      fallback = nil
      spanish = try KokoroAneLexicon(contentsOf: lexicon)
    }
  }

  /// Forms the dictionary gets wrong: `TL;DR` would be "TL doctor".
  static func expand(_ text: String) -> String {
    text.replacingOccurrences(
      of: #"\bTL;\s?DR\b"#, with: "T L D R", options: [.regularExpression, .caseInsensitive])
  }

  /// `1,000` → `one thousand`. The normalizer leaves grouped numbers alone, and without their commas
  /// it would read some as years (`ten hundred`).
  private static let grouped = try! NSRegularExpression(
    pattern: #"(?<![0-9.,])[0-9]{1,3}(?:,[0-9]{3})+(?![0-9]|[.,][0-9])"#)

  static func ungroup(_ text: String) -> String {
    let ns = text as NSString
    var out = text
    for match in grouped.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
      let digits = ns.substring(with: match.range).replacingOccurrences(of: ",", with: "")
      guard let value = Int(digits), let words = spellOutFormatter.string(from: NSNumber(value: value))
      else { continue }
      out = (out as NSString).replacingCharacters(in: match.range, with: words)
    }
    return out
  }

  private struct EnglishLexicon: Decodable {
    let lower: [String: [String]]
    let caseSensitive: [String: [String]]
  }

  /// The phonemes for `text`, in pieces of at most 510; none when nothing in it can be said.
  func phonemes(for text: String) async throws -> [String] {
    let phonemes: String
    switch language {
    case .english:
      let normalized = EnglishTextNormalizer.normalizeForFrontend(Self.ungroup(Self.expand(text)))
      guard normalized.contains(where: { $0.isLetter || $0.isNumber }) else { return [] }
      do {
        phonemes = try await english!.phonemize(normalized) { [weak self] word in
          if let ps = self?.fallback?.phonemes(for: word) { return ps.map(String.init) }
          self?.unknownWords.append(word)
          return nil
        }
      } catch KokoroAneError.inputProcessingFailed {
        return []
      }
    case .spanish:
      let normalized = RomanceNumberNormalizer.normalize(text, language: .spanish)
      phonemes = SpanishG2P.phonemize(normalized, lexicon: spanish!)
    }
    guard phonemes.contains(where: { $0.isLetter }) else { return [] }
    return PhonemeChunker.chunk(
      phonemes, maxLength: KokoroAneConstants.maxPhonemeLength, countsUnicodeScalars: true)
  }
}
