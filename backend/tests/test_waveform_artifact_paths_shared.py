"""
Regression test for PROJECT.md B1.11: routers/agent_results.py's WAVEFORM
outputs and services/waveform_comparator.py's DIFF outputs used to each
compute the year/month bucket independently (via two different formatting
styles), and neither went through file_store's path-building at all. Both now
call FileStore.current_year_month(); this locks in that they agree with each
other and with the real clock.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

from datetime import datetime

from services.file_store import file_store


def test_current_year_month_matches_utcnow():
    yr, mo = file_store.current_year_month()
    now = datetime.utcnow()
    assert yr == f"{now:%Y}"
    assert mo == f"{now:%m}"
    assert len(yr) == 4
    assert len(mo) == 2


def test_waveform_comparator_uses_the_shared_helper():
    """services/waveform_comparator.py used to compute year/month independently
    (`datetime.datetime.now(datetime.timezone.utc)` + manual str(now.year)/
    f"{now.month:02d}") instead of going through file_store. Verify
    save_diff_artifact() actually lands its file under file_store's
    current_year_month() bucket, not some other value."""
    import json
    import tempfile

    from services.file_store import file_store
    from services.waveform_comparator import WaveformComparatorService

    with tempfile.TemporaryDirectory() as tmp:
        svc = WaveformComparatorService(storage_dir=tmp)
        path = svc.save_diff_artifact("result-b111-check", {"summary": {"overall_pass": True}})

        yr, mo = file_store.current_year_month()
        assert os.path.join(tmp, yr, mo) in path
        assert os.path.exists(path)


if __name__ == "__main__":
    test_current_year_month_matches_utcnow()
    print("test_current_year_month_matches_utcnow OK")
    test_waveform_comparator_uses_the_shared_helper()
    print("test_waveform_comparator_uses_the_shared_helper OK")
