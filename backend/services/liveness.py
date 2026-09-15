"""
Single source of truth for board liveness/heartbeat timing (PROJECT.md B4.5).

Before this module, six thresholds were scattered across four files as
independent magic numbers (main.py, pending_job_dispatcher.py, board_manager.py)
with no declared relationship to each other or to the agent's actual heartbeat
interval (fpga_interface/board_agent/config.py:145, agent.toml:11 -- 5 seconds).
Changing the heartbeat interval on the agent side silently broke every ratio
here, because nothing referenced a shared base.

HEARTBEAT_INTERVAL_SECONDS below is NOT read from the agent's config -- the
backend and the board agent are separately deployed processes/repos, so there
is no shared import path. It is a documented mirror of the agent's actual
interval. If the agent's heartbeat interval changes, this constant must be
updated to match, and every threshold below moves with it automatically.

Every derived value here is set to its pre-existing numeric value (30s, 15s,
35s, 35s, 45s) -- this is a pure refactor centralizing the numbers, not a
behavior change. Two related items are explicitly deferred, since fixing them
requires touching the board agent (a fleet redeploy), which is out of scope
for this server-side-only milestone (see PROJECT.md B0/B4.5):
  - a monotonic heartbeat sequence number + missed-beat tracking
  - signing heartbeats with a per-board pre-shared token
"""

HEARTBEAT_INTERVAL_SECONDS = 5

# Board considered offline after this many seconds of heartbeat silence.
OFFLINE_TIMEOUT_SECONDS = 6 * HEARTBEAT_INTERVAL_SECONDS  # 30

# How often the server watchdog sweeps for stale/offline boards.
WATCHDOG_SWEEP_INTERVAL_SECONDS = 3 * HEARTBEAT_INTERVAL_SECONDS  # 15

# Dispatcher's "online" cutoff: a board must have heartbeated within this many
# seconds to be considered a live dispatch target.
DISPATCH_FRESH_CUTOFF_SECONDS = 7 * HEARTBEAT_INTERVAL_SECONDS  # 35

# After requesting a board reboot, ignore its heartbeats for this long (gives
# the board time to actually go down and come back up before being trusted).
REBOOT_COOLDOWN_SECONDS = 7 * HEARTBEAT_INTERVAL_SECONDS  # 35

# When evicting a board stuck in "busy", a heartbeat within this window is
# still considered "online enough" to flip it back to online instead of offline.
EVICT_BUSY_ONLINE_RECHECK_SECONDS = 9 * HEARTBEAT_INTERVAL_SECONDS  # 45

# Below are operational maintenance windows, not heartbeat-cadence ratios --
# kept here only so all liveness/GC timing lives in one place.
STUCK_BUSY_EVICTION_SECONDS = 900  # 15 minutes
STALE_UPLOAD_SESSION_GC_SECONDS = 600  # 10 minutes
