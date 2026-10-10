import Foundation
import os

// The pieces of FluidAudio the copied text frontend expects (see README.md in this folder):
// its logger, error types and Kokoro constants, cut down to what these files use.

struct AppLogger: Sendable {
  private let logger: Logger

  init(subsystem: String = "com.klipstack.speech", category: String) {
    logger = Logger(subsystem: subsystem, category: category)
  }

  func debug(_ message: String) { logger.debug("\(message, privacy: .public)") }
  func info(_ message: String) { logger.info("\(message, privacy: .public)") }
  func warning(_ message: String) { logger.warning("\(message, privacy: .public)") }
  func error(_ message: String) { logger.error("\(message, privacy: .public)") }
}

enum KokoroAneError: LocalizedError {
  case inputProcessingFailed(String)
  case vocabMissing(URL)
  case vocabParseFailed(URL, String)
  case phonemeSequenceTooLong(Int)

  var errorDescription: String? {
    switch self {
    case .inputProcessingFailed(let detail): return "Text processing failed: \(detail)"
    case .vocabMissing(let url): return "Missing vocabulary: \(url.lastPathComponent)"
    case .vocabParseFailed(let url, let detail):
      return "Unreadable vocabulary \(url.lastPathComponent): \(detail)"
    case .phonemeSequenceTooLong(let count): return "Too many phonemes: \(count)"
    }
  }
}

enum TTSError: LocalizedError {
  case processingFailed(String)

  var errorDescription: String? {
    switch self {
    case .processingFailed(let detail): return detail
    }
  }
}

enum KokoroAneConstants {
  static let sampleRate = 24_000
  static let bosTokenId: Int32 = 0
  static let eosTokenId: Int32 = 0
  /// Kokoro's context: 512 tokens, less the two boundary tokens.
  static let maxPhonemeLength = 510
}

/// FluidAudio links an optional compiled normalizer (NeMo FSTs). This build doesn't: the English
/// frontend then uses its own rules for numbers, and Spanish `RomanceNumberNormalizer`.
enum NemoTextNormalizer {
  enum Language: String {
    case english = "en"
    case spanish = "es"
    case french = "fr"
  }

  static let isAvailable = false

  static func normalize(_ text: String, language: Language) -> String { text }
}

// From FluidAudio's SSMLTypes.swift: number spelling for `SayAsInterpreter`.

let spellOutFormatter: NumberFormatter = {
  let formatter = NumberFormatter()
  formatter.numberStyle = .spellOut
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.maximumFractionDigits = 0
  formatter.roundingMode = .down
  return formatter
}()

let digitWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

func digitToWord(_ char: Character) -> String? {
  guard let digit = Int(String(char)), digit >= 0, digit <= 9 else { return nil }
  return digitWords[digit]
}
