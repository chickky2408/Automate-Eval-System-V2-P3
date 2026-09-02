import unittest

from models.job import JobState
from routers.jobs import _map_job_state


class JobStatusMappingTest(unittest.TestCase):
    def test_draft_maps_to_draft(self):
        self.assertEqual(_map_job_state(JobState.DRAFT), "draft")


if __name__ == "__main__":
    unittest.main()
