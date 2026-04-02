"""Pydantic models for API schemas."""
from .board import BoardInfo, BoardStatus, BoardState
from .job import Job, JobCreate, JobStatus, JobState
from .result import TestResult, WaveformData
