import Accelerate
import Foundation

/// Spelling → pronunciation for English words no dictionary has (names, mostly): the small GRU
/// encoder-decoder of g2p_en (github.com/Kyubyong/g2p, Apache-2.0, `checkpoint20.npz`), run with
/// plain CPU math, from the checkpoint itself. It answers in ARPAbet, as CMU's dictionary does.
final class EnglishG2P: @unchecked Sendable {
  private static let hidden = 256
  private static let graphemes = Array("abcdefghijklmnopqrstuvwxyz")
  /// Decoder outputs: `<pad> <unk> <s> </s>`, then ARPAbet with stress.
  static let phonemes: [String] =
    ["<pad>", "<unk>", "<s>", "</s>"]
    + ("AA0 AA1 AA2 AE0 AE1 AE2 AH0 AH1 AH2 AO0 AO1 AO2 AW0 AW1 AW2 AY0 AY1 AY2 B CH D DH EH0 EH1 "
      + "EH2 ER0 ER1 ER2 EY0 EY1 EY2 F G HH IH0 IH1 IH2 IY0 IY1 IY2 JH K L M N NG OW0 OW1 OW2 OY0 "
      + "OY1 OY2 P R S SH T TH UH0 UH1 UH2 UW UW0 UW1 UW2 V W Y Z ZH").split(separator: " ").map(
        String.init)

  private struct Gru {
    let wIH: [Float]  // 768 × 256
    let wHH: [Float]  // 768 × 256
    let bIH: [Float]  // 768
    let bHH: [Float]  // 768
  }

  private let encEmb: [Float]  // 29 × 256
  private let enc: Gru
  private let decEmb: [Float]  // 74 × 256
  private let dec: Gru
  private let fcW: [Float]  // 74 × 256
  private let fcB: [Float]  // 74

  /// - Parameter checkpoint: g2p_en's `checkpoint20.npz`.
  init(checkpoint url: URL) throws {
    let arrays = try NumpyZip.floats(Data(contentsOf: url))
    func array(_ name: String, _ count: Int) throws -> [Float] {
      guard let values = arrays[name], values.count == count else {
        throw TTSError.processingFailed("checkpoint20.npz: no \(name) of \(count) values")
      }
      return values
    }
    func gru(_ prefix: String) throws -> Gru {
      let h = Self.hidden
      return Gru(
        wIH: try array("\(prefix)_w_ih", 3 * h * h), wHH: try array("\(prefix)_w_hh", 3 * h * h),
        bIH: try array("\(prefix)_b_ih", 3 * h), bHH: try array("\(prefix)_b_hh", 3 * h))
    }
    let h = Self.hidden
    let symbols = Self.phonemes.count
    encEmb = try array("enc_emb", (Self.graphemes.count + 3) * h)
    enc = try gru("enc")
    decEmb = try array("dec_emb", symbols * h)
    dec = try gru("dec")
    fcW = try array("fc_w", symbols * h)
    fcB = try array("fc_b", symbols)
  }

  /// ARPAbet for a lower-case word (letters a–z; others read as unknown), at most 20 symbols.
  func predict(_ word: String) -> [String] {
    let h = Self.hidden
    var state = [Float](repeating: 0, count: h)
    // Encoder: each letter, then `</s>` (index 2).
    let ids = word.map { c in Self.graphemes.firstIndex(of: c).map { $0 + 3 } ?? 1 } + [2]
    for id in ids {
      state = step(enc, input: Array(encEmb[(id * h)..<((id + 1) * h)]), state: state)
    }
    // Decoder: greedy, from `<s>` (2) until `</s>` (3).
    var out: [String] = []
    var previous = 2
    for _ in 0..<20 {
      state = step(dec, input: Array(decEmb[(previous * h)..<((previous + 1) * h)]), state: state)
      var logits = fcB
      matVec(fcW, rows: fcB.count, state, into: &logits)
      var best = 0
      for i in 1..<logits.count where logits[i] > logits[best] { best = i }
      if best == 3 { break }
      out.append(Self.phonemes[best])
      previous = best
    }
    return out
  }

  /// One GRU step, as PyTorch computes it (gates in r, z, n order).
  private func step(_ gru: Gru, input: [Float], state: [Float]) -> [Float] {
    let h = Self.hidden
    var ih = gru.bIH
    var hh = gru.bHH
    matVec(gru.wIH, rows: 3 * h, input, into: &ih)
    matVec(gru.wHH, rows: 3 * h, state, into: &hh)
    var next = [Float](repeating: 0, count: h)
    for i in 0..<h {
      let r = sigmoid(ih[i] + hh[i])
      let z = sigmoid(ih[h + i] + hh[h + i])
      let n = tanh(ih[2 * h + i] + r * hh[2 * h + i])
      next[i] = (1 - z) * n + z * state[i]
    }
    return next
  }

  /// `y += W x`, W row-major with `rows` rows.
  private func matVec(_ w: [Float], rows: Int, _ x: [Float], into y: inout [Float]) {
    cblas_sgemv(
      CblasRowMajor, CblasNoTrans, Int32(rows), Int32(x.count), 1, w, Int32(x.count), x, 1, 1, &y,
      1)
  }

  private func sigmoid(_ x: Float) -> Float { 1 / (1 + exp(-x)) }
}

/// ARPAbet (CMU's dictionary, g2p_en) → Kokoro's US phonemes, as Misaki writes them: stress marks
/// before the vowel, diphthongs as single letters (`AY` → `I`), flapped t and d between vowels
/// (`ɾ`), and a syllabic schwa between a consonant and a final n or l (`ᵊ`).
enum Arpabet {
  private static let vowels: [String: String] = [
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "W", "AY": "I", "EH": "ɛ", "ER": "ɜɹ",
    "EY": "A", "IH": "ɪ", "IY": "i", "OW": "O", "OY": "Y", "UH": "ʊ", "UW": "u",
  ]
  private static let consonants: [String: String] = [
    "B": "b", "CH": "ʧ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "ʤ", "K": "k",
    "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t",
    "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
  ]

  static func misaki(_ arpabet: [String]) -> String {
    func split(_ symbol: String) -> (base: String, stress: Character?) {
      if let last = symbol.last, last.isNumber { return (String(symbol.dropLast()), last) }
      return (symbol, nil)
    }
    func isVowel(_ symbol: String) -> Bool { vowels[split(symbol).base] != nil }
    var out = ""
    for (i, symbol) in arpabet.enumerated() {
      let (base, stress) = split(symbol)
      let next = i + 1 < arpabet.count ? arpabet[i + 1] : ""
      let previous = i > 0 ? arpabet[i - 1] : ""
      if let vowel = vowels[base] {
        if base == "AH" && stress == "0" {
          let after = i + 2 < arpabet.count ? arpabet[i + 2] : ""
          let syllabic = ["N", "L"].contains(next) && !isVowel(after) && i > 0 && !isVowel(previous)
          out += syllabic ? "ᵊ" : "ə"
        } else if base == "ER" && stress == "0" {
          out += "əɹ"
        } else {
          out += (stress == "1" ? "ˈ" : stress == "2" ? "ˌ" : "") + vowel
        }
      } else if let consonant = consonants[base] {
        let flap =
          (base == "T" || base == "D") && (isVowel(previous) || previous == "R")
          && isVowel(next) && split(next).stress == "0"
        out += flap ? "ɾ" : consonant
      }
    }
    return out
  }
}
