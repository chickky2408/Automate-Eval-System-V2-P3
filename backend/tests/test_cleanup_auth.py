import os
import unittest

from fastapi import HTTPException

from utils.cleanup_auth import require_cleanup_passcode


class TestCleanupPasscode(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get("CLEANUP_PASSCODE")

    def tearDown(self):
        if self._orig is None:
            os.environ.pop("CLEANUP_PASSCODE", None)
        else:
            os.environ["CLEANUP_PASSCODE"] = self._orig

    def test_disabled_when_env_unset(self):
        os.environ.pop("CLEANUP_PASSCODE", None)
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="anything")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_disabled_when_env_blank(self):
        os.environ["CLEANUP_PASSCODE"] = "   "
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="anything")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_missing_header_rejected(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode=None)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_wrong_passcode_rejected(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="nope")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_correct_passcode_allowed(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        self.assertIsNone(require_cleanup_passcode(x_cleanup_passcode="secret"))


if __name__ == "__main__":
    unittest.main()
