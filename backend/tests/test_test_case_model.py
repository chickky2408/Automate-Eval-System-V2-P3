import unittest

from pydantic import ValidationError

from models.test_case import TestCaseCreate


class TestTestCaseCreateValidation(unittest.TestCase):
    def test_accepts_vcd_without_optional_erom_or_ulp(self):
        data = TestCaseCreate(name="TC1", vcd_file_id="vcd-1")

        self.assertEqual(data.vcd_file_id, "vcd-1")
        self.assertIsNone(data.bin_file_id)
        self.assertIsNone(data.lin_file_id)

    def test_rejects_blank_vcd_file_id(self):
        with self.assertRaises(ValidationError):
            TestCaseCreate(name="TC1", vcd_file_id="   ")


if __name__ == "__main__":
    unittest.main()
