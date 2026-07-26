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

**Chroot target**

- `python3` and `python3-apt` (phase 0 passes `--include=python3,python3-apt` so facts and the `apt` module work, including `--check`).

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
- `s3_endpoint_url`, `s3_bucket`, `s3_prefix`

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
