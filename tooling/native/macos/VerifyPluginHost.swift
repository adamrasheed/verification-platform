import CryptoKit
import Darwin
import Foundation

let maximumArtifactBytes = 16 * 1024 * 1024

func fail(_ message: String, status: Int32 = 126) -> Never {
  FileHandle.standardError.write(Data("verify-plugin-host: \(message)\n".utf8))
  exit(status)
}

guard CommandLine.arguments.count == 3,
      CommandLine.arguments[1] == "--artifact-digest" else {
  fail("expected an exact artifact digest")
}
let expectedDigest = CommandLine.arguments[2]
guard expectedDigest.range(
  of: #"^sha256:[a-f0-9]{64}$"#,
  options: .regularExpression
) != nil else {
  fail("artifact digest is malformed")
}

var artifact = Data()
var buffer = [UInt8](repeating: 0, count: 64 * 1024)
while true {
  let count = read(3, &buffer, buffer.count)
  if count == 0 { break }
  if count < 0 {
    if errno == EINTR { continue }
    fail("artifact channel failed")
  }
  artifact.append(buffer, count: count)
  if artifact.count > maximumArtifactBytes {
    fail("artifact exceeds the native host limit")
  }
}
close(3)
guard !artifact.isEmpty else { fail("artifact is empty") }

let actualDigest = "sha256:" + SHA256.hash(data: artifact)
  .map { String(format: "%02x", $0) }
  .joined()
guard actualDigest == expectedDigest else {
  fail("artifact digest mismatch")
}

let fileManager = FileManager.default
let invocationRoot = fileManager.temporaryDirectory
  .appendingPathComponent("invocation-\(UUID().uuidString)", isDirectory: true)
let entryPoint = invocationRoot.appendingPathComponent("plugin.mjs", isDirectory: false)

do {
  try fileManager.createDirectory(
    at: invocationRoot,
    withIntermediateDirectories: false,
    attributes: [.posixPermissions: 0o700]
  )
  try artifact.write(to: entryPoint, options: [.atomic])
  try fileManager.setAttributes([.posixPermissions: 0o500], ofItemAtPath: entryPoint.path)
  let stagedArtifact = try Data(contentsOf: entryPoint)
  let stagedDigest = "sha256:" + SHA256.hash(data: stagedArtifact)
    .map { String(format: "%02x", $0) }
    .joined()
  guard stagedDigest == expectedDigest else {
    fail("staged artifact digest mismatch")
  }
} catch {
  fail("could not stage the artifact")
}
defer { try? fileManager.removeItem(at: invocationRoot) }

let helper = Bundle.main.bundleURL
  .appendingPathComponent("Contents", isDirectory: true)
  .appendingPathComponent("Helpers", isDirectory: true)
  .appendingPathComponent("node", isDirectory: false)
let process = Process()
process.executableURL = helper
process.arguments = [
  "--permission",
  "--disable-proto=throw",
  "--allow-fs-read=\(entryPoint.path)",
  entryPoint.path,
]
process.environment = [:]
process.currentDirectoryURL = invocationRoot
process.standardInput = FileHandle.standardInput
process.standardOutput = FileHandle.standardOutput
process.standardError = FileHandle.standardError

do {
  try process.run()
  process.waitUntilExit()
  if process.terminationReason == .uncaughtSignal {
    raise(process.terminationStatus)
  }
  exit(process.terminationStatus)
} catch {
  fail("sandboxed helper launch failed")
}
