# LXD for Agentic Development Containers

This directory is a practical recipe for running AI coding agents inside LXD containers on a developer workstation. The goal is not performative sandbox theatre: it is to keep *YOLO-mode* agents productive while bounding the blast radius when they run destructive commands, leak credentials into the wrong place, or hammer the network.

The examples under `examples/` are the configuration I actually use as a starting point. They are meant to be read, copied, and adapted — not treated as a black-box installer.

## Why LXC/LXD for AI agents

Coding agents are useful precisely because they can edit trees, install packages, start services, and call out to the network with little friction. That same autonomy makes them risky on a primary workstation:

- They will happily `rm`, rewrite git history, or spray secrets into logs if a prompt goes wrong.
- Prompting the human on every shell command defeats the purpose and trains people to approve blindly.
- Docker alone is a packaging tool; it is a weaker isolation boundary for a long-lived, interactive, full-filesystem development environment.

LXD (the daemon and CLI around LXC) gives you a coherent set of mechanisms that Unix has spent decades hardening:

- **Unprivileged containers** with per-instance UID/GID maps so root inside is not root on the host.
- **Cgroup resource limits** (CPU, memory, PIDs, disk priority) so a runaway agent degrades the container, not the laptop.
- **AppArmor + seccomp** generated and applied by LXD.
- **Declarative networking** with its own bridge, DHCP/DNS, and NAT — easy to firewall on the host.
- **Snapshots and restores** so "the agent destroyed the environment" is a one-liner recovery.
- **Bind mounts with `shift=true`** so you can share a source tree without collapsing the UID map.

Pair this directory with the host firewall in [`../firewall`](../firewall), which is written so LXD and Docker can coexist without Docker clobbering LXC forwarding rules.

If you want agents that mostly do not ask for permission, put them in a box that makes the worst case recoverable.

## Architecture

Three layers, three files:

| Layer | File | LXD object | Role |
| --- | --- | --- | --- |
| Network | `examples/lxd-dev-network.yaml` | `dev-net` bridge | Isolated subnet, DHCP, DNS, NAT |
| Profile | `examples/lxd-agentic-dev-profile.yaml` | `agentic-dev` profile | Resource caps, security flags, root disk, NIC |
| Guest bootstrap | `examples/agentic-dev_cloud-init.yaml` | instance `user.user-data` | User, packages, SSH hardening (first boot only) |

Instance-specific choices — static IP, bind-mounted source directories — are applied with `lxc config device …` after launch. Keeping them out of the profile avoids baking host paths and addresses into a shared object.

```text
Host (salamanca)
├── nftables + LXD NAT + optional Docker  (see ../firewall)
├── bridge dev-net  (10.76.68.10/24)
│     └── container pi-dev
│           ├── profile agentic-dev (limits, security, eth0)
│           ├── cloud-init user "sebastian"
│           └── disk device → host ~/src/lxc-src  (shift=true)
└── SSH / editor Remote-SSH into sebastian@10.76.68.20
```

## Prerequisites

- LXD installed and initialized (`lxd init` once; a local `default` storage pool is enough).
- **`shiftfs` kernel module for writable bind mounts (optional).** The `shift=true` disk device option requires the `shiftfs` kernel module. This module is available on Ubuntu kernels but **not** on stock Debian kernels (6.1.x) or many other distros. Without it, bind-mounted directories appear as `nobody:nogroup` inside the container and are effectively read-only for the isolated user. Check with `grep -c shiftfs /proc/filesystems`. If unavailable, omit `shift=true` from the disk device or accept that the agent will only be able to read the mount.
- Your user in the `lxd` group (re-login after adding it).
- An SSH key pair on the host; the public key will go into cloud-init.
- Optional but recommended: host firewall from [`../firewall`](../firewall) so LXC and Docker do not fight.

Identifiers used throughout these examples (change them if you like, but keep them consistent):

- Host: `salamanca`
- Container: `pi-dev`
- Guest user: `sebastian`
- Network: `dev-net` at `10.76.68.10/24`
- Static guest address: `10.76.68.20` (outside the DHCP pool)

## Quick start

Commands below assume your shell is in this `lxc/` directory.

### 1. Put your SSH public key in cloud-init

Edit `examples/agentic-dev_cloud-init.yaml` and replace the placeholder under `ssh_authorized_keys` with the single line from your host `~/.ssh/id_ed25519.pub` (or equivalent). Launch will succeed without a real key, but you will not be able to SSH in.

### 2. Create the network

```bash
lxc network create dev-net
lxc network edit dev-net < examples/lxd-dev-network.yaml
```

Confirm:

```bash
lxc network show dev-net
```

### 3. Create the profile

```bash
lxc profile create agentic-dev
lxc profile edit agentic-dev < examples/lxd-agentic-dev-profile.yaml
```

Confirm the NIC points at `dev-net` and limits look right for your machine:

```bash
lxc profile show agentic-dev
```

### 4. Launch the container

Pass only the `agentic-dev` profile. If you also pass `default`, you typically get a second NIC on `lxdbr0`.

```bash
lxc launch ubuntu:24.04 pi-dev \
  --profile agentic-dev \
  --config=user.user-data="$(cat examples/agentic-dev_cloud-init.yaml)"
```

Wait for cloud-init to finish (about a minute on first boot):

```bash
lxc exec pi-dev -- cloud-init status --wait
```

### 5. Give the container a stable IPv4 address

DHCP is fine for throwaways. For SSH config and editor remotes, pin an address **outside** the DHCP range (`10.76.68.100–200` in the example network):

```bash
lxc config device set pi-dev eth0 ipv4.address=10.76.68.20
lxc restart pi-dev
lxc list pi-dev
```

> **Note (LXD version compatibility):** On LXD ≤ 5.0 (Debian package), `lxc config device set` fails for devices inherited from a profile with `"Device from profile(s) cannot be modified for individual instance."` Use `lxc config device override pi-dev eth0 ipv4.address=10.76.68.20` instead. On LXD ≥ 5.19 (snap), `device set` works directly.

Prefer LXD's device address over a static netplan inside the guest. One source of truth, no fight with dnsmasq.

### 6. SSH from the host

`~/.ssh/config` on the host:

```sshconfig
Host pi-dev
  HostName 10.76.68.20
  User sebastian
  IdentityFile ~/.ssh/id_ed25519
  ForwardAgent no
```

Then:

```bash
ssh pi-dev
```

Or open a root shell without SSH:

```bash
lxc exec pi-dev -- sudo -u sebastian -i
```

### 7. Mount a host source tree

Agents need a project directory. Mount a **dedicated** host path rather than your entire `~/src` so host-only files and credentials stay out of the container.

```bash
mkdir -p ~/src/lxc-src
lxc config device add pi-dev src disk \
  source=/home/sebastian/src/lxc-src \
  path=/home/sebastian/src \
  readonly=false \
  shift=true
```

`shift=true` installs a shifting overlay so ownership matches the container's isolated idmap for that tree only. Without it, files created in the mount often show up as "nobody" or the wrong numeric owner on one side of the boundary.

> **Note:** `shift=true` requires the `shiftfs` kernel module (see Prerequisites). On hosts without it, the device add will fail with `"Required idmapping abilities not available"`. In that case, omit `shift=true` and accept read-only semantics, or mount the source directory read-only (`readonly=true`) to make the intent explicit.

You can set or change `shift` later:

```bash
lxc config device set pi-dev src shift=true
lxc restart pi-dev
```

## Source layout and git worktrees

Bind-mounting the main repo is convenient and dangerous in equal measure: the agent can rewrite anything in that tree, including files you did not intend to hand over.

A layout that has worked well:

- Put the **canonical clone** (or a clean worktree) under the mounted path, e.g. `~/src/lxc-src/myproject`.
- Do agent-facing experimental work in a **git worktree** under that mount so the primary working tree on the host stays readable.
- Keep secrets, cloud credentials, and unrelated repos **off** the mount.

Tradeoffs to be honest about:

- A worktree is still the same repository object store; an agent that runs destructive git commands can affect refs shared with other worktrees.
- Two fully independent clones cost more disk and drift, but limit shared ref damage.
- Extra files in the tree (build artifacts, agent notes, `.env` files) confuse agents and increase the chance of accidental commits — keep the mounted tree boring.

## Agent tooling (inside the container)

Install language runtimes and the agent harness **after** first boot, from a shell you can re-run. Pinning every npm/nvm version in cloud-init makes the YAML churn for no isolation benefit.

```bash
lxc exec pi-dev -- sudo -u sebastian -i
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
# Open a new login shell or source nvm, then:
nvm install 24
npm install -g @mariozechner/pi-coding-agent
```

Adjust versions as needed. The same pattern works for `uv`, Rustup, etc.

## Day-to-day operations

```bash
# Snapshot before risky agent work
lxc snapshot pi-dev clean-state

# Restore if the environment is trashed
lxc restore pi-dev clean-state

# Resource usage and status
lxc info pi-dev
lxc list

# Quick checks without SSH
lxc exec pi-dev -- bash -c 'df -h; free -h; ip -4 addr show eth0'

# Stop / start / delete
lxc stop pi-dev
lxc start pi-dev
lxc delete --force pi-dev
```

Editor Remote-SSH (VS Code, Cursor, etc.): connect to host `pi-dev` from the SSH config above. The editor installs its server inside the container; install any AI/editor extensions in that remote context, not only on the host.

## Configuration management guidance

These examples intentionally stop at "good bootstrap," not a full CM platform. A few practices keep the setup maintainable:

1. **Respect the layers.** Network and profile are host-side, re-applicable, and shared. cloud-init is guest-side and **first boot only**. Instance devices (IP, disks) are per container. Do not collapse all of that into one mega-YAML.

2. **Treat cloud-init as bake, not converge.** Editing `agentic-dev_cloud-init.yaml` does nothing to a running container. Either rebuild (`lxc delete` + launch) or run the equivalent commands by hand / script. For anything you expect to change often (Node version, agent package, prompt files), use a re-runnable setup script in the mounted tree.

3. **Do not commit real secrets.** The cloud-init file in git should keep a clearly fake SSH public key. Real keys, tokens, and `.env` files stay on the host or in a secrets store; inject at launch or mount read-only if the agent truly needs them.

4. **Prefer LXD for address and device policy.** Static IPs, NIC attachment, disk mounts, and limits belong in LXD objects. Guest netplan static addresses duplicate state and race DHCP.

5. **Version the YAML; apply explicitly.** Keep `examples/` as the reviewed source of truth. Apply with `lxc network edit` / `lxc profile edit` redirects rather than hand-editing live objects and forgetting to copy back.

6. **Rebuild is a feature.** With snapshots and a short bootstrap, destroying `pi-dev` is cheaper than debugging a half-applied guest. Bias toward immutable guests when agents have had free rein.

7. **If you outgrow cloud-init,** add a small configuration-management pass (Ansible against the container IP, or a systemd oneshot that pulls a setup repo). Keep the LXD profile as the security envelope either way.

8. **Nesting and Docker-in-LXC.** This profile sets `security.nesting=false`. If an agent must drive Docker inside the container, that is a different threat model: nesting, more devices, and usually a worse firewall story. Prefer Docker on the host and controlled LXC↔Docker policy from [`../firewall`](../firewall).

## Validation checklist

Use this when proving the examples still work on real hardware (for humans or for another agent following the README):

1. `lxc network show dev-net` shows `10.76.68.10/24`, DHCP range `.100–.200`, `ipv4.nat=true`.
2. `lxc profile show agentic-dev` shows `security.privileged=false`, `security.nesting=false`, `limits.memory.swap=false`, NIC `network=dev-net`.
3. `examples/agentic-dev_cloud-init.yaml` begins with `#cloud-config`, passes `cloud-init schema -t cloud-config`, and `AllowUsers` matches the guest username.
4. After launch, `lxc exec pi-dev -- cloud-init status --wait` reports `status: done` with no fatal errors (`cloud-init status --long`).
5. `lxc list` shows `pi-dev` RUNNING with `10.76.68.20` (or your chosen static address).
6. `ssh pi-dev` works with key auth; password auth is refused.
7. `lxc exec pi-dev -- ping -c3 8.8.8.8` and `curl -sI https://example.com` succeed if the host firewall allows LXC egress.
8. A file created on the bind-mounted `src` device as `sebastian` inside the container is usable on the host without ownership surprises (`shift=true`).
9. `lxc snapshot` / `lxc restore` round-trip works.
10. Optional: run the LXC-related tests in [`../firewall/README.md`](../firewall/README.md) if that stack is installed.

## Related

- Host firewall for concurrent LXD + Docker: [`../firewall`](../firewall)
- Agent policies and skills used inside these environments: [`../agents`](../agents)
