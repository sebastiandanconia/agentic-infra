#!/bin/bash
set -e

# =============================================================================
# nft-post-docker.sh - DOCKER-USER chain rules for LXC + Docker coexistence
# =============================================================================
# Without this script, Docker's FORWARD chain (policy DROP) silently drops all
# LXC dev-net traffic. Both the nftables forward chain and the iptables
# FORWARD chain evaluate every forwarded packet — a DROP in either one drops
# the packet. This script installs rules in Docker's DOCKER-USER chain
# (evaluated first in Docker's FORWARD chain) to whitelist LXC traffic.
#
# The custom chains created here mirror the subchain names in nftables.conf
# so the policy mapping between the two files is explicit. When you change
# a policy in one file, update the matching chain in the other.
#
# Install:
#   sudo cp nft-post-docker.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/nft-post-docker.sh
# =============================================================================


# =============================================================================
# CONFIGURATION
# =============================================================================

# LXC <--> Docker forwarding policy. Must match the corresponding chains in
# nftables.conf:
#
#   "none"        No LXC↔Docker forwarding.
#                 nftables.conf: lxd2docker { drop },  docker2lxd { drop }
#
#   "lxd2docker"  LXC can reach Docker; Docker cannot reach LXC.
#                 nftables.conf: lxd2docker { accept }, docker2lxd { drop }
#
#   "docker2lxd"  Docker can reach LXC; LXC cannot reach Docker.
#                 nftables.conf: lxd2docker { drop },  docker2lxd { accept }
#
#   "both"        Bidirectional LXC↔Docker forwarding.
#                 nftables.conf: lxd2docker { accept }, docker2lxd { accept }
POLICY_LXD_DOCKER="none"

# PUBLIC_NICS, DOCKER_IFACES, and DOCKER_CIDRS below are Bash arrays;
# separate multiple elements using spaces.

# Internet-facing (public) interfaces. LXC containers need egress through
# these. Add all interfaces that serve as upstream gateways — the script
# handles multiple NICs.
PUBLIC_NICS=("wlan0")

# LXC bridge interface
LXC_BRIDGE="dev-net"

# Docker networks: the default bridge interface and any CIDR ranges used by
# custom Docker networks. The default Docker pool is 172.16.0.0/12.
DOCKER_IFACES=("docker0")
DOCKER_CIDRS=("172.16.0.0/12")


# =============================================================================
# IMPLEMENTATION
# =============================================================================

# Verify Docker is running and DOCKER-USER exists
if ! iptables -L DOCKER-USER -n >/dev/null 2>&1; then
    echo "ERROR: DOCKER-USER chain does not exist. Is Docker running?" >&2
    exit 1
fi

# --- Clean up previous rules (idempotent) ---
# Flush DOCKER-USER and restore Docker's default RETURN. This is safe because
# Docker only populates DOCKER-USER with a single RETURN by default. If other
# tools also modify DOCKER-USER, they should run after this script.
iptables -F DOCKER-USER

# Remove leftover custom chains from previous runs
for chain in lxd2docker docker2lxd lxd2net; do
    iptables -F "$chain" 2>/dev/null || true
    iptables -X "$chain" 2>/dev/null || true
done

# --- Create custom chains (names mirror nftables.conf subchains) ---

iptables -N lxd2docker    # LXC → Docker
iptables -N docker2lxd    # Docker → LXC (also handles Internet → LXC return)
iptables -N lxd2net       # LXC → Internet


# --- Populate lxd2docker chain ---
case "$POLICY_LXD_DOCKER" in
    none|docker2lxd)
        # Allow return traffic for connections Docker initiated to LXC
        iptables -A lxd2docker -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
        iptables -A lxd2docker -j DROP
        ;;
    lxd2docker|both)
        iptables -A lxd2docker -j ACCEPT
        ;;
    *)
        echo "ERROR: Invalid POLICY_LXD_DOCKER='$POLICY_LXD_DOCKER'" >&2
        exit 1
        ;;
esac

# --- Populate docker2lxd chain ---
# Note: This chain sees ALL traffic destined to dev-net, not just Docker-sourced
# traffic. Internet --> LXC return traffic (RELATED,ESTABLISHED) is also handled
# here. In nftables.conf, that return traffic is caught earlier by
# `ct state { established, related } accept` at the top of the forward chain
# and never reaches the nftables docker2lxd chain. The net effect is the same.
case "$POLICY_LXD_DOCKER" in
    none|lxd2docker)
        # Allow return traffic for connections LXC initiated to Docker
        iptables -A docker2lxd -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
        iptables -A docker2lxd -j DROP
        ;;
    docker2lxd|both)
        iptables -A docker2lxd -j ACCEPT
        ;;
esac

# --- Populate lxd2net chain ---
# LXC --> Internet is always allowed (mirrors the `accept` at end of lxd_frwd
# in nftables.conf). Traffic to NICs not listed here falls through to RETURN
# and is subsequently dropped by Docker's FORWARD policy.
if [ ${#PUBLIC_NICS[@]} -gt 0 ]; then
    for nic in "${PUBLIC_NICS[@]}"; do
        iptables -A lxd2net -o "$nic" -j ACCEPT
    done
else
    # No specific NICs listed — allow all egress
    iptables -A lxd2net -j ACCEPT
fi


# --- Wire DOCKER-USER to jump to our chains ---
# Order matters: most specific first. Rules are appended in order, with
# Docker's default RETURN added last.

# 1. LXC --> Docker (match by Docker bridge interface)
for iface in "${DOCKER_IFACES[@]}"; do
    iptables -A DOCKER-USER -i "$LXC_BRIDGE" -o "$iface" -j lxd2docker
done

# 2. LXC --> Docker (match by Docker CIDR for custom networks)
for cidr in "${DOCKER_CIDRS[@]}"; do
    iptables -A DOCKER-USER -i "$LXC_BRIDGE" -d "$cidr" -j lxd2docker
done

# 3. LXC → Internet (remaining LXC egress not matched above)
iptables -A DOCKER-USER -i "$LXC_BRIDGE" -j lxd2net

# 4. Docker/Internet --> LXC (all traffic destined to dev-net)
#    docker2lxd uses conntrack to differentiate:
#      - NEW connections: from Docker (allowed or dropped per policy)
#      - RELATED,ESTABLISHED: return traffic from Internet or Docker (always allowed)
iptables -A DOCKER-USER -o "$LXC_BRIDGE" -j docker2lxd

# 5. Default RETURN (Docker handles remaining traffic with its own FORWARD rules)
#    Docker --> Internet falls through here and is accepted by Docker's own rules.
iptables -A DOCKER-USER -j RETURN


# =============================================================================
# Verification output
# =============================================================================

echo "=== DOCKER-USER rules installed ==="
echo "Policy: POLICY_LXD_DOCKER=$POLICY_LXD_DOCKER"
echo "Public NICs: ${PUBLIC_NICS[*]}"
echo "LXC bridge: $LXC_BRIDGE"
echo ""
echo "--- DOCKER-USER ---"
iptables -L DOCKER-USER -n -v --line-numbers
echo ""
for chain in lxd2docker docker2lxd lxd2net; do
    echo "--- $chain ---"
    iptables -L "$chain" -n -v --line-numbers
    echo ""
done
