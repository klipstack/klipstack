import Foundation

/// Downloads a language's files one after another, reporting bytes as they arrive. A file lands
/// under its name only when whole; a failed or cancelled download leaves nothing behind but the
/// files already finished, and the next attempt starts from those.
final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
  typealias Progress = @Sendable (_ received: Int64, _ total: Int64) -> Void

  private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  private let lock = NSLock()
  private var task: URLSessionDownloadTask?
  private var continuation: CheckedContinuation<URL, Error>?
  private var destination: URL?
  private var written: Int64 = 0
  private var progress: Progress?
  /// The last download asked for. One runs at a time: a second caller (the reader and the voices
  /// screen at once) waits for the first, whose files it then skips, instead of taking over its
  /// task and leaving the first waiting forever.
  private var running: Task<Void, Error>?

  /// Bytes still to download for these files.
  static func missing(_ files: [SpeechFiles.Remote]) -> Int64 {
    files.filter { !SpeechFiles.has($0) }.reduce(0) { $0 + $1.bytes }
  }

  /// - Parameter progress: at most four times a second, and at the end.
  func download(_ files: [SpeechFiles.Remote], progress report: @escaping Progress) async throws {
    let turn: Task<Void, Error> = lock.withLock {
      let previous = running
      let turn = Task {
        _ = await previous?.result
        try await self.fetchAll(files, progress: report)
      }
      running = turn
      return turn
    }
    try await withTaskCancellationHandler {
      try await turn.value
    } onCancel: {
      turn.cancel()
    }
  }

  private func fetchAll(_ files: [SpeechFiles.Remote], progress report: @escaping Progress)
    async throws
  {
    try Task.checkCancellation()
    let throttle = Throttle(every: 0.25)
    let progress: Progress = { received, total in
      if received == total || throttle.ready() { report(received, total) }
    }
    let todo = files.filter { !SpeechFiles.has($0) }
    let total = todo.reduce(0) { $0 + $1.bytes }
    var done: Int64 = 0
    progress(0, total)
    for file in todo {
      let target = try SpeechFiles.local(file)
      try FileManager.default.createDirectory(
        at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      let before = done
      _ = try await fetch(file.url, to: target) { received in progress(before + received, total) }
      guard SpeechFiles.has(file) else {
        try? FileManager.default.removeItem(at: target)
        throw TTSError.processingFailed("\(file.name) didn't download whole. Try again.")
      }
      done += file.bytes
      progress(done, total)
    }
  }

  func cancel() {
    lock.withLock { task }?.cancel()
  }

  private func fetch(_ url: URL, to target: URL, received: @escaping @Sendable (Int64) -> Void)
    async throws -> URL
  {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        lock.withLock {
          self.continuation = continuation
          destination = target
          written = 0
          progress = { got, _ in received(got) }
          task = session.downloadTask(with: url)
          task?.resume()
        }
      }
    } onCancel: {
      self.cancel()
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    let report = lock.withLock { progress }
    report?(totalBytesWritten, totalBytesExpectedToWrite)
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL
  ) {
    // The temporary file goes when this returns: move it now.
    let target = lock.withLock { destination }
    guard let target else { return }
    do {
      if let status = (downloadTask.response as? HTTPURLResponse)?.statusCode, status != 200 {
        throw TTSError.processingFailed("Download failed (HTTP \(status))")
      }
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.moveItem(at: location, to: target)
      finish(.success(target))
    } catch {
      finish(.failure(error))
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error { finish(.failure(error)) }
  }

  private func finish(_ result: Result<URL, Error>) {
    let waiting = lock.withLock {
      defer {
        continuation = nil
        task = nil
        progress = nil
      }
      return continuation
    }
    waiting?.resume(with: result)
  }
}

private final class Throttle: @unchecked Sendable {
  private let interval: TimeInterval
  private let lock = NSLock()
  private var last = Date.distantPast

  init(every interval: TimeInterval) {
    self.interval = interval
  }

  func ready() -> Bool {
    lock.withLock {
      guard Date().timeIntervalSince(last) >= interval else { return false }
      last = Date()
      return true
    }
  }
}
