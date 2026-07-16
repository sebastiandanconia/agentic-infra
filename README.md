# agentic-infra

Practical infrastructure for running AI coding agents at production-minded autonomy: unprivileged Linux containers, host firewalls that coexist with LXD and Docker, Ansible for worker configuration, portable agent policies and skills, session tooling for long-lived remote work, and harness extensions that plug alternative model providers into the terminal workflow.

This repository is both a working reference stack and a curriculum. Each directory teaches a real operational concern—blast-radius control, network policy, configuration management, agent instruction design—with the same depth you would expect in a professional runbook, not a toy demo.

## The problem

Coding agents earn their keep when they can edit trees, install packages, start services, and call the network with little friction. That same autonomy makes them dangerous on a primary workstation: a bad prompt can rewrite git history, spray secrets into logs, or hammer the network. Prompting a human on every shell command defeats the purpose and trains people to approve blindly.

The durable answer is not more confirmation dialogs. It is the same layered security and operations discipline Unix has refined for decades, applied deliberately to agent workloads:

- **Contain** the agent so the worst case is recoverable.
- **Bound** network reachability so containers, host services, and Docker do not collapse into one trust domain.
- **Configure** workers declaratively so a second host does not mean a second snowflake.
- **Instruct** agents with portable policies and on-demand skills so behavior is consistent without burning context on every turn.
- **Operate** the session so SSH drops, vertical monitors, and multi-pane workflows do not interrupt the agent.
- **Choose inference** so prompts, tool traces, and source excerpts are not retained by default once they leave the host.

`agentic-infra` implements the stack as readable examples you can adapt, not as a black-box installer.

## Architecture

Think in layers. Each layer has a clear job and a corresponding directory.

```text
Operator workstation / aux display
└── tmux session (persistent attach, dual-pane agent + shell)
    └── Agent harness (e.g. Pi) + extensions (model providers)
        └── Agent instructions (always-on policies + on-demand skills)
            └── LXD guest (unprivileged, resource-capped, cloud-init bootstrap)
                └── Ansible-managed packages and toolchains
                    └── Host: nftables + LXD NAT + Docker coexistence
                        └── Optional: Shorewall on dedicated compute workers
```

| Layer | Directory | What you learn |
| --- | --- | --- |
| Session UX | [`tmux/`](tmux/) | Persistent remote sessions, pane layouts for agent + host shells, recovery after SSH disconnect |
| Harness extensions | [`pi-extensions/`](pi-extensions/) | TypeScript provider plugins for Pi, testable factory design, model catalog caching |
| Agent behavior | [`agents/`](agents/) | Policy vs skill separation, progressive disclosure of instructions, Agent Skills standard |
| Guest lifecycle | [`lxc/`](lxc/) | LXD networks, profiles, cloud-init, bind mounts with idmap shift, snapshots as recovery |
| Configuration management | [`ansible/`](ansible/) | Inventory/variable layout pitfalls, idempotent plays for AI workers, secrets kept out of git |
| Host network policy | [`firewall/`](firewall/) | nftables base rules, Docker `DOCKER-USER` repair, LXC↔Docker policy, Shorewall for workers |

Read the module READMEs in full. They are the teaching material: rationale, failure modes, customization points, and validation checklists—not just file listings.

## Design principles

These choices recur across the tree. They are intentional and worth copying into your own infrastructure.

1. **Autonomy with a recoverable worst case.** Prefer YOLO-mode agents inside unprivileged LXD over constant human approval. Snapshots, resource caps, and network defaults make “the agent destroyed the environment” a restore, not an incident.
2. **Defense in depth, not sandbox theatre.** Isolation is a coherent set of mechanisms (UID maps, cgroups, AppArmor/seccomp, host netfilter, secrets policy, retention-aware inference)—not a single container flag waved at auditors.
3. **Declarative identity, imperative bootstrap.** LXD networks/profiles and Ansible plays express desired state. cloud-init is first-boot bake only. Instance devices (static IP, disk mounts) stay per-container so shared profiles remain portable.
4. **Coexistence is a first-class requirement.** Real developer machines run LXD *and* Docker. The firewall examples document the boot order, the dual-stack (nftables + iptables) trap, and the post-Docker repair path instead of pretending Docker is absent.
5. **Progressive disclosure for agent context.** Always-on policies are short and high-value (never read secrets files; clean whitespace). Task-specific procedures live in skills loaded only when relevant, so token cost tracks actual work.
6. **No secrets in git.** Inventories, host vars, real SSH keys, and environment-specific addresses stay local or vaulted. Public trees hold playbooks, example YAML with placeholders, and documentation.
7. **Rebuild is a feature.** Short bootstraps and snapshots beat debugging a half-applied guest that an agent has trashed for an hour.
8. **Teach the why.** Module docs explain mental models, common wrong layouts, and how to validate success—so another engineer (or another agent) can reproduce the setup on real hardware.
9. **Treat the inference path as a trust boundary.** Local isolation and firewalls protect the host. Zero Data Retention (and TEE-backed models where available) protect the content that must leave the host to be useful. Provider choice is part of the security architecture, not a separate product preference.

## Inference privacy and Zero Data Retention

Most of this repository is about what the agent can touch *on your machines*: unprivileged guests, host netfilter, declarative worker config, and policies that keep secrets out of context. That is necessary yet still incomplete. Coding agents continuously ship prompts, diffs, tool output, and repository excerpts to a remote model API. If that provider retains prompts for training, long-term logs, or broad operational reuse, carefully isolated local infrastructure has only moved the incident surface off-box.

Venice.ai's Zero Data Retention (ZDR) posture is therefore a pillar of the security architecture this tree implements—not a marketing footnote on the harness extension. Many models available through Venice are offered under ZDR policies: request content is not kept as a retained corpus for training or durable provider-side history in the usual retain-by-default sense. Some models additionally run in Trusted Execution Environments (TEEs), where hardware-backed isolation enforces the infrastructure operator's privacy guarantees.

[`pi-extensions/venice-ai`](pi-extensions/venice-ai)'s presence in this repository, over and above being an integration offering wide model choice, is a symbol and instrument of ZDR inference capability in agentic workflows.

ZDR and TEEs are model- and product-tier dependent. Confirm the current Venice policy and model attributes for the specific models you enable before treating them as part of a compliance or threat model.

## Repository map

### [`lxc/`](lxc/) — LXD for agentic development containers

A practical recipe for YOLO-mode agents on a developer workstation: isolated `dev-net` bridge, hardened `agentic-dev` profile (unprivileged, no nesting, memory/CPU/PID limits), cloud-init guest bootstrap, static addressing, and `shift=true` source mounts. Pairs with the host firewall so LXC and Docker can share a laptop without clobbering each other’s forwarding rules.

Start here if you need a safe place to *run* an agent.

### [`firewall/`](firewall/) — Netfilter for LXC + Docker, and Shorewall for workers

- **`examples/`** — Host `nftables.conf`, `nft-post-docker.sh`, and a systemd unit that repopulates Docker’s `DOCKER-USER` chain after Docker starts. Documents boot order (`nftables → LXD → Docker → nft-post-docker`), LXC↔Docker policy knobs, and a concrete test plan.
- **`compute-worker/`** — Shorewall (IPv4) ruleset for a single AI worker node: default-deny host firewall, params-driven hostnames, controller/`shorewall-lite` workflow for fleets.

Start here if agents already run but network policy is ad hoc—or if Docker has silently broken LXC forwarding.

### [`ansible/`](ansible/) — Infrastructure as code for AI workers

Control-tree guidance and starter playbooks for packages and per-user toolchains (nvm, rustup). Emphasizes correct inventory/`group_vars` layout (a frequent silent failure), module-first tasks, and keeping host lists and keys out of the public tree. Positions Ansible as configuration management after LXD launch—not as a container orchestrator or secret store.

Start here when you have more than one worker, or when “works on my laptop” is no longer enough.

### [`agents/`](agents/) — Portable agent instructions

Two-tier instruction design that maps cleanly onto Pi and ports to other harnesses:

| Tier | Role | Examples |
| --- | --- | --- |
| **Policies** | Always-on fragments concatenated into `AGENTS.md` / `CLAUDE.md` | Secrets hygiene, whitespace/line endings, etc. |
| **Skills** | On-demand `SKILL.md` packages (Agent Skills standard) | Git commit workflow, terminal-first math rendering, vision-task delegation |

The agents README is a short course in progressive disclosure: what belongs in every context window versus what should load only when the task matches.

### [`pi-extensions/`](pi-extensions/) — Pi harness extensions

TypeScript extensions for the Pi coding agent. The `venice-ai` package registers Venice as an inference provider: dynamic model fetch, disk cache with TTL, thin factory over testable library code, Vitest coverage. Beyond maintainable provider plumbing, it is the practical hook for Venice Zero Data Retention models (and TEE-backed options where available)—the inference-side counterpart to local containment and host policy. Illustrates how to keep provider integration maintainable rather than a one-off script.

### [`tmux/`](tmux/) — Persistent agent sessions

A script that builds a dual-pane coding session for remote work: agent in an LXC guest on the large top pane, host/guest shells swappable below, session living on the laptop so SSH disconnects do not kill the agent. Small surface area, high operational leverage for multi-machine setups.

## Suggested learning path

If your goal is to implement effective AI infrastructure—not merely skim folders—work through the stack in this order.

1. **Threat model and containment** — Read [`lxc/README.md`](lxc/README.md). Launch a guest, pin an address, mount a dedicated source tree, take a snapshot, break something, restore.
2. **Host network policy** — Read [`firewall/README.md`](firewall/README.md). Install the base ruleset and post-Docker unit on a lab machine. Run the LXC/Docker connectivity tests and deliberately mismatch LXC↔Docker policy once so you recognize the failure mode.
3. **Configuration management** — Read [`ansible/README.md`](ansible/README.md). Build a correct inventory layout (file + sibling `group_vars`, or directory with nested vars). Converge packages and a toolchain on the guest.
4. **Agent instruction design** — Read [`agents/README.md`](agents/README.md). Concatenate policies into an `AGENTS.md` at a sensible scope. Point your harness at `agents/skills/`. Notice which rules must be always-on because loading them “when relevant” is already too late.
5. **Session and harness** — Use [`tmux/`](tmux/) for long-lived remote sessions. Explore [`pi-extensions/venice-ai`](pi-extensions/venice-ai) to wire a ZDR-capable Venice inference path into Pi, or as a template for other provider extensions with unit test coverage.
6. **Fleet hardening** — Apply [`firewall/compute-worker`](firewall/compute-worker) thinking when workers leave the laptop and become dedicated nodes.

At each step, prefer the module’s validation checklist over “it seemed to work.”

## Who this is for

- **Software engineers** adopting coding agents who need a safer default than “run YOLO on the host.”
- **Platform and data engineers** building AI worker fleets who want Ansible, netfilter, and LXD patterns that scale past a single demo VM.
- **Teams standardizing agent behavior** who need portable policies and skills rather than per-tool prompt paste.

Familiarity with Linux, SSH, and basic networking is assumed. Prior LXD or Ansible experience helps but is not required—the module docs teach the mental models.

## What this is not

- A managed SaaS product or one-click installer.
- A claim that containers make agents “safe” without host policy, secrets discipline, operational practice, and a deliberate inference-retention posture.
- A full cluster orchestrator, image factory, or secret-management platform. Those concerns are deliberately left to tools designed for them; this repo focuses on the seams that agent workloads actually stress.

## Getting started

There is no single bootstrap script on purpose. Pick the layer you need and follow its README:

```text
lxc/README.md          # First agent guest on a developer host
firewall/README.md     # Host netfilter + Docker coexistence
ansible/README.md      # Inventory layout and starter plays
agents/README.md       # Policies, skills, applying them to Pi and others
tmux/README.md         # Persistent dual-pane sessions
pi-extensions/README.md
firewall/compute-worker/README.md
```

Clone or worktree this repository on the host, keep secrets and real inventories out of the tree, and treat the `examples/` as reviewed source of truth that you apply explicitly after customization.

## License

This project is licensed under the GNU General Public License v2.0. See [`LICENSE`](LICENSE). Individual packages may declare additional terms.

## Author

James Walker Crofts

