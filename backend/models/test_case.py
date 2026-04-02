"""Test case and test set Pydantic models."""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class TestCaseCreate(BaseModel):
    """Schema for creating a new test case."""
    name: str
    vcd_file_id: Optional[str] = None
    firmware_filename: Optional[str] = None
    tags: Optional[str] = None


class TestCase(BaseModel):
    """Test case information."""
    id: str
    name: str
    vcd_file_id: Optional[str] = None
    firmware_filename: Optional[str] = None
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TestSetCreate(BaseModel):
    """Schema for creating a new test set."""
    name: str
    tags: Optional[str] = None


class TestSet(BaseModel):
    """Test set information."""
    id: str
    name: str
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TestSetItemCreate(BaseModel):
    """Schema for adding a test case to a test set."""
    test_set_id: str
    test_case_id: str
    execution_order: int


class TestSetItem(BaseModel):
    """Test set item information."""
    id: str
    test_set_id: str
    test_case_id: str
    execution_order: int
    created_at: datetime

    class Config:
        from_attributes = True
