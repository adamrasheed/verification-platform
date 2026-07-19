#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sched.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define VERIFY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define VERIFY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#error "VerifyPluginSeccomp supports only x86_64 and aarch64"
#endif

#define VERIFY_DENY(errno_value) \
  (SECCOMP_RET_ERRNO | ((errno_value) & SECCOMP_RET_DATA))
#define APPEND(statement) filters[length++] = (struct sock_filter)statement
#define DENY_SYSCALL(number, error_number)                                      \
  do {                                                                          \
    APPEND(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (number), 0, 1));               \
    APPEND(BPF_STMT(BPF_RET | BPF_K, VERIFY_DENY(error_number)));               \
  } while (0)

__attribute__((constructor))
static void install_verify_plugin_filter(void) {
  struct sock_filter filters[192];
  size_t length = 0;

  unsetenv("LD_PRELOAD");
  unsetenv("PWD");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) _exit(126);

  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, arch)
  ));
  APPEND(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, VERIFY_AUDIT_ARCH, 1, 0));
  APPEND(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, nr)
  ));

#ifdef __NR_execve
  DENY_SYSCALL(__NR_execve, EPERM);
#endif
#ifdef __NR_execveat
  DENY_SYSCALL(__NR_execveat, EPERM);
#endif
#ifdef __NR_fork
  DENY_SYSCALL(__NR_fork, EPERM);
#endif
#ifdef __NR_vfork
  DENY_SYSCALL(__NR_vfork, EPERM);
#endif
#ifdef __NR_clone3
  DENY_SYSCALL(__NR_clone3, ENOSYS);
#endif
#ifdef __NR_socket
  DENY_SYSCALL(__NR_socket, EPERM);
#endif
#ifdef __NR_connect
  DENY_SYSCALL(__NR_connect, EPERM);
#endif
#ifdef __NR_bind
  DENY_SYSCALL(__NR_bind, EPERM);
#endif
#ifdef __NR_listen
  DENY_SYSCALL(__NR_listen, EPERM);
#endif
#ifdef __NR_accept
  DENY_SYSCALL(__NR_accept, EPERM);
#endif
#ifdef __NR_accept4
  DENY_SYSCALL(__NR_accept4, EPERM);
#endif
#ifdef __NR_ptrace
  DENY_SYSCALL(__NR_ptrace, EPERM);
#endif
#ifdef __NR_process_vm_readv
  DENY_SYSCALL(__NR_process_vm_readv, EPERM);
#endif
#ifdef __NR_process_vm_writev
  DENY_SYSCALL(__NR_process_vm_writev, EPERM);
#endif
#ifdef __NR_mount
  DENY_SYSCALL(__NR_mount, EPERM);
#endif
#ifdef __NR_umount2
  DENY_SYSCALL(__NR_umount2, EPERM);
#endif
#ifdef __NR_pivot_root
  DENY_SYSCALL(__NR_pivot_root, EPERM);
#endif
#ifdef __NR_chroot
  DENY_SYSCALL(__NR_chroot, EPERM);
#endif
#ifdef __NR_unshare
  DENY_SYSCALL(__NR_unshare, EPERM);
#endif
#ifdef __NR_setns
  DENY_SYSCALL(__NR_setns, EPERM);
#endif
#ifdef __NR_bpf
  DENY_SYSCALL(__NR_bpf, EPERM);
#endif
#ifdef __NR_perf_event_open
  DENY_SYSCALL(__NR_perf_event_open, EPERM);
#endif
#ifdef __NR_userfaultfd
  DENY_SYSCALL(__NR_userfaultfd, EPERM);
#endif
#ifdef __NR_io_uring_setup
  DENY_SYSCALL(__NR_io_uring_setup, EPERM);
#endif
#ifdef __NR_keyctl
  DENY_SYSCALL(__NR_keyctl, EPERM);
#endif
#ifdef __NR_add_key
  DENY_SYSCALL(__NR_add_key, EPERM);
#endif
#ifdef __NR_request_key
  DENY_SYSCALL(__NR_request_key, EPERM);
#endif
#ifdef __NR_open_by_handle_at
  DENY_SYSCALL(__NR_open_by_handle_at, EPERM);
#endif
#ifdef __NR_name_to_handle_at
  DENY_SYSCALL(__NR_name_to_handle_at, EPERM);
#endif
#ifdef __NR_reboot
  DENY_SYSCALL(__NR_reboot, EPERM);
#endif
#ifdef __NR_kexec_load
  DENY_SYSCALL(__NR_kexec_load, EPERM);
#endif
#ifdef __NR_finit_module
  DENY_SYSCALL(__NR_finit_module, EPERM);
#endif
#ifdef __NR_init_module
  DENY_SYSCALL(__NR_init_module, EPERM);
#endif
#ifdef __NR_delete_module
  DENY_SYSCALL(__NR_delete_module, EPERM);
#endif

#ifdef __NR_clone
  APPEND(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 3));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, args[0])
  ));
  APPEND(BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_THREAD, 1, 0));
  APPEND(BPF_STMT(BPF_RET | BPF_K, VERIFY_DENY(EPERM)));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, nr)
  ));
#endif

#ifdef __NR_open
  APPEND(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_open, 0, 4));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, args[1])
  ));
  APPEND(BPF_JUMP(
    BPF_JMP | BPF_JSET | BPF_K,
    O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND,
    0,
    1
  ));
  APPEND(BPF_STMT(BPF_RET | BPF_K, VERIFY_DENY(EPERM)));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, nr)
  ));
#endif
#ifdef __NR_openat
  APPEND(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat, 0, 4));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, args[2])
  ));
  APPEND(BPF_JUMP(
    BPF_JMP | BPF_JSET | BPF_K,
    O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND,
    0,
    1
  ));
  APPEND(BPF_STMT(BPF_RET | BPF_K, VERIFY_DENY(EPERM)));
  APPEND(BPF_STMT(
    BPF_LD | BPF_W | BPF_ABS,
    (unsigned int)offsetof(struct seccomp_data, nr)
  ));
#endif
#ifdef __NR_openat2
  DENY_SYSCALL(__NR_openat2, EPERM);
#endif
#ifdef __NR_creat
  DENY_SYSCALL(__NR_creat, EPERM);
#endif
#ifdef __NR_truncate
  DENY_SYSCALL(__NR_truncate, EPERM);
#endif
#ifdef __NR_ftruncate
  DENY_SYSCALL(__NR_ftruncate, EPERM);
#endif
#ifdef __NR_mkdir
  DENY_SYSCALL(__NR_mkdir, EPERM);
#endif
#ifdef __NR_mkdirat
  DENY_SYSCALL(__NR_mkdirat, EPERM);
#endif
#ifdef __NR_unlink
  DENY_SYSCALL(__NR_unlink, EPERM);
#endif
#ifdef __NR_unlinkat
  DENY_SYSCALL(__NR_unlinkat, EPERM);
#endif
#ifdef __NR_rename
  DENY_SYSCALL(__NR_rename, EPERM);
#endif
#ifdef __NR_renameat
  DENY_SYSCALL(__NR_renameat, EPERM);
#endif
#ifdef __NR_renameat2
  DENY_SYSCALL(__NR_renameat2, EPERM);
#endif
#ifdef __NR_link
  DENY_SYSCALL(__NR_link, EPERM);
#endif
#ifdef __NR_linkat
  DENY_SYSCALL(__NR_linkat, EPERM);
#endif
#ifdef __NR_symlink
  DENY_SYSCALL(__NR_symlink, EPERM);
#endif
#ifdef __NR_symlinkat
  DENY_SYSCALL(__NR_symlinkat, EPERM);
#endif
#ifdef __NR_mknod
  DENY_SYSCALL(__NR_mknod, EPERM);
#endif
#ifdef __NR_mknodat
  DENY_SYSCALL(__NR_mknodat, EPERM);
#endif
  APPEND(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  struct sock_fprog program = {
    .len = (unsigned short)length,
    .filter = filters,
  };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) _exit(126);
}
