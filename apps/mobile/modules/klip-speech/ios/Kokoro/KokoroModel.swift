import Foundation
import onnxruntime_objc

/// Kokoro-82M on ONNX Runtime's CPU kernels: phoneme ids and a voice's style in, 24 kHz mono
/// samples out. Not thread-safe: `SpeechEngine` calls it from one queue.
final class KokoroModel {
  static let sampleRate = 24_000.0

  private let env: ORTEnv
  private let session: ORTSession
  private let vocab: KokoroAneVocab

  /// - Parameter threads: ONNX Runtime's intra-op threads. Two, for the phone's two fast cores.
  init(model: URL, vocab: KokoroAneVocab, threads: Int = 2) throws {
    env = try ORTEnv(loggingLevel: .warning)
    let options = try ORTSessionOptions()
    try options.setIntraOpNumThreads(Int32(threads))
    try options.setGraphOptimizationLevel(.all)
    session = try ORTSession(env: env, modelPath: model.path, sessionOptions: options)
    self.vocab = vocab
  }

  /// Speech for one piece of phonemes (510 at most), at Kokoro's own speed control.
  func speak(_ phonemes: String, voice: VoicePack, speed: Float = 1) throws -> [Float] {
    var ids = try vocab.encode(phonemes).map(Int64.init)
    var style = voice.style(forPhonemes: KokoroAneVocab.phonemeLength(phonemes))
    var rate = speed
    let inputs: [String: ORTValue] = [
      "input_ids": try ORTValue(
        tensorData: NSMutableData(bytes: &ids, length: ids.count * MemoryLayout<Int64>.size),
        elementType: .int64, shape: [1, NSNumber(value: ids.count)]),
      "style": try ORTValue(
        tensorData: NSMutableData(bytes: &style, length: style.count * MemoryLayout<Float>.size),
        elementType: .float, shape: [1, NSNumber(value: style.count)]),
      "speed": try ORTValue(
        tensorData: NSMutableData(bytes: &rate, length: MemoryLayout<Float>.size),
        elementType: .float, shape: [1]),
    ]
    let outputs = try session.run(
      withInputs: inputs, outputNames: ["waveform"], runOptions: nil)
    guard let waveform = outputs["waveform"] else {
      throw TTSError.processingFailed("Kokoro returned no waveform")
    }
    let data = try waveform.tensorData() as Data
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }
}

/// A Kokoro voice: one 256-float style per phoneme count (1 to 510), picked by the length of what
/// it says, as Kokoro's own pipeline picks it.
final class VoicePack {
  private static let width = 256
  private let styles: [Float]

  init(url: URL) throws {
    let data = try Data(contentsOf: url)
    styles = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    guard styles.count >= Self.width, styles.count % Self.width == 0 else {
      throw TTSError.processingFailed("Unreadable voice \(url.lastPathComponent)")
    }
  }

  func style(forPhonemes count: Int) -> [Float] {
    let rows = styles.count / Self.width
    let row = min(max(count, 0), rows - 1)
    return Array(styles[(row * Self.width)..<((row + 1) * Self.width)])
  }
}
