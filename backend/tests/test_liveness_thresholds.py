"""
Regression test for PROJECT.md B4.5: six liveness/heartbeat thresholds used to
be independent magic numbers in main.py, pending_job_dispatcher.py, and
board_manager.py, with no declared relationship to each other or to the
agent's actual heartbeat interval. services.liveness now derives them from a
single HEARTBEAT_INTERVAL_SECONDS constant.

This is a pure refactor -- every derived value must still equal its
pre-existing numeric value (30/15/35/35/45). This test pins those numbers so
a future edit to the ratios in services.liveness is a deliberate, visible
change rather than an accidental one, and checks that the three consuming
modules actually import from the shared module instead of re-hardcoding.
"""
from services import liveness


def test_derived_thresholds_match_pre_refactor_values():
    assert liveness.HEARTBEAT_INTERVAL_SECONDS == 5
    assert liveness.OFFLINE_TIMEOUT_SECONDS == 30
    assert liveness.WATCHDOG_SWEEP_INTERVAL_SECONDS == 15
    assert liveness.DISPATCH_FRESH_CUTOFF_SECONDS == 35
    assert liveness.REBOOT_COOLDOWN_SECONDS == 35
    assert liveness.EVICT_BUSY_ONLINE_RECHECK_SECONDS == 45
    assert liveness.STUCK_BUSY_EVICTION_SECONDS == 900
    assert liveness.STALE_UPLOAD_SESSION_GC_SECONDS == 600


def test_consuming_modules_use_the_shared_constants():
    import main
    from services import pending_job_dispatcher, board_manager

    assert main.HEARTBEAT_TIMEOUT_SEC == liveness.OFFLINE_TIMEOUT_SECONDS
    assert main.WATCHDOG_INTERVAL_SEC == liveness.WATCHDOG_SWEEP_INTERVAL_SECONDS
    assert pending_job_dispatcher.DISPATCH_FRESH_CUTOFF_SECONDS == liveness.DISPATCH_FRESH_CUTOFF_SECONDS
    assert board_manager.REBOOT_COOLDOWN_SECONDS == liveness.REBOOT_COOLDOWN_SECONDS
    assert board_manager.EVICT_BUSY_ONLINE_RECHECK_SECONDS == liveness.EVICT_BUSY_ONLINE_RECHECK_SECONDS
