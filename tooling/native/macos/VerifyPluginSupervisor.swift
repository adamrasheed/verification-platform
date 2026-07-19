import Darwin
import Foundation

let pollingIntervalMicroseconds: useconds_t = 25_000
var timebase = mach_timebase_info_data_t()
guard mach_timebase_info(&timebase) == KERN_SUCCESS, timebase.denom > 0 else {
  fail("could not initialize the CPU timebase")
}
var supervisedHostIdentifier: pid_t = 0
var supervisedPluginIdentifier: pid_t = 0

func relayTermination(_ signalNumber: Int32) -> Void {
  if supervisedPluginIdentifier > 0 {
    kill(supervisedPluginIdentifier, signalNumber)
  }
  if supervisedHostIdentifier > 0 {
    kill(supervisedHostIdentifier, signalNumber)
  }
  _exit(128 + signalNumber)
}

func fail(_ message: String, status: Int32 = 126) -> Never {
  FileHandle.standardError.write(Data("verify-plugin-supervisor: \(message)\n".utf8))
  exit(status)
}

func unsignedInteger(_ value: String) -> UInt64? {
  guard !value.isEmpty, value.allSatisfy(\.isNumber) else { return nil }
  return UInt64(value)
}

func nanoseconds(fromAbsoluteTime value: UInt64) -> UInt64 {
  let numerator = UInt64(timebase.numer)
  let denominator = UInt64(timebase.denom)
  return (value / denominator) * numerator
    + ((value % denominator) * numerator) / denominator
}

guard CommandLine.arguments.count == 7,
      CommandLine.arguments[1] == "--artifact-digest",
      CommandLine.arguments[3] == "--maximum-memory-bytes",
      CommandLine.arguments[5] == "--maximum-cpu-nanoseconds",
      let maximumMemoryBytes = unsignedInteger(CommandLine.arguments[4]),
      let maximumCpuNanoseconds = unsignedInteger(CommandLine.arguments[6]),
      maximumMemoryBytes >= 64 * 1024 * 1024,
      maximumCpuNanoseconds >= 1_000_000_000 else {
  fail("resource limits are missing or invalid")
}
let artifactDigest = CommandLine.arguments[2]
guard artifactDigest.range(
  of: #"^sha256:[a-f0-9]{64}$"#,
  options: .regularExpression
) != nil else {
  fail("artifact digest is malformed")
}
guard fcntl(3, F_GETFD) >= 0 else {
  fail("artifact channel is unavailable")
}

let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardized
let host = executable
  .deletingLastPathComponent()
  .deletingLastPathComponent()
  .appendingPathComponent("MacOS", isDirectory: true)
  .appendingPathComponent("VerifyPluginHost", isDirectory: false)
  .path

var controlPipe: [Int32] = [0, 0]
guard pipe(&controlPipe) == 0 else { fail("could not create the PID channel") }
defer {
  close(controlPipe[0])
  close(controlPipe[1])
}

var actions: posix_spawn_file_actions_t? = nil
guard posix_spawn_file_actions_init(&actions) == 0 else {
  fail("could not initialize host launch actions")
}
defer { posix_spawn_file_actions_destroy(&actions) }
guard
  posix_spawn_file_actions_addclose(&actions, controlPipe[0]) == 0,
  posix_spawn_file_actions_adddup2(&actions, controlPipe[1], 4) == 0,
  posix_spawn_file_actions_addclose(&actions, controlPipe[1]) == 0
else {
  fail("could not configure the PID channel")
}

var hostIdentifier: pid_t = 0
let arguments = [host, "--artifact-digest", artifactDigest]
var argumentPointers = arguments.map { strdup($0) }
argumentPointers.append(nil)
defer {
  for pointer in argumentPointers where pointer != nil { free(pointer) }
}
let spawnResult = posix_spawn(
  &hostIdentifier,
  host,
  &actions,
  nil,
  &argumentPointers,
  environ
)
guard spawnResult == 0 else { fail("could not launch the sandbox host") }
supervisedHostIdentifier = hostIdentifier
close(controlPipe[1])
controlPipe[1] = -1

var pidBytes = [UInt8]()
var byte: UInt8 = 0
while pidBytes.count <= 32 {
  let count = read(controlPipe[0], &byte, 1)
  if count == 0 { break }
  if count < 0 {
    if errno == EINTR { continue }
    kill(hostIdentifier, SIGKILL)
    fail("PID channel failed")
  }
  if byte == 0x0a { break }
  pidBytes.append(byte)
}
guard let pidText = String(bytes: pidBytes, encoding: .utf8),
      let pluginIdentifier = Int32(pidText),
      pluginIdentifier > 0 else {
  kill(hostIdentifier, SIGKILL)
  fail("sandbox host did not identify its helper")
}
supervisedPluginIdentifier = pluginIdentifier
signal(SIGTERM, relayTermination)
signal(SIGINT, relayTermination)
signal(SIGHUP, relayTermination)
close(controlPipe[0])
controlPipe[0] = -1

func resourceUsage(of identifier: pid_t) -> rusage_info_v4? {
  var information = rusage_info_v4()
  let result = withUnsafeMutablePointer(to: &information) { pointer in
    proc_pid_rusage(
      identifier,
      RUSAGE_INFO_V4,
      UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: rusage_info_t?.self)
    )
  }
  return result == 0 ? information : nil
}

func terminateSandbox() -> Void {
  kill(pluginIdentifier, SIGKILL)
  kill(hostIdentifier, SIGKILL)
}

var hostStatus: Int32 = 0
while true {
  let waitResult = waitpid(hostIdentifier, &hostStatus, WNOHANG)
  if waitResult == hostIdentifier { break }
  if waitResult < 0 {
    terminateSandbox()
    fail("could not supervise the sandbox host")
  }
  guard let usage = resourceUsage(of: pluginIdentifier) else {
    if kill(pluginIdentifier, 0) != 0 && errno == ESRCH {
      usleep(pollingIntervalMicroseconds)
      continue
    }
    terminateSandbox()
    fail("resource inspection failed closed")
  }
  let cpuNanoseconds = nanoseconds(
    fromAbsoluteTime: usage.ri_user_time &+ usage.ri_system_time
  )
  if (
    usage.ri_phys_footprint > maximumMemoryBytes
    || cpuNanoseconds > maximumCpuNanoseconds
  ) {
    terminateSandbox()
    while waitpid(hostIdentifier, &hostStatus, 0) < 0 && errno == EINTR {}
    fail("VFY_PLUGIN_RESOURCE_EXHAUSTED", status: 125)
  }
  usleep(pollingIntervalMicroseconds)
}

let terminationSignal = hostStatus & 0x7f
if terminationSignal == 0 {
  exit((hostStatus >> 8) & 0xff)
}
raise(terminationSignal)
exit(128 + terminationSignal)
