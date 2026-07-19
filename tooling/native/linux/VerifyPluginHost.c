#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <openssl/evp.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static const size_t maximum_artifact_bytes = 16U * 1024U * 1024U;
static pid_t sandbox_process = 0;
static pid_t plugin_process = 0;
static volatile sig_atomic_t requested_termination = 0;
static char invocation_root[128] = "";
static char artifact_path[160] = "";

static void cleanup(void) {
  if (artifact_path[0] != '\0') unlink(artifact_path);
  if (invocation_root[0] != '\0') rmdir(invocation_root);
}

static void fail(const char *message, int status) {
  fprintf(stderr, "verify-plugin-linux-host: %s\n", message);
  cleanup();
  exit(status);
}

static void request_termination(int signal_number) {
  requested_termination = signal_number;
}

static bool parse_unsigned(const char *value, uint64_t *result) {
  if (value == NULL || value[0] == '\0') return false;
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return false;
  *result = (uint64_t)parsed;
  return true;
}

static bool digest_shape(const char *value) {
  if (value == NULL || strlen(value) != 71U || strncmp(value, "sha256:", 7U) != 0) {
    return false;
  }
  for (size_t index = 7U; index < 71U; index += 1U) {
    const char byte = value[index];
    if (!((byte >= '0' && byte <= '9') || (byte >= 'a' && byte <= 'f'))) return false;
  }
  return true;
}

static bool digest_context_finish(EVP_MD_CTX *context, const char *expected) {
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int length = 0;
  if (
    EVP_DigestFinal_ex(context, digest, &length) != 1
    || length != 32U
  ) return false;
  char encoded[72];
  memcpy(encoded, "sha256:", 7U);
  for (size_t index = 0; index < 32U; index += 1U) {
    snprintf(&encoded[7U + index * 2U], 3U, "%02x", digest[index]);
  }
  encoded[71] = '\0';
  return strcmp(encoded, expected) == 0;
}

static bool verify_file_digest(const char *path, const char *expected) {
  if (!digest_shape(expected)) return false;
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return false;
  struct stat information;
  if (
    fstat(descriptor, &information) != 0
    || !S_ISREG(information.st_mode)
    || (information.st_mode & (S_IWGRP | S_IWOTH)) != 0
  ) {
    close(descriptor);
    return false;
  }
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL || EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) {
    EVP_MD_CTX_free(context);
    close(descriptor);
    return false;
  }
  unsigned char buffer[64U * 1024U];
  bool valid = true;
  for (;;) {
    ssize_t count = read(descriptor, buffer, sizeof(buffer));
    if (count == 0) break;
    if (count < 0) {
      if (errno == EINTR) continue;
      valid = false;
      break;
    }
    if (EVP_DigestUpdate(context, buffer, (size_t)count) != 1) {
      valid = false;
      break;
    }
  }
  if (close(descriptor) != 0) valid = false;
  if (valid) valid = digest_context_finish(context, expected);
  EVP_MD_CTX_free(context);
  return valid;
}

static void stage_artifact(const char *expected) {
  if (!digest_shape(expected)) fail("artifact digest is malformed", 126);
  snprintf(invocation_root, sizeof(invocation_root), "/tmp/verify-plugin-XXXXXX");
  if (mkdtemp(invocation_root) == NULL) fail("could not create invocation root", 126);
  if (chmod(invocation_root, S_IRWXU) != 0) fail("could not secure invocation root", 126);
  snprintf(artifact_path, sizeof(artifact_path), "%s/plugin.mjs", invocation_root);
  int output = open(
    artifact_path,
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    S_IRUSR | S_IXUSR
  );
  if (output < 0) fail("could not stage the artifact", 126);

  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL || EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) {
    EVP_MD_CTX_free(context);
    close(output);
    fail("could not initialize artifact integrity", 126);
  }
  unsigned char buffer[64U * 1024U];
  size_t total = 0;
  bool valid = true;
  for (;;) {
    ssize_t count = read(3, buffer, sizeof(buffer));
    if (count == 0) break;
    if (count < 0) {
      if (errno == EINTR) continue;
      valid = false;
      break;
    }
    total += (size_t)count;
    if (
      total > maximum_artifact_bytes
      || EVP_DigestUpdate(context, buffer, (size_t)count) != 1
    ) {
      valid = false;
      break;
    }
    size_t offset = 0;
    while (offset < (size_t)count) {
      ssize_t written = write(output, buffer + offset, (size_t)count - offset);
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) {
        valid = false;
        break;
      }
      offset += (size_t)written;
    }
    if (!valid) break;
  }
  close(3);
  if (fsync(output) != 0 || close(output) != 0) valid = false;
  if (total == 0U) valid = false;
  if (valid) valid = digest_context_finish(context, expected);
  EVP_MD_CTX_free(context);
  if (!valid || !verify_file_digest(artifact_path, expected)) {
    fail("artifact integrity check failed", 126);
  }
}

static void add_argument(char **arguments, size_t *count, char *value) {
  if (*count >= 79U) fail("sandbox argument bound exceeded", 126);
  arguments[(*count)++] = value;
}

static pid_t parse_child_pid(const char *value) {
  const char *field = strstr(value, "\"child-pid\"");
  if (field == NULL) return 0;
  field = strchr(field, ':');
  if (field == NULL) return 0;
  field += 1;
  while (*field == ' ' || *field == '\t') field += 1;
  errno = 0;
  char *end = NULL;
  long parsed = strtol(field, &end, 10);
  if (errno != 0 || end == field || parsed <= 0 || parsed > INT32_MAX) return 0;
  return (pid_t)parsed;
}

static pid_t read_plugin_pid(int descriptor) {
  int flags = fcntl(descriptor, F_GETFL);
  if (flags < 0 || fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) != 0) return 0;
  char buffer[2048];
  size_t length = 0;
  const int maximum_attempts = 50;
  for (int attempt = 0; attempt < maximum_attempts; attempt += 1) {
    struct pollfd request = {
      .fd = descriptor,
      .events = POLLIN | POLLHUP,
      .revents = 0,
    };
    int ready = poll(&request, 1U, 100);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) return 0;
    if (ready == 0) continue;
    for (;;) {
      ssize_t count = read(descriptor, buffer + length, sizeof(buffer) - length - 1U);
      if (count > 0) {
        length += (size_t)count;
        buffer[length] = '\0';
        pid_t parsed = parse_child_pid(buffer);
        if (parsed > 0) return parsed;
        if (length + 1U >= sizeof(buffer)) return 0;
        continue;
      }
      if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
      if (count < 0 && errno == EINTR) continue;
      return 0;
    }
  }
  return 0;
}

static bool read_usage(
  pid_t identifier,
  uint64_t *resident_bytes,
  uint64_t *cpu_nanoseconds
) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/%ld/status", (long)identifier);
  FILE *status = fopen(path, "re");
  if (status == NULL) return false;
  char line[512];
  uint64_t resident_kibibytes = 0;
  while (fgets(line, sizeof(line), status) != NULL) {
    if (sscanf(line, "VmRSS: %" SCNu64 " kB", &resident_kibibytes) == 1) break;
  }
  fclose(status);
  if (resident_kibibytes == 0U) return false;

  snprintf(path, sizeof(path), "/proc/%ld/stat", (long)identifier);
  FILE *stat_file = fopen(path, "re");
  if (stat_file == NULL || fgets(line, sizeof(line), stat_file) == NULL) {
    if (stat_file != NULL) fclose(stat_file);
    return false;
  }
  fclose(stat_file);
  char *fields = strrchr(line, ')');
  if (fields == NULL || fields[1] != ' ') return false;
  fields += 2;
  char *save = NULL;
  char *token = strtok_r(fields, " ", &save);
  int field_number = 3;
  uint64_t user_ticks = 0;
  uint64_t system_ticks = 0;
  while (token != NULL) {
    if (field_number == 14) user_ticks = strtoull(token, NULL, 10);
    if (field_number == 15) {
      system_ticks = strtoull(token, NULL, 10);
      break;
    }
    token = strtok_r(NULL, " ", &save);
    field_number += 1;
  }
  long ticks_per_second = sysconf(_SC_CLK_TCK);
  if (ticks_per_second <= 0) return false;
  const uint64_t total_ticks = user_ticks + system_ticks;
  *resident_bytes = resident_kibibytes * 1024U;
  *cpu_nanoseconds =
    (total_ticks / (uint64_t)ticks_per_second) * 1000000000U
    + ((total_ticks % (uint64_t)ticks_per_second) * 1000000000U)
      / (uint64_t)ticks_per_second;
  return true;
}

static int propagated_status(int status) {
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    raise(WTERMSIG(status));
    return 128 + WTERMSIG(status);
  }
  return 126;
}

int main(int argument_count, char **argument_values) {
  if (
    argument_count != 19
    || strcmp(argument_values[1], "--artifact-digest") != 0
    || strcmp(argument_values[3], "--node") != 0
    || strcmp(argument_values[5], "--node-digest") != 0
    || strcmp(argument_values[7], "--bubblewrap") != 0
    || strcmp(argument_values[9], "--bubblewrap-digest") != 0
    || strcmp(argument_values[11], "--seccomp-library") != 0
    || strcmp(argument_values[13], "--seccomp-library-digest") != 0
    || strcmp(argument_values[15], "--maximum-memory-bytes") != 0
    || strcmp(argument_values[17], "--maximum-cpu-nanoseconds") != 0
  ) fail("sandbox arguments are missing or invalid", 126);

  uint64_t maximum_memory_bytes = 0;
  uint64_t maximum_cpu_nanoseconds = 0;
  if (
    !parse_unsigned(argument_values[16], &maximum_memory_bytes)
    || maximum_memory_bytes < 64U * 1024U * 1024U
    || !parse_unsigned(argument_values[18], &maximum_cpu_nanoseconds)
    || maximum_cpu_nanoseconds < 1000000000U
  ) fail("resource limits are invalid", 126);
  if (
    !verify_file_digest(argument_values[4], argument_values[6])
    || !verify_file_digest(argument_values[8], argument_values[10])
    || !verify_file_digest(argument_values[12], argument_values[14])
  ) fail("sandbox dependency identity mismatch", 126);
  stage_artifact(argument_values[2]);

  int information_pipe[2];
  if (pipe2(information_pipe, O_CLOEXEC) != 0) fail("could not create PID channel", 126);
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    close(information_pipe[0]);
    close(information_pipe[1]);
    fail("could not initialize sandbox launch", 126);
  }
  if (
    posix_spawn_file_actions_addclose(&actions, information_pipe[0]) != 0
    || posix_spawn_file_actions_adddup2(&actions, information_pipe[1], 9) != 0
    || (information_pipe[1] != 9
      && posix_spawn_file_actions_addclose(&actions, information_pipe[1]) != 0)
  ) {
    posix_spawn_file_actions_destroy(&actions);
    close(information_pipe[0]);
    close(information_pipe[1]);
    fail("could not configure sandbox launch", 126);
  }

  char *sandbox_arguments[80];
  size_t sandbox_argument_count = 0;
  add_argument(sandbox_arguments, &sandbox_argument_count, argument_values[8]);
  add_argument(sandbox_arguments, &sandbox_argument_count, "--unshare-all");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--die-with-parent");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--as-pid-1");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--new-session");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--uid");
  add_argument(sandbox_arguments, &sandbox_argument_count, "0");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--gid");
  add_argument(sandbox_arguments, &sandbox_argument_count, "0");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--tmpfs");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
  add_argument(sandbox_arguments, &sandbox_argument_count, argument_values[4]);
  add_argument(sandbox_arguments, &sandbox_argument_count, "/node");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
  add_argument(sandbox_arguments, &sandbox_argument_count, artifact_path);
  add_argument(sandbox_arguments, &sandbox_argument_count, "/plugin.mjs");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
  add_argument(sandbox_arguments, &sandbox_argument_count, argument_values[12]);
  add_argument(sandbox_arguments, &sandbox_argument_count, "/verify-seccomp.so");
  if (access("/lib", R_OK | X_OK) == 0) {
    add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/lib");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/lib");
  }
  if (access("/lib64", R_OK | X_OK) == 0) {
    add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/lib64");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/lib64");
  }
  if (access("/usr/lib", R_OK | X_OK) == 0) {
    add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/usr/lib");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/usr/lib");
  }
  if (access("/usr/lib64", R_OK | X_OK) == 0) {
    add_argument(sandbox_arguments, &sandbox_argument_count, "--ro-bind");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/usr/lib64");
    add_argument(sandbox_arguments, &sandbox_argument_count, "/usr/lib64");
  }
  add_argument(sandbox_arguments, &sandbox_argument_count, "--proc");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/proc");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--dev");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/dev");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--chdir");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--clearenv");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--setenv");
  add_argument(sandbox_arguments, &sandbox_argument_count, "LD_PRELOAD");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/verify-seccomp.so");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--info-fd");
  add_argument(sandbox_arguments, &sandbox_argument_count, "9");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/node");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--permission");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--disable-proto=throw");
  add_argument(sandbox_arguments, &sandbox_argument_count, "--allow-fs-read=/plugin.mjs");
  add_argument(sandbox_arguments, &sandbox_argument_count, "/plugin.mjs");
  sandbox_arguments[sandbox_argument_count] = NULL;

  char *empty_environment[] = {NULL};
  int spawn_result = posix_spawn(
    &sandbox_process,
    argument_values[8],
    &actions,
    NULL,
    sandbox_arguments,
    empty_environment
  );
  posix_spawn_file_actions_destroy(&actions);
  close(information_pipe[1]);
  if (spawn_result != 0) {
    close(information_pipe[0]);
    fail("could not launch bubblewrap sandbox", 126);
  }
  plugin_process = read_plugin_pid(information_pipe[0]);
  close(information_pipe[0]);
  if (plugin_process <= 0) {
    kill(sandbox_process, SIGKILL);
    waitpid(sandbox_process, NULL, 0);
    fail("sandbox did not identify the plugin process", 126);
  }

  signal(SIGTERM, request_termination);
  signal(SIGINT, request_termination);
  signal(SIGHUP, request_termination);
  int sandbox_status = 0;
  for (;;) {
    if (requested_termination != 0) {
      kill(plugin_process, SIGKILL);
      kill(sandbox_process, SIGKILL);
      while (waitpid(sandbox_process, NULL, 0) < 0 && errno == EINTR) {}
      cleanup();
      return 128 + requested_termination;
    }
    pid_t wait_result = waitpid(sandbox_process, &sandbox_status, WNOHANG);
    if (wait_result == sandbox_process) break;
    if (wait_result < 0) {
      kill(plugin_process, SIGKILL);
      fail("could not supervise the sandbox", 126);
    }
    uint64_t resident_bytes = 0;
    uint64_t cpu_nanoseconds = 0;
    if (!read_usage(plugin_process, &resident_bytes, &cpu_nanoseconds)) {
      if (kill(plugin_process, 0) != 0 && errno == ESRCH) {
        struct timespec delay = {.tv_sec = 0, .tv_nsec = 25000000};
        nanosleep(&delay, NULL);
        continue;
      }
      kill(plugin_process, SIGKILL);
      kill(sandbox_process, SIGKILL);
      waitpid(sandbox_process, NULL, 0);
      fail("resource inspection failed closed", 126);
    }
    if (
      resident_bytes > maximum_memory_bytes
      || cpu_nanoseconds > maximum_cpu_nanoseconds
    ) {
      kill(plugin_process, SIGKILL);
      kill(sandbox_process, SIGKILL);
      waitpid(sandbox_process, NULL, 0);
      fail("VFY_PLUGIN_RESOURCE_EXHAUSTED", 125);
    }
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 25000000};
    nanosleep(&delay, NULL);
  }
  cleanup();
  return propagated_status(sandbox_status);
}
