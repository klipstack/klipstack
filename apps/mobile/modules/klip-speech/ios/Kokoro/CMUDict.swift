import Foundation

/// CMU's pronouncing dictionary (cmusphinx/cmudict, `cmudict.dict`): lower-cased word → its ARPAbet,
/// as written there. Each word's first pronunciation only (`word(2)` lines are variants), plain
/// words only (letters, `'`, `.`, `-`), comments after `#` left out. `Arpabet.misaki` converts an
/// entry when it's used: most never are.
enum CMUDict {
  private static let wordCharacters = Set("abcdefghijklmnopqrstuvwxyz'.-")

  static func load(_ url: URL) throws -> [String: Substring] {
    let text = try String(contentsOf: url, encoding: .utf8)
    var words: [String: Substring] = [:]
    words.reserveCapacity(140_000)
    for line in text.split(separator: "\n") {
      let entry = line.prefix { $0 != "#" }
      guard let space = entry.firstIndex(of: " ") else { continue }
      let word = entry[..<space]
      guard let first = word.first, first.isLetter, word.allSatisfy(wordCharacters.contains)
      else { continue }
      let key = String(word)
      if words[key] == nil { words[key] = entry[entry.index(after: space)...] }
    }
    return words
  }
}

/// The arrays of an `.npz` file as `numpy.savez` writes it (a zip, stored, not compressed): name →
/// float32 values. Anything else (compression, another type, Fortran order) is an error.
enum NumpyZip {
  static func floats(_ data: Data) throws -> [String: [Float]] {
    let bytes = [UInt8](data)
    func u16(_ i: Int) -> Int { Int(bytes[i]) | Int(bytes[i + 1]) << 8 }
    func u32(_ i: Int) -> Int { u16(i) | u16(i + 2) << 16 }
    var arrays: [String: [Float]] = [:]
    var at = 0
    // Local file headers, one per array, one after another.
    while at + 30 <= bytes.count, u32(at) == 0x0403_4b50 {
      let flags = u16(at + 6)
      let method = u16(at + 8)
      let size = u32(at + 18)
      let nameLength = u16(at + 26)
      let start = at + 30 + nameLength + u16(at + 28)
      guard method == 0, flags & 0x08 == 0, size != 0xFFFF_FFFF, start + size <= bytes.count else {
        throw TTSError.processingFailed("Unreadable .npz: a compressed or streamed entry")
      }
      let name = String(decoding: bytes[(at + 30)..<(at + 30 + nameLength)], as: UTF8.self)
      arrays[name.replacingOccurrences(of: ".npy", with: "")] = try npy(bytes[start..<(start + size)])
      at = start + size
    }
    return arrays
  }

  /// One `.npy` array: its magic, version and header (a Python dict), then the values.
  private static func npy(_ entry: ArraySlice<UInt8>) throws -> [Float] {
    let b = Array(entry)
    guard b.count > 12, b[0] == 0x93, String(decoding: b[1..<6], as: UTF8.self) == "NUMPY" else {
      throw TTSError.processingFailed("Unreadable .npy")
    }
    let long = b[6] >= 2
    let headerStart = long ? 12 : 10
    let headerLength =
      Int(b[8]) | Int(b[9]) << 8 | (long ? Int(b[10]) << 16 | Int(b[11]) << 24 : 0)
    let header = String(decoding: b[headerStart..<(headerStart + headerLength)], as: UTF8.self)
    guard header.contains("'descr': '<f4'"), header.contains("'fortran_order': False") else {
      throw TTSError.processingFailed("Not little-endian float32 in C order: \(header)")
    }
    let values = b[(headerStart + headerLength)...]
    guard values.count % 4 == 0 else { throw TTSError.processingFailed("Truncated .npy") }
    var floats = [Float](repeating: 0, count: values.count / 4)
    floats.withUnsafeMutableBytes { target in values.withUnsafeBytes { target.copyMemory(from: $0) } }
    return floats
  }
}
