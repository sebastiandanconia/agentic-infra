# firewall/compute-worker

Shorewall (IPv4) ruleset for a single AI worker node — a standalone host firewall (not a router/gateway).

## Design

One interface (`eth0`) is split into two zones by *destination address*:

- `fw` — The host itself (always named `fw` in Shorewall).
- `net` — Everything that is NOT RFC 1918 (IPv4) / ULA `fc00::/7` (IPv6), i.e. the public Internet.
- `lan` — RFC 1918 space (IPv4) / ULA (IPv6), i.e. the private network.

Default policy:

| From | To  | Policy | Reason |
|------|-----|--------|--------|
| fw   | net | ACCEPT | Node may reach the public Internet |
| fw   | lan | DROP   | Node must NOT roam the private network |
| net  | fw  | DROP   | Nothing from outside unless a rule allows it |
| lan  | fw  | DROP   | Nothing from the private net unless a rule allows it |
| all  | all | DROP   | Catch-all |

Every requirement is an exception (rule) punched through the DROP policies. Return traffic for connections the node itself opens is handled by conntrack (ESTABLISHED/RELATED), so it needs no explicit rules.

## Layout

```
shorewall/      -> copy to /etc/shorewall   (IPv4)
```

## `params` file (Optional)

Shorewall supports `shorewall/params` for defining variables that are expanded within Shorewall's other configuration files at compile time. This helps with applying the "Don't Repeat Yourself" principle, but it's also a good way of keeping hostnames and IP addresses out of Git, as we're doing here. Here's an example of a `shorewall/params` file you might add as a step toward making this Shorewall setup ready to use. If you don't use `params` files, you should instead replace every instance of `$VARIABLE` in the other configuration files with the values that apply to you:
```
+###############################################################################
+# Shorewall 5.2 params
+###############################################################################
+#
+# Assign any variables that you need here. It is suggested that variable names begin with
+# an upper case letter to distinguish them from variables used internally within the
+# Shorewall programs.
+
+NET_IF="eth0"
+S3_SERVER="10.11.14.45"
+NFS_SERVER="10.11.14.52"
+DNS_SERVER_PRIMARY="10.11.14.1"
+DNS_SERVER_SECONDARY="10.11.14.2"
+
+#LAST LINE -- DO NOT REMOVE
```

## Things to check / edit before starting

1. **Interface name.** Configs assume `eth0`. Confirm with `ip -br link` and
   change it in `shorewall/interfaces` and `shorewall6/interfaces` if different
   (e.g. `ens3`, `enp3s0`).

2. **Params file** This file contains a list of variables that are expanded at firewall compile time. Add this file (or modify the other shorewall configuration files) to fit your own network. See the example in this README.

## Install

```
sudo apt install shorewall
sudo cp -r shorewall/*  /etc/shorewall/
```

## Validate (does NOT touch the running firewall)

```
sudo shorewall  check
```

## Start — safely (auto-reverts if you lock yourself out)

```
# Apply for 120 s; reverts unless you confirm with `shorewall restart`:
sudo shorewall  try /etc/shorewall  120

# Belt-and-suspenders: a cron job that stops the firewall while you test:
( sudo crontab -l 2>/dev/null; echo '*/3 * * * * /sbin/shorewall stop' ) | sudo crontab -
```

Once you confirm SSH etc. still work, make it permanent:

```
sudo systemctl enable --now shorewall shorewall6
```

## Notes

- `routefilter` + `logmartians` are enabled on the IPv4 interface (reverse-path filter, martian logging). Drop them from `shorewall/interfaces` if you hit asymmetric-routing problems.
- NFS v3 callback traffic (statd/lockd) from the server back to the node is the real reason the "NFS server may send anything" rule exists — it is not just convenience.
- Outbound to the public Internet is fully open (fw→net ACCEPT), so apt, pip, HTTP/HTTPS, NTP-to-public, etc. all work with no extra rules. Only private-network destinations need explicit rules.
- Shorewall has historically not integrated well with Docker. If you'll be using Docker or LXC, use appropriate options, such as `DOCKER=Yes` in `shorewall.conf`, and test your setup adequately. See [https://shorewall.org/Docker.html](https://shorewall.org/Docker.html).
