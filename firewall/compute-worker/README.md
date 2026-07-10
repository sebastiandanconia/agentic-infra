# firewall/compute-worker

Shorewall (IPv4) ruleset for a single AI worker node — a standalone host firewall (not a router/gateway).

## Design

- `fw` — The host itself (always named `fw` in Shorewall).
- `net` — Everything else, i.e. the public Internet.

Default policy:

| From | To  | Policy | Reason |
|------|-----|--------|--------|
| fw   | net | ACCEPT | Node may reach the public Internet |
| all  | all | DROP   | Catch-all |

## `params` file (Optional)

Shorewall supports `shorewall/params` for defining variables that are expanded within Shorewall's other configuration files at compile time. This helps with applying the "Don't Repeat Yourself" principle, and is also a good way of keeping hostnames and IP addresses out of Git, as we're doing here. Here's an example of a `shorewall/params` file you might add as a step toward making this Shorewall setup ready to use. If you don't use `params` files, you should instead replace every instance of `$VARIABLE` in the other configuration files with the values that apply to you:
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
+DNS_SERVER_BOTS="10.11.37.2"
+
+#LAST LINE -- DO NOT REMOVE
```

## Things to Check / Edit Before Starting

1. **Interface name.** Display with `ip -br link` and add/change it in `shorewall/params` or `shorewall/interfaces`.

2. **Params file** This file contains a list of variables that are expanded at firewall compile time. Add this file (or modify the other shorewall configuration files) to fit your own network. See the example above.

## Install shorewall(-lite)

`shorewall` is a complete program for compiling and locally installing a firewall on a system. For the use case of a cluster of worker hosts, it's recommended instead to use `shorewall` on a controller host to maintain and compile the firewall configuration, and install `shorewall-lite` on the workers themselves.

### Controller Host

```
sudo apt install shorewall
```

### Worker Host

```
sudo apt install shorewall-lite
```

### Shorewall-Lite capabilities

From the `shorewall` directory on your controller host:
```bash
ssh root@example.com "shorewall-lite -f capabilities" > capabilities
```

for each different configuration of worker host you manage. This tells your central `shorewall` what networking features are available on each worker host. After your central `shorewall` has a `capabilities` file for the worker host, you can compile the firewall for that host.


### LOGFILE Error

If you get an error similar to:
```
   ERROR: LOGFILE (/var/log/messages) does not exist or is not readable!
```

You'll need to edit `/etc/shorewall/shorewall.conf` or `/etc/shorewall-lite/shorewall-lite.conf` on the affected system. You should set `LOGFILE` to match the log facilities available on your system, for example:
- `LOGFILE=systemd`
- `LOGFILE=/var/log/syslog`

## Validate

Check your firewall configuration without applying it anywhere:
```
sudo shorewall  check .
```

## Start

### shorewall

**NOTE: This section applies only if you're managing your firewall configuration on the same system the firewall is protecting. (Not recommended.)**

```
# Apply for 120 s; reverts unless you confirm with `shorewall restart`:
sudo shorewall  try /etc/shorewall  120

# Belt-and-suspenders: a cron job that stops the firewall while you test:
( sudo crontab -l 2>/dev/null; echo '*/3 * * * * /sbin/shorewall stop' ) | sudo crontab -
```

Once you confirm your network services (e.g. SSH) still work, make your configuration permanent:

```
sudo systemctl enable --now shorewall
```

### shorewall-lite

**This is the recommended configuration.**

From the `shorewall` directory on your controller host:
```
shorewall remote-reload example.com
```
or
```
shorewall remote-restart example.com
```
NOTE: Although the above commands are intended to "fail safe" on remote systems, they can easily mess up a system using an NFS root file system, requiring a hard reboot.

If the process completes, your network services still work on the worker node, and you wish these settings to be applied upon reboot, from the worker node execute:
```
shorewall-lite save
```

## Notes

- `routefilter` + `logmartians` are enabled on the IPv4 interface (reverse-path filter, martian logging). Drop them from `shorewall/interfaces` if you hit asymmetric-routing problems.
- NFS v3 callback traffic (statd/lockd) from the server back to the node is the real reason the "NFS server may send anything" rule exists — it is not just convenience.
- Outbound to the public Internet is fully open (fw→net ACCEPT), so apt, pip, HTTP/HTTPS, NTP-to-public, etc. all work with no extra rules. Only private-network destinations need explicit rules.
- Shorewall has historically not integrated well with Docker. If you'll be using Docker or LXC, use appropriate options, such as `DOCKER=Yes` in `shorewall.conf`, and test your setup adequately. See [https://shorewall.org/Docker.html](https://shorewall.org/Docker.html).
