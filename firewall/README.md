# firewall — Netfilter Rules for Simultaneous LXC + Docker

## Rationale

AI agents can do unpredictable and undesired, even irreversible things to your computer/network/online accounts. Agent harness configurations that prompt you frequently slow down progress, compete for the user's attention, and tend not to be checked carefully in practice. Alternatively, we can configure an agent not to prompt for most activities ("YOLO Mode") and confine the agent using the same security mechanisms that have been developed over the last 55+ years of computing (where humans are sometimes adversaries). Linux Containers (LXC/LXD) combines a coherent group of such security mechanisms, and is an excellent choice for agent containment on a developer's desktop or laptop.

## Concept

- Linux Containers can access the Internet
- LXD manages masquerading of containers, to share the host's upstream Internet connection.
- Docker Containers can access the Internet
- By default, assume the networks beyond our external NICs are hostile
- Whether LXC can access Docker and/or Docker can access LXC is configurable

## Firewall Rules

### Docker Challenges

By default, Docker blindly puts up firewall rules to support container bridge-mode networking, clobbering rules by other programs. Although Docker provides a `DOCKER-USER` chain, this still comes with a number of caveats.

### Setting Up Netfilter Rules Correctly

With the scripts provided here, a setup sequence of:
```text
nftables → LXD → Docker → nft-post-docker
```
(at boot or manually by the user) will result in Netfilter rules correctly set up for external NICs, LXC/LXD, and Docker.

## Walkthrough of Example Files, How They Function, and How to Customize

### nft-post-docker.sh and nft-post-docker.service

Docker installs its own iptables rules when it starts and sets the iptables `FORWARD` policy to `DROP`. Those rules live alongside the nftables ruleset: a forwarded packet must be accepted by *both* the nftables `forward` chain and the iptables `FORWARD` chain, so a DROP in either path kills the packet. Without extra work, Docker's `FORWARD` path silently drops LXC bridge traffic even when nftables would allow it.

Docker provides a dedicated `DOCKER-USER` chain that is evaluated first in its `FORWARD` path. `nft-post-docker.sh` is a small, idempotent installer for that chain:

- Flushes `DOCKER-USER` and recreates three custom chains whose names mirror the subchains in `nftables.conf`: `lxd2docker`, `docker2lxd`, and `lxd2net`.
- Fills those chains according to `POLICY_LXD_DOCKER` (`none`, `lxd2docker`, `docker2lxd`, or `both`), always allowing `RELATED,ESTABLISHED` return traffic when new cross-traffic is denied.
- Whitelists LXC egress to the interfaces listed in `PUBLIC_NICS` via `lxd2net`.
- Wires `DOCKER-USER` jumps in a fixed order (LXC→Docker by interface, LXC→Docker by CIDR, remaining LXC egress, then anything destined to the LXC bridge), ending with Docker's default `RETURN`.

Configuration knobs at the top of the script (`POLICY_LXD_DOCKER`, `PUBLIC_NICS`, `LXC_BRIDGE`, `DOCKER_IFACES`, `DOCKER_CIDRS`) must stay in sync with the matching TODO sites and policy chains in `nftables.conf`.

`nft-post-docker.service` is a oneshot systemd unit that runs the script after Docker is up:

- `After=` / `Requires=` `docker.service` so `DOCKER-USER` already exists.
- `Type=oneshot` with `RemainAfterExit=yes` so the unit stays "active" after the script finishes.
- `WantedBy=multi-user.target` so it is enabled for normal boots.

Re-run the script (or restart the unit) any time Docker is restarted, or after you change the policy variables.

### nftables.conf

`nftables.conf` is the base host firewall, loaded by `nftables.service` *before* LXD and Docker start. It defines a single `inet filter` table with default-drop `input` and `forward` chains, an accepting `output` chain, and stateful `ct` handling at the top of each filtering path.

Built-in chains:

- **input** — Accepts loopback, established/related traffic, and essential ICMPv4/ICMPv6. Traffic from the LXC bridge jumps to `lxd2fw`; traffic from external NICs jumps to `net2fw`.
- **forward** — Traffic from the LXC bridge jumps to `lxd_frwd`; traffic from `docker0` or the Docker CIDR pool jumps to `docker_frwd`. Everything else is dropped by policy.
- **output** — Unrestricted host egress.

Auxiliary chains (customize the `TODO` markers before deploying):

- **net2fw** — Host services exposed on public NICs. Default is drop; uncomment or add ports (e.g. HTTPS) as needed.
- **lxd2fw** — What LXC containers may send *to the host*. Allows DNS and DHCP against the LXD-managed gateway, plus ping to that gateway; rejects the rest.
- **lxd_frwd** — Forwarded traffic *from* LXC. Routes Docker-bound packets to `lxd2docker`, blocks other private/link-local/multicast ranges and outbound SMTP, then accepts remaining Internet egress (LXD handles masquerading).
- **docker_frwd** — Forwarded traffic *from* Docker. Public-NIC egress goes to `docker2net`; LXC-bound traffic goes to `docker2lxd`.
- **lxd2docker** / **docker2lxd** — Cross-runtime policy. Default is drop both ways; set to `accept` to match the corresponding `POLICY_LXD_DOCKER` value in the post-Docker script.
- **docker2net** — Docker → Internet. Default is accept.

Replace placeholder interface names (`dev-net`, `wlan0`, `docker0`), the LXD gateway/subnet used in `lxd2fw`, and any Docker CIDR assumptions with values from your host before enabling the ruleset.

### Configuration Based on Use Case

Read the comments in `nft-post-docker.sh`, and set `POLICY_LXD_DOCKER` accordingly for your use case. Also see the items marked `TODO` in `nftables.conf` and modify to fit your needs. Keep the two files' LXC ↔ Docker policy in agreement: a mismatch leaves one path open in nftables and closed in iptables (or the reverse), which is hard to debug.

## Installation

From the `examples/` directory (after editing the files for your interfaces, subnets, and policy):

```bash
# Base firewall (review and customize first)
sudo cp nftables.conf /etc/nftables.conf
sudo systemctl enable --now nftables.service

# Post-Docker DOCKER-USER rules
sudo cp nft-post-docker.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/nft-post-docker.sh
sudo cp nft-post-docker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nft-post-docker.service
```

Boot order should be `nftables` → LXD → Docker → `nft-post-docker`. If Docker or LXD is already installed, restart them after installing the base ruleset, then start `nft-post-docker.service` (or run the script by hand) so `DOCKER-USER` is populated on top of Docker's rules. Likewise, if the Docker daemon is restarted for any reason, the user must subsequently re-run `systemctl restart nft-post-docker.service` to re-establish correct firewall rules.


### Ordering of Startup Services

Run these commands to validate the ordering of the various services:
```bash
systemctl show docker.service -p After -p Before
systemctl show nftables.service -p After -p Before
systemctl show nft-post-docker.service -p After -p Before
systemctl show snap.lxd.daemon.service -p After -p Before
```

### Reset Firewall Without Rebooting

Reset the firewall without rebooting:
```bash
sudo nft -f /etc/nftables.conf
sudo snap restart lxd
sudo service docker restart
sudo bash /usr/local/bin/nft-post-docker.sh
```

### Testing

What's considered a passing result below will depend on whether the user intends to allow LXD → Docker and/or Docker → LXD access.

```bash
# 1. LXC → Internet (ping)
lxc exec pi-dev -- ping -c 3 8.8.8.8

# 1b. LXC → Internet (DNS + HTTP)
lxc exec pi-dev -- curl -sI https://example.com

# 2. Docker → Internet
docker run --rm alpine sh -c 'ping -c 3 8.8.8.8 && wget -qO- https://example.com | head -1'

# 3. Docker port forwarding (from host or wlan0 client)
docker run -dit --name test-apache -p 8080:80 httpd
curl -sI http://localhost:8080/

# 4. LXC → Docker (direct container-to-container)
DOCKER_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' test-apache)
lxc exec pi-dev -- curl -sI http://${DOCKER_IP}/

# 5. Verify DOCKER-USER rules are in place
iptables -L DOCKER-USER -n -v

# 6. Verify LXD NAT is present
nft list ruleset | grep -A5 masquerade

# 7. Full reboot test
sudo reboot
# After reboot, re-run tests 1-5
```
