# NFS master-image bootstrap

Build a Debian NFS-root master image with Ansible: debootstrap into an NFS share, configure the tree over a chroot connection, publish kernel/initrd to S3 (or TFTP via SCP), then differentiate clones so each boots with its own hostname, machine-id, and SSH host keys.

## Pipeline

| Phase | Playbook | Connection | Purpose |
| --- | --- | --- | --- |
| 0 | `playbooks/nfs-root-provision/00_setup_debootstrap.yml` | local (driver) | Mount the NFS share at `/mnt/target`, run `debootstrap`, bind-mount `/proc` `/sys` `/dev` `/dev/pts`. |
| 1 | `playbooks/nfs-root-provision/10_chroot_build.yml` | chroot (`/mnt/target`) | Apply the `nfs_master` role, then import `ubuntu_style_sudo.yml`. |
| 2 | `playbooks/nfs-root-provision/20_publish_kernel.yml` | local (driver) | Optionally refresh the initrd, then copy `vmlinuz`/`initrd` to S3 or TFTP. |
| 3 | `playbooks/nfs-root-provision/90_teardown.yml` | local (driver) | Unbind and unmount `/mnt/target`. |

`site_bootstrap.yml` runs 00 → 10 → 20 → 90. Each phase can also run alone (for example, to inspect the image between build and teardown).

## Layout

```text
ansible/
├── ansible.cfg
├── hosts.example.ini           # copy to hosts.ini
├── group_vars/
│   └── all.example.yml         # copy to all.yml
├── playbooks/
│   ├── nfs-root-provision/
│   │   ├── site_bootstrap.yml
│   │   ├── 00_setup_debootstrap.yml
│   │   ├── 10_chroot_build.yml
│   │   ├── 20_publish_kernel.yml
│   │   ├── 90_teardown.yml
│   │   └── differentiate_host.yml
│   ├── install_packages.yml
│   └── ubuntu_style_sudo.yml
└── roles/
    └── nfs_master/
        ├── defaults/main.yml
        ├── tasks/
        ├── templates/
        └── handlers/
```

`hosts.ini` and `group_vars/*.yml` are gitignored; `*.example.*` templates are committed. Put real NFS/S3/SSH/timezone values in the gitignored files.

## Prerequisites

**Driver host**

- `ansible-core` 2.14+ and the `community.general` collection (phase 1 uses `community.general.chroot`; there is no built-in chroot connection).
- `debootstrap` (phase 0 installs it if missing).
- `aws` CLI for the S3 publish path, with credentials from the normal chain (env, `/root/.aws/credentials` when root, or instance metadata).
- NFS share reachable from the driver (phase 0 mounts it). The driver must be allowed by the export's client ACL (`showmount -e <nfs_server>`).
- Run the controller as root (`sudo` / `sudo -H`) for mounts and chroot(2).
- **For cross-builds only** (target arch ≠ driver arch, e.g. building arm64
  on an amd64 driver): `qemu-user-static` (installed automatically by phase
  0 if missing) and a working `binfmt_misc` registration. On a normal
  Ubuntu/Debian host, installing `qemu-user-static` registers the binfmt
  handlers with the fix-binary flag, so emulated binaries run inside any
  chroot/mount namespace. A container without `binfmt_misc` mounted cannot
  run a cross-build's `--second-stage`; run cross-builds on a real host.

**Chroot target**

- `python3` and `python3-apt` (phase 0 passes `--include=python3,python3-apt` so facts and the `apt` module work, including `--check`).
- `python3` + `python3-apt` (phase 0 passes `--include=python3,python3-apt`
  to debootstrap so the chroot connection plugin can gather facts AND the
  `apt` module works without its normal-mode auto-install self-heal — the
  latter is required for the `--check --diff` dry-run to work against a
  fresh chroot).

## Configure

```bash
cd ansible
cp hosts.example.ini hosts.ini
cp group_vars/all.example.yml group_vars/all.yml
$EDITOR hosts.ini group_vars/all.yml
```

Set the site values in `group_vars/all.yml` (see `all.example.yml`):

- `target_domain`, `timezone`
- `master_user`, `master_user_ssh_pubkey`
- `automation_user`, `automation_user_ssh_pubkey`
- `nfs_server`, `nfs_install_root`, `nameserver`, `search_domain`
- `s3_endpoint_url`, `s3_bucket`, `s3_prefix` — your object store. The
  default `s3_prefix` includes the target arch (`debian/bookworm/<arch>`) so
  builds for different arches don't clobber each other; override only if you
  want a different layout.
- `target_arch` (optional) — Debian arch of the image to build; default
  `amd64`. Set `arm64` (or another Debian arch) for a cross-build. See
  [Cross-build (other architectures)](#cross-build-other-architectures) below.

Everything else has defaults in `roles/nfs_master/defaults/main.yml` (package lists, locale/keyboard, initramfs, sshd policy, TFTP path, and so on). Override those only when you mean to change image policy.

Keys can be loaded from the controller instead of pasted:

```yaml
master_user_ssh_pubkey: "{{ lookup('file', '~/.ssh/id_ed25519.pub') }}"
automation_user_ssh_pubkey: "{{ lookup('file', '~/.ssh/id_ed25519.pub') }}"
```

S3 credentials stay out of the repo (env or `/root/.aws/credentials`).

## Build

Run from `ansible/` so `roles_path = roles` resolves:

```bash
cd ansible
sudo -H ansible-playbook -i hosts.ini playbooks/nfs-root-provision/site_bootstrap.yml
```

Or phase by phase:

```bash
sudo ansible-playbook -i hosts.ini playbooks/nfs-root-provision/00_setup_debootstrap.yml
sudo ansible-playbook -i hosts.ini playbooks/nfs-root-provision/10_chroot_build.yml
# inspect /mnt/target …
sudo -H ansible-playbook -i hosts.ini playbooks/nfs-root-provision/20_publish_kernel.yml
sudo ansible-playbook -i hosts.ini playbooks/nfs-root-provision/90_teardown.yml
```

Checks:

```bash
ansible-playbook --syntax-check -i hosts.ini playbooks/nfs-root-provision/site_bootstrap.yml
ansible-playbook --check --diff -i hosts.ini playbooks/nfs-root-provision/10_chroot_build.yml
```

Use `sudo -H` (not `sudo -E`) when publishing. `-H` sets `HOME=/root` so aws and Ansible async state agree on paths. `-E` keeps the login `HOME`, and async tracking breaks: the wrapper writes `$HOME/.ansible_async` while the poller reads `~root/.ansible_async`. To pass AWS env vars only:

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
sudo --preserve-env=AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN \
  -H ansible-playbook -i hosts.ini playbooks/nfs-root-provision/20_publish_kernel.yml
```

## Cross-build (other architectures)

The recipe is architecture-aware via a single `target_arch` variable
(default `amd64`). Set it in `group_vars/all.yml` to build for another
Debian arch — `arm64` is the motivating case:

```yaml
# group_vars/all.yml
target_arch: arm64
```

Phase 0 (`00_setup_debootstrap.yml`) compares `target_arch` to the driver's
own arch (derived from `ansible_facts.architecture`) and branches automatically:

- **Native** (arches match, e.g. arm64 target on an arm64 driver): debootstrap
  runs in a single stage, exactly as before. No qemu, no second-stage.
- **Cross** (arches differ, e.g. arm64 target on an amd64 driver): debootstrap
  runs with `--foreign` (stage 1 — unpack only), `qemu-user-static` is
  installed on the driver and its `qemu-<arch>-static` binary is copied into
  the target, the virtual filesystems are bind-mounted, and `debootstrap
  --second-stage` runs inside the target **under qemu emulation** to
  configure the unpacked packages. A marker file (`/.second-stage-done`)
  guards second-stage for idempotent re-runs and is scrubbed by the role's
  cleanup phase so it doesn't ship in the image.

The `nfs_master` role itself is architecture-transparent — it runs via the
  chroot connection, executing the target arch's binaries under qemu, and its
  tasks (apt, dpkg-reconfigure, update-initramfs, user/ssh/systemd setup)
  need no per-arch changes. The only arch-specific bits are: the kernel
  meta-package (`linux-image-{{ target_arch }}` in `master_base_packages`)
  and the publish paths (`s3_prefix` / `tftp_dest_path` default to arch-
  suffixed values so arches don't clobber each other).

### Cross-build caveats

- **binfmt_misc is mandatory.** A container without `binfmt_misc` mounted
  cannot run `--second-stage` (arm64 binaries under an amd64 kernel get
  `exec format error`). Run cross-builds on a real host. `apt install
  qemu-user-static` on a normal Ubuntu/Debian host registers the handlers.
- **Emulation is slow.** The chroot build runs every target-arch binary
  under qemu; `update-initramfs -u -k all` (the initrd rebuild) is the
  slowest step. Budget several extra minutes vs a native build.
- **Occasional postinst flakiness.** A small number of package postinst
  scripts behave oddly under user-mode emulation. If a specific package's
  configure step fails under qemu, run that one package's `dpkg
  --configure` by hand in the chroot and re-run the role (it's idempotent).
- **arm64 UEFI netboot needs a bootloader payload this recipe doesn't
  ship.** `20_publish_kernel.yml` publishes `vmlinuz` + `initrd` only.
  arm64 UEFI firmware TFTP-fetches a bootloader — typically `grubaa64.efi`
  (from `grub-efi-arm64`, or shim) plus a `grub.cfg` that kernel-lines the
  published vmlinuz/initrd with the NFS-root command line. Set that up out
  of band, the same way amd64's pxelinux/grub payload is configured out of
  band. (The published arm64 `vmlinuz-*` is an EFI stub, so a minimal UEFI
  setup can chain it directly without grub.)

### Building for multiple arches

Because `s3_prefix` and `tftp_dest_path` default to arch-suffixed values,
amd64 and arm64 builds publish to separate locations and coexist. Run the
pipeline once per arch with `target_arch` set accordingly (e.g. two
`group_vars` files selected via `-e @group_vars/arm64.yml`, or two separate
control trees). The NFS install root (`nfs_install_root`) should also differ
per arch so each arch has its own root filesystem.

## Publish kernel/initrd

`20_publish_kernel.yml` resolves the kernel and initrd under `/mnt/target/boot/` (follows `/boot/vmlinuz` and `/boot/initrd.img` when present; otherwise takes the newest versioned files) and deploys them:

- **S3** (`kernel_deploy_method: s3`, default) — `aws s3 cp --endpoint-url=…` to `s3_bucket`/`s3_prefix`/`s3_kernel_object` and `s3_initrd_object`. Works with S3-compatible stores.
- **TFTP via SCP** (`kernel_deploy_method: tftp_scp`) — copies to `tftp_dest_host:tftp_dest_path`.

```bash
# S3 (default) — credentials in /root/.aws/credentials, or env via --preserve-env
sudo -H ansible-playbook -i hosts.ini playbooks/nfs-root-provision/20_publish_kernel.yml

# TFTP/SCP
sudo -H ansible-playbook -i hosts.ini playbooks/nfs-root-provision/20_publish_kernel.yml \
    -e kernel_deploy_method=tftp_scp -e tftp_dest_host=tftp.lan
```

`publish_refresh_initrd: true` (default) runs `chroot /mnt/target update-initramfs -u -k all` before upload so the initrd matches `initramfs.conf`. Bind-mounts must still be up: publish before teardown, or re-run phase 0. Set `publish_refresh_initrd: false` to upload existing boot artifacts only.

iSCSI root is out of scope. If you add it yourself (open-iscsi, initiator config, `BOOT=iscsi` or a custom hook, rebuild initrd), the publish refresh will pick up the new initrd.

## First boot and post-boot management

The master image has no SSH host keys and an empty `/etc/machine-id`. On first boot:

1. `ssh-keygen-firstboot.service` generates host keys (`Before=ssh.service`).
2. systemd creates `/etc/machine-id`.
3. `ssh.service` starts with the new keys.

Add the host to `[netboot_hosts]` and manage it as the automation user:

```ini
[netboot_hosts]
cordoba-netboot ansible_host=10.76.x.x ansible_user=ansible
```

```bash
ansible-playbook -i hosts.ini playbooks/install_packages.yml \
    -e '{"base_packages":["rsync","htop"],"extra_packages":["btop"]}'
```

## Differentiating clones

After cloning the master filesystem (for example a per-host ZFS clone) and before first boot, run `differentiate_host.yml` so each clone gets a unique hostname and a clean identity for firstboot:

```bash
# Inventory:
#   [clone_hosts]
#   web01-clone ansible_host=/mnt/clone ansible_connection=chroot
sudo ansible-playbook -i hosts.ini playbooks/nfs-root-provision/differentiate_host.yml \
    -e differentiate_target=clone_hosts -e hostname=web01
```

The play selects hosts from `differentiate_target` (default `netboot_hosts`). `--limit` only filters inside that pattern, so clones in another group need `-e differentiate_target=<group_or_host>`.

- **Chroot mode:** hostname/hosts, empty machine-id, remove SSH host keys.
- **SSH mode** (host already in `netboot_hosts`): hostname/hosts only — does not scrub machine-id or host keys on a live system.

```bash
ansible-playbook -i hosts.ini playbooks/nfs-root-provision/differentiate_host.yml \
    -l web01 -e hostname=web01
```

## Sudo and access policy

`ubuntu_style_sudo.yml` is imported by `10_chroot_build.yml` and:

- Deploys `/etc/sudoers` (sudo group requires a password)
- Locks root (`password: '!'`)
- Sets `PermitRootLogin prohibit-password`

Users created by `nfs_master`:

| User | Login | Sudo |
| --- | --- | --- |
| `master_user` (default `sebastian`) | SSH key only; password locked | Added to `sudo` group by `ubuntu_style_sudo.yml` during the master build. Password sudo needs a password set on the account later. Optional: `master_user_passwordless_sudo: true` writes `/etc/sudoers.d/<user>`. |
| `automation_user` (default `ansible`) | SSH key only; password locked | Passwordless via `/etc/sudoers.d/ansible` for unattended post-boot runs. |

`10_chroot_build.yml` passes `sudo_users: ["{{ master_user }}"]` into the sudo playbook. The role creates users and optional NOPASSWD entries; the sudo playbook owns group membership and `/etc/sudoers`.

`sshd_config`: `PasswordAuthentication no`, `PubkeyAuthentication yes`. `PermitRootLogin` is owned by the sudo playbook.

### `ubuntu_style_sudo.yml` knobs (chroot reuse)

- `sudo_target_hosts` — default `all`; build passes `master_chroot`
- `sudo_become` — default `true`; build passes `false` (chroot is already root)
- `Restart sshd` handler skips when `ansible_connection == 'chroot'`

Standalone use against live hosts is unchanged.

## Package list

Two installs in the chroot (defaults in `roles/nfs_master/defaults/main.yml`):

1. `master_base_packages` — curated set (kernel, NFS, SSH, tools, `dctrl-tools`, …)
2. Debian `important` + `standard` priorities via `grep-dctrl`, minus `master_excluded_packages`

Change image composition in the role defaults (or override in `group_vars` if one site differs). Disable the priority pass with `install_priority_packages: false`. Post-boot extras belong in `install_packages.yml`, not the master list.

Debconf is preseeded (`templates/debconf_seed.j2`) for `locales`, `keyboard-configuration`, `console-setup`, and `nullmailer`, with `DEBIAN_FRONTEND=noninteractive` as a fallback. `tzdata` is set by writing `/etc/timezone` and linking `/etc/localtime` (area-dependent debconf seeds are brittle).

## Operational notes

- **Bind-mounts:** phase 0 only bind-mounts when `mountpoint -q` says the target is not already a mountpoint. Re-run the playbook; do not hand-mount `/dev` and `/dev/pts` onto `/mnt/target` on a host with `rshared` propagation (systemd default). A naive double-bind can stack mounts onto the host's own `/dev/pts` and break new PTYs (`PTY allocation request failed on channel 0`). Recovery: `umount -R /mnt/target`.
- **S3 env in tasks:** upload tasks only inject `AWS_*` when those Ansible vars are defined. Do not use `default(omit)` in an `environment:` block — it becomes a literal `__omit_place_holder__…` string and aws treats it as a bad key.
- **Teardown:** run `90_teardown.yml` (or `umount -R /mnt/target`) when finished so binds and the NFS mount are not left up on the driver.

## Testing

- Build on the `[master_build_driver]` host; phase 0 mounts the share at `/mnt/target`.
- Boot a separate system from the published kernel/initrd over NFS; add it to `[netboot_hosts]` after first boot.
