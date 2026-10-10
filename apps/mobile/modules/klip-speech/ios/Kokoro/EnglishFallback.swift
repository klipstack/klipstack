import Foundation

/// What the English frontend says for a word Kokoro's dictionary (Misaki) lacks, in this order:
/// 1. An inflection of a word it knows: -s, -ed, -ing, by Misaki's own rules (`stem_s`, `stem_ed`,
///    `stem_ing` in misaki/en.py). Its dictionary leaves most of them out on purpose.
/// 2. CMU's pronouncing dictionary (`cmudict.dict`), converted to Kokoro's phonemes when a word is
///    looked up: mostly names, which Misaki leaves to espeak-ng. espeak-ng is GPL, so it isn't used
///    here.
/// 3. Pieces: digits spelled out (`10x`), initialisms spelled as letters (`LLMs`, `fMRI`), and
///    words joined in camel case taken apart (`ChatGPT`).
/// 4. The word without its accents (`Cárdenas`).
/// 5. Two known words written as one (`signup`, `workday`).
/// 6. Letters without a vowel spelled out (`pp`, `www`); anything else, a guess from its spelling
///    (`EnglishG2P`).
/// Only a word without a single letter a–z is skipped.
struct EnglishFallback: Sendable {
  /// Lower-cased word → phonemes: Misaki's dictionary.
  let lexicon: [String: String]
  /// Lower-cased word → ARPAbet: CMU's dictionary (`CMUDict`).
  let names: [String: Substring]
  /// Upper-case letter → its name's phonemes (`F` → `ˈɛf`).
  let letters: [Character: String]
  /// The last resort; without it, unknown words are skipped.
  let g2p: EnglishG2P?

  /// - Parameter word: as written, case and all.
  func phonemes(for word: String) -> String? {
    let lower = word.lowercased()
    if let ps = known(lower) ?? inflected(lower) ?? pieces(word) { return ps }
    let plain = lower.folding(options: .diacriticInsensitive, locale: nil)
    if plain != lower, let ps = known(plain) ?? inflected(plain) { return ps }
    if let ps = compound(lower) { return ps }
    return guess(plain)
  }

  private func guess(_ word: String) -> String? {
    if word.count > 3, word.hasSuffix("'s"), let stem = guess(String(word.dropLast(2))) {
      return withS(stem)
    }
    let letters = word.filter { $0.isASCII && $0.isLetter }
    guard !letters.isEmpty else { return nil }
    if !letters.contains(where: { "aeiouy".contains($0) }) { return spell(letters) }
    guard let g2p else { return nil }
    let ps = Arpabet.misaki(g2p.predict(letters))
    return ps.isEmpty ? nil : ps
  }

  private func known(_ word: String) -> String? {
    lexicon[word] ?? names[word].map { Arpabet.misaki($0.split(separator: " ").map(String.init)) }
  }

  private func inflected(_ word: String) -> String? {
    stemS(word) ?? stemEd(word) ?? stemIng(word)
  }

  // MARK: Misaki's inflection rules (US English)

  /// Vowels and ɹ: a t after one of these is flapped before -ed and -ing (`waited`).
  private static let taus = Set("AIOWYiuæɑəɛɪɹʊʌ")

  private func stemS(_ word: String) -> String? {
    guard word.count >= 3, word.hasSuffix("s") else { return nil }
    let stem: String
    if !word.hasSuffix("ss"), known(String(word.dropLast())) != nil {
      stem = String(word.dropLast())
    } else if word.hasSuffix("'s") || (word.count > 4 && word.hasSuffix("es") && !word.hasSuffix("ies")),
      known(String(word.dropLast(2))) != nil
    {
      stem = String(word.dropLast(2))
    } else if word.count > 4, word.hasSuffix("ies"), known(word.dropLast(3) + "y") != nil {
      stem = word.dropLast(3) + "y"
    } else {
      return nil
    }
    return known(stem).map(withS)
  }

  /// Misaki's `_s`: -s after a stem's last sound.
  private func withS(_ ps: String) -> String {
    guard let last = ps.last else { return ps }
    if "ptkfθ".contains(last) { return ps + "s" }
    if "szʃʒʧʤ".contains(last) { return ps + "ᵻz" }
    return ps + "z"
  }

  private func stemEd(_ word: String) -> String? {
    guard word.count >= 4, word.hasSuffix("d") else { return nil }
    let stem: String
    if !word.hasSuffix("dd"), known(String(word.dropLast())) != nil {
      stem = String(word.dropLast())
    } else if word.count > 4, word.hasSuffix("ed"), !word.hasSuffix("eed"),
      known(String(word.dropLast(2))) != nil
    {
      stem = String(word.dropLast(2))
    } else {
      return nil
    }
    guard let ps = known(stem), let last = ps.last else { return nil }
    if "pkfθʃsʧ".contains(last) { return ps + "t" }
    if last == "d" { return ps + "ᵻd" }
    if last != "t" { return ps + "d" }
    let chars = Array(ps)
    if chars.count < 2 { return ps + "ɪd" }
    if Self.taus.contains(chars[chars.count - 2]) { return String(chars.dropLast()) + "ɾᵻd" }
    return ps + "ᵻd"
  }

  private func stemIng(_ word: String) -> String? {
    guard word.count >= 5, word.hasSuffix("ing") else { return nil }
    let base = String(word.dropLast(3))
    let stem: String
    if word.count > 5, known(base) != nil {
      stem = base
    } else if known(base + "e") != nil {
      stem = base + "e"
    } else if word.count > 5, doubledBeforeIng(word), known(String(word.dropLast(4))) != nil {
      stem = String(word.dropLast(4))
    } else {
      return nil
    }
    guard let ps = known(stem) else { return nil }
    let chars = Array(ps)
    if chars.count > 1, chars.last == "t", Self.taus.contains(chars[chars.count - 2]) {
      return String(chars.dropLast()) + "ɾɪŋ"
    }
    return ps + "ɪŋ"
  }

  /// `([bcdgklmnprstvxz])\1ing$|cking$` in Misaki: `running`, `picking`.
  private func doubledBeforeIng(_ word: String) -> Bool {
    if word.hasSuffix("cking") { return true }
    let chars = Array(word.dropLast(3))
    guard chars.count >= 2, let last = chars.last else { return false }
    return chars[chars.count - 2] == last && "bcdgklmnprstvxz".contains(last)
  }

  // MARK: Pieces

  private func pieces(_ word: String) -> String? {
    if word.allSatisfy(\.isNumber) { return number(word) }
    let capitals = word.filter(\.isUppercase).count
    // `VCs`, `LLMs`: the letters, and a plural s.
    if capitals >= 2, word.last == "s", word.dropLast().allSatisfy(\.isUppercase),
      let spelled = spell(word.dropLast())
    {
      return spelled + "z"
    }
    let parts = split(word)
    if parts.count > 1 {
      let said = parts.compactMap { phonemes(for: $0) }
      return said.count == parts.count ? said.joined(separator: " ") : nil
    }
    if capitals >= 2 || (word.count == 1 && word.first!.isLetter) { return spell(word) }
    return nil
  }

  /// Runs of digits and of letters, and camel-case words: `bush3` → `bush 3`, `ChatGPT` →
  /// `Chat GPT`, `fMRI` → `f MRI`.
  private func split(_ word: String) -> [String] {
    var parts: [String] = []
    var current = ""
    var previous: Character?
    for (i, c) in word.enumerated() {
      let chars = Array(word)
      let next: Character? = i + 1 < chars.count ? chars[i + 1] : nil
      if let p = previous {
        let kindChanges = p.isNumber != c.isNumber
        let camel = p.isLowercase && c.isUppercase
        // The last capital of a run starts the next word: `GPTModel` → `GPT Model`.
        let runEnds = p.isUppercase && c.isUppercase && (next?.isLowercase ?? false)
        if kindChanges || camel || runEnds, !current.isEmpty {
          parts.append(current)
          current = ""
        }
      }
      if c.isLetter || c.isNumber { current.append(c) }
      previous = c
    }
    if !current.isEmpty { parts.append(current) }
    return parts
  }

  private func spell<S: StringProtocol>(_ letters: S) -> String? {
    let names = letters.uppercased().map { self.letters[$0] }
    guard !names.isEmpty, !names.contains(where: { $0 == nil }) else { return nil }
    return names.map { $0! }.joined(separator: " ")
  }

  /// Digits as words (`12` → `twelve`), by `SayAsInterpreter`'s formatter.
  private func number(_ digits: String) -> String? {
    guard digits.count <= 15, let value = Int(digits) else { return nil }
    let words = digits.count > 1 && digits.first == "0"
      ? digits.compactMap { digitToWord($0) }
      : (spellOutFormatter.string(from: NSNumber(value: value)) ?? "")
        .split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init)
    let said = words.compactMap { known($0) }
    return said.count == words.count && !said.isEmpty ? said.joined(separator: " ") : nil
  }

  // MARK: Compounds

  /// Two known words, the first at least three letters long and the second at least two; the
  /// longest first word wins (`workdays` → `work` + `days`).
  private func compound(_ word: String) -> String? {
    let chars = Array(word)
    guard chars.count >= 5 else { return nil }
    for split in stride(from: chars.count - 2, through: 3, by: -1) {
      let head = String(chars[..<split])
      let tail = String(chars[split...])
      guard let first = known(head), let second = known(tail) ?? inflected(tail) else { continue }
      // The second word keeps only secondary stress, as in a compound noun.
      return first + second.replacingOccurrences(of: "ˈ", with: "ˌ")
    }
    return nil
  }
}
