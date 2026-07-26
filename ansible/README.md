# ansible — Infrastructure as Code for AI Workers

This directory is the Ansible control tree for agentic-infra: declarative configuration of the hosts, VMs, and containers that run coding agents and supporting services. The playbooks here are minimal as of this writing; the point of this README is Ansible itself — how it keeps fleets consistent, why that matters when agents are the workload, and how to organize a control tree so it stays reliable as the inventory grows.

## Why Ansible for AI Infrastructure

AI workers are not one-off laptops. A useful setup usually spans:

- LXD containers that sandbox YOLO-mode agents
- Bare-metal or VM hosts that run those containers
- Shared services (NFS roots, package mirrors, DNS, jump hosts)
- Developer workstations that need the same baseline tooling as the workers

Hand-configuring each machine burns attention on the least interesting details: which packages are installed, whether `htop` is present, which Python interpreter Ansible should use, whether the agent user has the right shell and SSH key. Drift appears the moment you stand up a second worker. Ansible is the standard answer for that class of problem.

Ansible is **agentless Infrastructure as Code**:

- **Declarative intent.** You write the desired end state (packages present, files rendered, users created). Ansible converges the host toward that state.
- **SSH as the transport.** No daemon to install on managed nodes; if you can SSH in, you can manage the box. That fits LXC guests, cloud VMs, and developer machines equally well.
- **Idempotent modules.** Re-running a playbook is safe. Modules report `changed` only when they actually altered something, so the same play is a bootstrap *and* a drift-correction tool.
- **Inventory + variables.** Hosts are grouped; group and host variables layer cleanly. One playbook can configure every worker while still allowing per-host exceptions.
- **Especially strong for containers and VMs.** Once LXD (or a hypervisor) has launched the guest, Ansible is the natural way to install packages, drop config, and keep the guest identity consistent across rebuilds. Pair this tree with [`../lxc`](../lxc) for container lifecycle and [`../firewall`](../firewall) for host network policy.

What Ansible is *not*: a container orchestrator, a cloud provisioner, or a secret store. Use it for configuration management and ad-hoc ops; leave image builds, cluster scheduling, and secret distribution to tools designed for those jobs.

## Mental Model

Three ideas cover most of day-to-day use:

| Concept | What it is |
| --- | --- |
| **Inventory** | The list of managed hosts, usually grouped (`[workers]`, `[control]`, …). File or directory. |
| **Playbook** | A YAML document of plays. Each play picks hosts, optional privilege escalation, and a task list. |
| **Module** | The unit of work (`apt`, `copy`, `user`, `shell`, …). Prefer modules over raw shell; they encode idempotency and return structured results. |

A typical run looks like:

```bash
ansible-playbook -i inventory playbooks/install_packages.yml
```

Ansible connects over SSH as `ansible_user`, optionally becomes root (`become: true`), gathers facts about the host, and walks the tasks. Failed tasks stop that host; other hosts continue unless you configure otherwise.

Variables resolve from several layers (command line, play vars, host_vars, group_vars, defaults). For a control tree like this one, **group_vars** is where shared defaults live: the agent SSH public key, the Python interpreter policy, the default remote user.

## Control Tree Layout

Ansible loads `group_vars` and `host_vars` relative to the **inventory**, not relative to the playbook and not relative to an arbitrary project root. Get this wrong and variables silently fail to load.

### Correct — Inventory is a single file

```text
ansible/
├── inventory.ini
├── group_vars/
│   ├── all.yml
│   └── workers.yml
├── host_vars/            # optional, per-host overrides
│   └── lynch.yml
└── playbooks/
    ├── install_packages.yml
    ├── install_dev_tools.yml
    └── ...
```

Here `group_vars/` sits next to `inventory.ini`. Ansible treats that sibling directory as the variable source for that inventory file.

### Correct — Inventory is a directory

```text
ansible/
├── inventory/
│   ├── hosts.ini
│   ├── group_vars/
│   │   ├── all.yml
│   │   └── workers.yml
│   └── host_vars/
│       └── lynch.yml
└── playbooks/
    ├── install_packages.yml
    ├── install_dev_tools.yml
    └── ...
```

When the inventory path is a directory, `group_vars/` and `host_vars/` live **inside** that directory. This layout scales better: you can split hosts across files, add dynamic inventory scripts, and keep everything that defines "what exists" in one place.

### Wrong — group_vars above an inventory directory

```text
ansible/
├── group_vars/           ← Will NOT be loaded for -i inventory/
│   ├── all.yml
│   └── workers.yml
├── inventory/
│   └── hosts.ini
└── playbooks/
    └── site.yml
```

If you pass `-i inventory/` (a directory), Ansible does **not** walk up to a parent `group_vars/`. Variables appear missing, defaults look empty, and debugging is miserable. Either use a single inventory *file* with sibling `group_vars/`, or nest `group_vars/` inside the inventory directory.

### This Repository

Committed layout:

```text
ansible/
├── ansible.cfg            # roles_path, interpreter_python, ssh control_path
├── hosts.example.ini      # template — copy to hosts.ini
├── group_vars/
│   └── all.example.yml    # template — copy to all.yml
├── README.md
├── playbooks/
│   ├── nfs-root-provision/   # NFS master-image pipeline
│   │   ├── site_bootstrap.yml
│   │   ├── 00_setup_debootstrap.yml
│   │   ├── 10_chroot_build.yml
│   │   ├── 20_publish_kernel.yml
│   │   ├── 90_teardown.yml
│   │   └── differentiate_host.yml
│   ├── install_packages.yml
│   ├── install_dev_tools.yml
│   ├── ubuntu_style_sudo.yml
│   └── …
├── roles/
│   ├── nfs_master/        # master-image build role
│   └── ssh_user/
└── templates/
    └── sudoers.j2
```

`hosts.ini` and `group_vars/all.yml` are gitignored; the `*.example.*` templates are committed. Hostnames, keys, and environment-specific values stay on the control machine. Copy `hosts.example.ini` to `hosts.ini` (`ansible.cfg` defaults to that name) and edit it.

## Inventory and Variables

### hosts.ini

A minimal static inventory:

```ini
; hosts.ini

[workers]
lynch
```

Group names become targets: `hosts: workers` in a play, or `-l workers` on the command line. Add host-specific connection settings inline when needed:

```ini
[workers]
lynch ansible_host=10.76.68.20 ansible_user=ansible
```

### group_vars

Shared defaults for every host in the inventory:

```yaml
# group_vars/all.yml

ansible_user: ansible
ansible_python_interpreter: auto_silent
agent_ssh_pubkey: "{{ lookup('file', '~/.ssh/id_ed25519.pub') }}"
```

Notes:

- `ansible_user` is who SSH logs in as. Create that user (and its authorized key) out of band or with a bootstrap play before the rest of the tree depends on it.
- `ansible_python_interpreter: auto_silent` lets Ansible discover a usable Python without noisy warnings — helpful across mixed Ubuntu/Debian guests.
- `lookup('file', …)` runs on the **control** machine. Using it for an SSH public key is a convenient way to push *your* key without pasting it into the repo.
- Prefer `all.yml` for truly global defaults and `workers.yml` (matching the inventory group name) for worker-only settings.

## Playbooks in this tree

Style goals: explicit task names, modules over shell, vars at the top of the play.

| Playbook | Purpose |
| --- | --- |
| `playbooks/install_packages.yml` | Reusable apt installer (`base_packages` / `extra_packages`). |
| `playbooks/install_packages_example.yml` | Standalone example kept for reference. |
| `playbooks/install_dev_tools.yml` | Per-user `nvm` and `rustup` under `target_user`. |
| `playbooks/ubuntu_style_sudo.yml` | Sudo policy: sudo group with password, root locked, `PermitRootLogin prohibit-password`. Imported by the master build. |
| `playbooks/nfs-root-provision/site_bootstrap.yml` | Full NFS master-image pipeline (debootstrap → chroot build → publish kernel/initrd → teardown). |
| `playbooks/nfs-root-provision/00_setup_debootstrap.yml` … `90_teardown.yml` | Individual master-build phases. |
| `playbooks/nfs-root-provision/differentiate_host.yml` | Per-clone hostname/identity (chroot before first boot, or hostname-only over SSH). |

NFS root bootstrap details: [`roles/nfs_master/README.md`](roles/nfs_master/README.md).

```bash
# From this directory
ansible-playbook -i hosts.ini playbooks/install_packages.yml
ansible-playbook -i hosts.ini playbooks/install_dev_tools.yml

# Limit to one host or group
ansible-playbook -i hosts.ini playbooks/install_dev_tools.yml -l lynch

# Preview changes without applying them
ansible-playbook -i hosts.ini playbooks/install_packages.yml --check --diff
```

## Conventions worth keeping

As the ansible codebase grows, the following habits pay off:

1. **Inventory defines reality; playbooks define policy.** Hostnames and group membership change more often than task logic. Keep them separate.
2. **Modules over shell.** Use `ansible.builtin.apt`, `copy`, `template`, `user`, `systemd` whenever a module exists. Reserve `shell`/`command` for installers that truly have no module (`nvm`, `rustup`), and always pair them with `creates:` or an explicit check so re-runs stay quiet.
3. **One concern per playbook** early on; compose with a thin `site.yml` later if you need a single entry point.
4. **No secrets in git.** Private keys, passwords, and environment-specific host lists stay gitignored or in a vault. Public keys and non-secret defaults can live in `group_vars` patterns documented here.
5. **Name tasks for the operator.** When a run fails at 2 a.m., the task name is the error message. Prefer `Install acl package for setfacl` over `apt install`.
6. **Target the agent identity deliberately.** Worker plays should take an explicit `target_user` / `agent_user` rather than assuming root's home for language toolchains. Agents run as a constrained user inside LXC; install their tools there.

## Relationship to the rest of agentic-infra

| Directory | Role relative to Ansible |
| --- | --- |
| [`../lxc`](../lxc) | Creates and shapes LXD networks, profiles, and instances. Ansible configures *inside* those instances after first boot. |
| [`../firewall`](../firewall) | Host nftables + Docker coexistence. Applied on the LXD host, not usually via these guest-oriented plays. |
| [`../agents`](../agents) | Policies and skills loaded by coding agents. Not deployed by Ansible today; candidates for a future `copy`/`template` play into guest home directories. |

A practical lifecycle for a new agent worker:

1. Define network + profile + cloud-init ([`../lxc`](../lxc)).
2. Launch the instance; confirm SSH as the bootstrap user.
3. Add the host to inventory; set `group_vars` / `host_vars`.
4. Run package and toolchain plays from this tree.
5. Point the agent harness at the guest; rely on [`../firewall`](../firewall) for blast-radius limits on the host.

## Prerequisites on the control machine

- Ansible 2.14+ (or the distro package of `ansible-core`)
- SSH key-based access to managed hosts
- Python 3 on managed hosts (almost always present on modern Ubuntu/Debian)

Optional quality-of-life:

```bash
# Syntax check without connecting
ansible-playbook --syntax-check playbooks/install_packages.yml

# Ad-hoc fact gathering against the inventory
ansible -i hosts.ini workers -m ansible.builtin.setup
```

