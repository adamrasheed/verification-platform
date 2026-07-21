#define _WIN32_WINNT 0x0A00

#include <windows.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <io.h>
#include <fcntl.h>
#include <sddl.h>
#include <userenv.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <string>
#include <vector>

namespace {

constexpr std::uint64_t maximumArtifactBytes = 16ULL * 1024ULL * 1024ULL;
constexpr wchar_t appContainerName[] = L"Verify.Plugin.Runtime.V1";
std::wstring invocationRoot;
std::wstring artifactPath;
HANDLE sandboxJob = nullptr;

void cleanup() {
  if (!artifactPath.empty()) DeleteFileW(artifactPath.c_str());
  if (!invocationRoot.empty()) RemoveDirectoryW(invocationRoot.c_str());
  if (sandboxJob != nullptr) {
    CloseHandle(sandboxJob);
    sandboxJob = nullptr;
  }
}

[[noreturn]] void fail(const wchar_t* message, int status = 126) {
  const DWORD error = GetLastError();
  fwprintf(
    stderr,
    L"verify-plugin-windows-host: %ls (win32=%lu)\n",
    message,
    static_cast<unsigned long>(error)
  );
  cleanup();
  ExitProcess(static_cast<UINT>(status));
}

bool parseUnsigned(const wchar_t* value, std::uint64_t& result) {
  if (value == nullptr || value[0] == L'\0' || value[0] == L'-') return false;
  wchar_t* end = nullptr;
  errno = 0;
  const unsigned long long parsed = _wcstoui64(value, &end, 10);
  if (errno != 0 || end == value || *end != L'\0') return false;
  result = static_cast<std::uint64_t>(parsed);
  return true;
}

bool digestShape(const std::wstring& value) {
  if (value.size() != 71 || value.compare(0, 7, L"sha256:") != 0) return false;
  return std::all_of(value.begin() + 7, value.end(), [](wchar_t byte) {
    return (byte >= L'0' && byte <= L'9') || (byte >= L'a' && byte <= L'f');
  });
}

class Sha256 {
 public:
  Sha256() {
    if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(
      &algorithm_, BCRYPT_SHA256_ALGORITHM, nullptr, 0
    ))) fail(L"could not initialize SHA-256");
    DWORD returned = 0;
    if (
      !BCRYPT_SUCCESS(BCryptGetProperty(
        algorithm_, BCRYPT_OBJECT_LENGTH,
        reinterpret_cast<PUCHAR>(&objectLength_), sizeof(objectLength_),
        &returned, 0
      ))
      || !BCRYPT_SUCCESS(BCryptGetProperty(
        algorithm_, BCRYPT_HASH_LENGTH,
        reinterpret_cast<PUCHAR>(&hashLength_), sizeof(hashLength_),
        &returned, 0
      ))
      || hashLength_ != 32
    ) fail(L"could not configure SHA-256");
    object_.resize(objectLength_);
    if (!BCRYPT_SUCCESS(BCryptCreateHash(
      algorithm_, &hash_, object_.data(), objectLength_, nullptr, 0, 0
    ))) fail(L"could not create SHA-256 context");
  }

  ~Sha256() {
    if (hash_ != nullptr) BCryptDestroyHash(hash_);
    if (algorithm_ != nullptr) BCryptCloseAlgorithmProvider(algorithm_, 0);
  }

  bool update(const unsigned char* bytes, DWORD length) {
    return BCRYPT_SUCCESS(BCryptHashData(
      hash_, const_cast<PUCHAR>(bytes), length, 0
    ));
  }

  std::wstring finish() {
    std::array<unsigned char, 32> digest{};
    if (!BCRYPT_SUCCESS(BCryptFinishHash(
      hash_, digest.data(), static_cast<ULONG>(digest.size()), 0
    ))) fail(L"could not finish SHA-256");
    static constexpr wchar_t hex[] = L"0123456789abcdef";
    std::wstring encoded = L"sha256:";
    encoded.reserve(71);
    for (const unsigned char byte : digest) {
      encoded.push_back(hex[byte >> 4]);
      encoded.push_back(hex[byte & 0x0f]);
    }
    return encoded;
  }

 private:
  BCRYPT_ALG_HANDLE algorithm_ = nullptr;
  BCRYPT_HASH_HANDLE hash_ = nullptr;
  DWORD objectLength_ = 0;
  DWORD hashLength_ = 0;
  std::vector<unsigned char> object_;
};

bool verifyFileDigest(const std::wstring& path, const std::wstring& expected) {
  if (!digestShape(expected)) return false;
  HANDLE file = CreateFileW(
    path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN,
    nullptr
  );
  if (file == INVALID_HANDLE_VALUE) return false;
  BY_HANDLE_FILE_INFORMATION information{};
  if (!GetFileInformationByHandle(file, &information)
      || (information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
      || (information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    CloseHandle(file);
    return false;
  }
  Sha256 digest;
  std::array<unsigned char, 64 * 1024> buffer{};
  bool valid = true;
  for (;;) {
    DWORD count = 0;
    if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr)) {
      valid = false;
      break;
    }
    if (count == 0) break;
    if (!digest.update(buffer.data(), count)) {
      valid = false;
      break;
    }
  }
  CloseHandle(file);
  return valid && digest.finish() == expected;
}

std::wstring randomSuffix() {
  std::array<unsigned char, 16> bytes{};
  if (!BCRYPT_SUCCESS(BCryptGenRandom(
    nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
    BCRYPT_USE_SYSTEM_PREFERRED_RNG
  ))) fail(L"could not generate invocation identity");
  static constexpr wchar_t hex[] = L"0123456789abcdef";
  std::wstring result;
  result.reserve(32);
  for (const unsigned char byte : bytes) {
    result.push_back(hex[byte >> 4]);
    result.push_back(hex[byte & 0x0f]);
  }
  return result;
}

void stageArtifact(const std::wstring& expected) {
  if (!digestShape(expected)) fail(L"artifact digest is malformed");
  wchar_t temporary[MAX_PATH + 1]{};
  const DWORD length = GetTempPathW(MAX_PATH, temporary);
  if (length == 0 || length > MAX_PATH) fail(L"could not locate temporary storage");
  invocationRoot = std::wstring(temporary) + L"verify-plugin-" + randomSuffix();
  if (!CreateDirectoryW(invocationRoot.c_str(), nullptr)) {
    fail(L"could not create invocation root");
  }
  artifactPath = invocationRoot + L"\\plugin.mjs";
  HANDLE output = CreateFileW(
    artifactPath.c_str(), GENERIC_WRITE | GENERIC_READ, 0, nullptr, CREATE_NEW,
    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr
  );
  if (output == INVALID_HANDLE_VALUE) fail(L"could not stage artifact");
  if (_setmode(3, _O_BINARY) == -1) {
    CloseHandle(output);
    fail(L"could not configure artifact channel");
  }
  Sha256 digest;
  std::array<unsigned char, 64 * 1024> buffer{};
  std::uint64_t total = 0;
  bool valid = true;
  for (;;) {
    const int count = _read(3, buffer.data(), static_cast<unsigned int>(buffer.size()));
    if (count == 0) break;
    if (count < 0) {
      valid = false;
      break;
    }
    total += static_cast<std::uint64_t>(count);
    if (total > maximumArtifactBytes || !digest.update(buffer.data(), count)) {
      valid = false;
      break;
    }
    DWORD written = 0;
    if (!WriteFile(output, buffer.data(), static_cast<DWORD>(count), &written, nullptr)
        || written != static_cast<DWORD>(count)) {
      valid = false;
      break;
    }
  }
  _close(3);
  if (!FlushFileBuffers(output)) valid = false;
  CloseHandle(output);
  if (total == 0 || !valid || digest.finish() != expected
      || !verifyFileDigest(artifactPath, expected)) {
    fail(L"artifact integrity check failed");
  }
}

PSID appContainerSid() {
  PSID sid = nullptr;
  const HRESULT created = CreateAppContainerProfile(
    appContainerName,
    L"Verify Plugin Runtime",
    L"Deny-by-default provider plugin sandbox",
    nullptr,
    0,
    &sid
  );
  if (created == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
    if (FAILED(DeriveAppContainerSidFromAppContainerName(appContainerName, &sid))) {
      fail(L"could not derive AppContainer identity");
    }
  } else if (FAILED(created)) {
    fail(L"could not create AppContainer profile");
  }
  return sid;
}

void grantReadExecute(const std::wstring& path, PSID sid, bool directory) {
  PACL existing = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  const DWORD readResult = GetNamedSecurityInfoW(
    const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION, nullptr, nullptr, &existing, nullptr, &descriptor
  );
  if (readResult != ERROR_SUCCESS) fail(L"could not read sandbox ACL");
  EXPLICIT_ACCESSW access{};
  access.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
  access.grfAccessMode = SET_ACCESS;
  access.grfInheritance = directory
    ? CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
    : NO_INHERITANCE;
  access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  access.Trustee.ptstrName = static_cast<LPWSTR>(sid);
  PACL updated = nullptr;
  const DWORD mergeResult = SetEntriesInAclW(1, &access, existing, &updated);
  if (mergeResult != ERROR_SUCCESS) {
    LocalFree(descriptor);
    fail(L"could not build sandbox ACL");
  }
  const DWORD writeResult = SetNamedSecurityInfoW(
    const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION, nullptr, nullptr, updated, nullptr
  );
  LocalFree(updated);
  LocalFree(descriptor);
  if (writeResult != ERROR_SUCCESS) fail(L"could not grant sandbox access");
}

PSECURITY_DESCRIPTOR protocolSecurityDescriptor(PSID appContainer) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    fail(L"could not inspect protocol owner");
  }
  DWORD required = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &required);
  std::vector<unsigned char> tokenBytes(required);
  if (required == 0 || !GetTokenInformation(
      token, TokenUser, tokenBytes.data(), required, &required
    )) {
    CloseHandle(token);
    fail(L"could not read protocol owner");
  }
  CloseHandle(token);
  const auto* user = reinterpret_cast<const TOKEN_USER*>(tokenBytes.data());
  LPWSTR userText = nullptr;
  LPWSTR appContainerText = nullptr;
  if (!ConvertSidToStringSidW(user->User.Sid, &userText)
      || !ConvertSidToStringSidW(appContainer, &appContainerText)) {
    if (userText != nullptr) LocalFree(userText);
    fail(L"could not encode protocol identities");
  }
  const std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;"
    + std::wstring(userText)
    + L")(A;;GRGW;;;" + std::wstring(appContainerText) + L")";
  LocalFree(userText);
  LocalFree(appContainerText);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
      sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr
    )) fail(L"could not create protocol security descriptor");
  return descriptor;
}

struct PipeBridge {
  HANDLE source;
  HANDLE target;
  bool closeTarget;
  const wchar_t* name;
};

DWORD WINAPI bridgePipe(LPVOID raw) {
  const auto* bridge = static_cast<PipeBridge*>(raw);
  std::array<unsigned char, 64 * 1024> buffer{};
  for (;;) {
    DWORD count = 0;
    if (!ReadFile(
        bridge->source, buffer.data(), static_cast<DWORD>(buffer.size()),
        &count, nullptr
      ) || count == 0) break;
    fwprintf(
      stderr,
      L"verify-plugin-windows-host: bridge %ls read %lu bytes\n",
      bridge->name,
      static_cast<unsigned long>(count)
    );
    DWORD offset = 0;
    while (offset < count) {
      DWORD written = 0;
      if (!WriteFile(
          bridge->target, buffer.data() + offset, count - offset,
          &written, nullptr
        ) || written == 0) {
        offset = count;
        count = 0;
        break;
      }
      offset += written;
    }
    if (count == 0) break;
  }
  if (bridge->closeTarget) CloseHandle(bridge->target);
  fwprintf(
    stderr,
    L"verify-plugin-windows-host: bridge %ls closed\n",
    bridge->name
  );
  return 0;
}

std::wstring quoteArgument(const std::wstring& value) {
  if (value.find_first_of(L" \t\n\v\"") == std::wstring::npos) return value;
  std::wstring result = L"\"";
  std::size_t slashes = 0;
  for (const wchar_t byte : value) {
    if (byte == L'\\') {
      slashes += 1;
      continue;
    }
    if (byte == L'\"') {
      result.append(slashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      slashes = 0;
      continue;
    }
    result.append(slashes, L'\\');
    slashes = 0;
    result.push_back(byte);
  }
  result.append(slashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

void configureJob(std::uint64_t maximumMemoryBytes, std::uint64_t maximumCpuNanoseconds) {
  sandboxJob = CreateJobObjectW(nullptr, nullptr);
  if (sandboxJob == nullptr) fail(L"could not create resource job");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags =
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
    | JOB_OBJECT_LIMIT_PROCESS_TIME
    | JOB_OBJECT_LIMIT_JOB_MEMORY;
  limits.BasicLimitInformation.ActiveProcessLimit = 1;
  limits.BasicLimitInformation.PerProcessUserTimeLimit.QuadPart =
    static_cast<LONGLONG>(maximumCpuNanoseconds / 100ULL);
  limits.JobMemoryLimit = static_cast<SIZE_T>(maximumMemoryBytes);
  if (!SetInformationJobObject(
    sandboxJob, JobObjectExtendedLimitInformation, &limits, sizeof(limits)
  )) fail(L"could not set resource limits");
}

bool resourceLimitReached(
  std::uint64_t maximumMemoryBytes,
  std::uint64_t maximumCpuNanoseconds
) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(
      sandboxJob, JobObjectExtendedLimitInformation,
      &limits, sizeof(limits), nullptr
    ) || !QueryInformationJobObject(
      sandboxJob, JobObjectBasicAccountingInformation,
      &accounting, sizeof(accounting), nullptr
    )) return false;
  const std::uint64_t cpuNanoseconds =
    static_cast<std::uint64_t>(accounting.TotalUserTime.QuadPart) * 100ULL;
  const std::uint64_t memoryMargin = std::min<std::uint64_t>(
    16ULL * 1024ULL * 1024ULL, maximumMemoryBytes / 16ULL
  );
  return cpuNanoseconds >= maximumCpuNanoseconds
    || static_cast<std::uint64_t>(limits.PeakJobMemoryUsed)
      >= maximumMemoryBytes - memoryMargin;
}

int launchSandbox(
  const std::wstring& node,
  PSID sid,
  std::uint64_t maximumMemoryBytes,
  std::uint64_t maximumCpuNanoseconds
) {
  SECURITY_CAPABILITIES capabilities{};
  capabilities.AppContainerSid = sid;
  DWORD childPolicy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
  SECURITY_ATTRIBUTES pipeSecurity{};
  pipeSecurity.nLength = sizeof(pipeSecurity);
  pipeSecurity.bInheritHandle = TRUE;
  pipeSecurity.lpSecurityDescriptor = protocolSecurityDescriptor(sid);
  HANDLE childStdin = nullptr;
  HANDLE hostStdin = nullptr;
  HANDLE hostStdout = nullptr;
  HANDLE childStdout = nullptr;
  HANDLE hostStderr = nullptr;
  HANDLE childStderr = nullptr;
  if (!CreatePipe(&childStdin, &hostStdin, &pipeSecurity, 0)
      || !CreatePipe(&hostStdout, &childStdout, &pipeSecurity, 0)
      || !CreatePipe(&hostStderr, &childStderr, &pipeSecurity, 0)
      || !SetHandleInformation(hostStdin, HANDLE_FLAG_INHERIT, 0)
      || !SetHandleInformation(hostStdout, HANDLE_FLAG_INHERIT, 0)
      || !SetHandleInformation(hostStderr, HANDLE_FLAG_INHERIT, 0)) {
    LocalFree(pipeSecurity.lpSecurityDescriptor);
    fail(L"could not create private protocol pipes");
  }
  LocalFree(pipeSecurity.lpSecurityDescriptor);
  std::array<HANDLE, 3> protocolHandles = {
    childStdin,
    childStdout,
    childStderr,
  };
  for (const HANDLE handle : protocolHandles) {
    if (handle == nullptr || handle == INVALID_HANDLE_VALUE
        || !SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
      fail(L"could not secure protocol handle inheritance");
    }
  }
  SIZE_T attributeBytes = 0;
  InitializeProcThreadAttributeList(nullptr, 3, 0, &attributeBytes);
  auto* attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
    HeapAlloc(GetProcessHeap(), 0, attributeBytes)
  );
  if (attributes == nullptr
      || !InitializeProcThreadAttributeList(attributes, 3, 0, &attributeBytes)) {
    fail(L"could not initialize process attributes");
  }
  if (!UpdateProcThreadAttribute(
      attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
      &capabilities, sizeof(capabilities), nullptr, nullptr
    ) || !UpdateProcThreadAttribute(
      attributes, 0, PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,
      &childPolicy, sizeof(childPolicy), nullptr, nullptr
    ) || !UpdateProcThreadAttribute(
      attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
      protocolHandles.data(), sizeof(protocolHandles), nullptr, nullptr
    )) {
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    fail(L"could not apply process isolation");
  }
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = protocolHandles[0];
  startup.StartupInfo.hStdOutput = protocolHandles[1];
  startup.StartupInfo.hStdError = protocolHandles[2];
  startup.lpAttributeList = attributes;
  const std::wstring command = quoteArgument(node)
    + L" --disable-proto=throw --preserve-symlinks --preserve-symlinks-main "
    + quoteArgument(artifactPath);
  std::vector<wchar_t> commandLine(command.begin(), command.end());
  commandLine.push_back(L'\0');
  wchar_t windowsDirectory[MAX_PATH + 1]{};
  const UINT windowsDirectoryLength = GetWindowsDirectoryW(
    windowsDirectory, MAX_PATH
  );
  if (windowsDirectoryLength == 0 || windowsDirectoryLength > MAX_PATH) {
    fail(L"could not construct sandbox environment");
  }
  const std::wstring systemRoot(windowsDirectory, windowsDirectoryLength);
  const std::wstring systemDrive = systemRoot.size() >= 2
    ? systemRoot.substr(0, 2)
    : L"C:";
  const std::wstring invocationDrive = invocationRoot.size() >= 2
    && invocationRoot[1] == L':'
    ? invocationRoot.substr(0, 2)
    : systemDrive;
  LPWSTR sidText = nullptr;
  if (!ConvertSidToStringSidW(sid, &sidText)) {
    fail(L"could not encode AppContainer identity");
  }
  PWSTR profileText = nullptr;
  const HRESULT profileResult = GetAppContainerFolderPath(sidText, &profileText);
  LocalFree(sidText);
  if (FAILED(profileResult) || profileText == nullptr) {
    fail(L"could not locate AppContainer profile");
  }
  const std::wstring profile(profileText);
  CoTaskMemFree(profileText);
  const std::wstring profileTemp = profile + L"\\Temp";
  std::wstring environment = L"=" + invocationDrive + L"=" + invocationRoot;
  environment.push_back(L'\0');
  environment += L"LOCALAPPDATA=" + profile;
  environment.push_back(L'\0');
  environment += L"SystemDrive=" + systemDrive;
  environment.push_back(L'\0');
  environment += L"SystemRoot=" + systemRoot;
  environment.push_back(L'\0');
  environment += L"TEMP=" + profileTemp;
  environment.push_back(L'\0');
  environment += L"TMP=" + profileTemp;
  environment.push_back(L'\0');
  environment += L"WINDIR=" + systemRoot;
  environment.push_back(L'\0');
  environment.push_back(L'\0');
  PROCESS_INFORMATION process{};
  const BOOL created = CreateProcessW(
    node.c_str(), commandLine.data(), nullptr, nullptr, TRUE,
    EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
    environment.data(), invocationRoot.c_str(), &startup.StartupInfo, &process
  );
  DeleteProcThreadAttributeList(attributes);
  HeapFree(GetProcessHeap(), 0, attributes);
  if (!created) fail(L"could not launch AppContainer process");
  CloseHandle(childStdin);
  CloseHandle(childStdout);
  CloseHandle(childStderr);
  PipeBridge inputBridge{
    GetStdHandle(STD_INPUT_HANDLE), hostStdin, true, L"stdin"
  };
  PipeBridge outputBridge{
    hostStdout, GetStdHandle(STD_OUTPUT_HANDLE), false, L"stdout"
  };
  PipeBridge errorBridge{
    hostStderr, GetStdHandle(STD_ERROR_HANDLE), false, L"stderr"
  };
  HANDLE bridgeThreads[3] = {
    CreateThread(nullptr, 0, bridgePipe, &inputBridge, 0, nullptr),
    CreateThread(nullptr, 0, bridgePipe, &outputBridge, 0, nullptr),
    CreateThread(nullptr, 0, bridgePipe, &errorBridge, 0, nullptr),
  };
  if (bridgeThreads[0] == nullptr
      || bridgeThreads[1] == nullptr
      || bridgeThreads[2] == nullptr) {
    TerminateProcess(process.hProcess, 126);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    fail(L"could not bridge sandbox protocol");
  }
  if (!AssignProcessToJobObject(sandboxJob, process.hProcess)) {
    TerminateProcess(process.hProcess, 126);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    fail(L"could not assign AppContainer resource limits");
  }
  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    TerminateJobObject(sandboxJob, 126);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    fail(L"could not start AppContainer process");
  }
  CloseHandle(process.hThread);
  for (;;) {
    const DWORD state = WaitForSingleObject(process.hProcess, 20);
    if (state == WAIT_OBJECT_0) break;
    if (state == WAIT_FAILED) {
      TerminateJobObject(sandboxJob, 126);
      CloseHandle(process.hProcess);
      fail(L"could not supervise AppContainer process");
    }
    if (resourceLimitReached(maximumMemoryBytes, maximumCpuNanoseconds)) {
      TerminateJobObject(sandboxJob, 125);
      WaitForSingleObject(process.hProcess, 5000);
      CloseHandle(process.hProcess);
      WaitForMultipleObjects(2, &bridgeThreads[1], TRUE, 1000);
      for (const HANDLE thread : bridgeThreads) CloseHandle(thread);
      return 125;
    }
  }
  DWORD exitCode = 126;
  if (!GetExitCodeProcess(process.hProcess, &exitCode)) exitCode = 126;
  const bool exhausted = resourceLimitReached(
    maximumMemoryBytes, maximumCpuNanoseconds
  );
  CloseHandle(process.hProcess);
  WaitForMultipleObjects(2, &bridgeThreads[1], TRUE, 1000);
  for (const HANDLE thread : bridgeThreads) CloseHandle(thread);
  return exhausted ? 125 : static_cast<int>(exitCode);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  std::wstring expectedArtifact;
  std::wstring node;
  std::wstring expectedNode;
  std::uint64_t maximumMemoryBytes = 0;
  std::uint64_t maximumCpuNanoseconds = 0;
  for (int index = 1; index + 1 < argc; index += 2) {
    const std::wstring key = argv[index];
    const wchar_t* value = argv[index + 1];
    if (key == L"--artifact-digest") expectedArtifact = value;
    else if (key == L"--node") node = value;
    else if (key == L"--node-digest") expectedNode = value;
    else if (key == L"--maximum-memory-bytes") {
      if (!parseUnsigned(value, maximumMemoryBytes)) fail(L"memory limit is invalid");
    } else if (key == L"--maximum-cpu-nanoseconds") {
      if (!parseUnsigned(value, maximumCpuNanoseconds)) fail(L"CPU limit is invalid");
    } else fail(L"unknown argument");
  }
  if (
    argc != 11
    || node.empty()
    || maximumMemoryBytes < 64ULL * 1024ULL * 1024ULL
    || maximumCpuNanoseconds < 1'000'000'000ULL
    || !verifyFileDigest(node, expectedNode)
  ) fail(L"sandbox configuration or Node identity is invalid");
  stageArtifact(expectedArtifact);
  PSID sid = appContainerSid();
  grantReadExecute(node, sid, false);
  grantReadExecute(invocationRoot, sid, true);
  grantReadExecute(artifactPath, sid, false);
  configureJob(maximumMemoryBytes, maximumCpuNanoseconds);
  const int status = launchSandbox(
    node, sid, maximumMemoryBytes, maximumCpuNanoseconds
  );
  FreeSid(sid);
  cleanup();
  return status;
}
