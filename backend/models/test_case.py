"""Test Case and Run Set Pydantic models."""
from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime


class TestCaseCreate(BaseModel):
    """Schema for creating a new test case."""
    name: str
    vcd_file_id: str
    bin_file_id: Optional[str] = None
    lin_file_id: Optional[str] = None
    mdi_file_id: Optional[str] = None
    config_options: Optional[Dict[str, Any]] = None

    @field_validator("vcd_file_id")
    @classmethod
    def validate_vcd_file_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("VCD file is required")
        return value


class TestCase(BaseModel):
    """Test case information."""
    id: str
    name: str
    vcd_file_id: str
    bin_file_id: Optional[str] = None
    lin_file_id: Optional[str] = None
    mdi_file_id: Optional[str] = None
    config_options: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RunSetCreate(BaseModel):
    """Schema for creating a new run set."""
    name: str
    test_case_ids: Optional[List[Dict[str, Any]]] = None # [{"test_case_id": "...", "try_count": 3, "execution_order": 10}]


class RunSet(BaseModel):
    """Run set information."""
    id: str
    name: str
    test_case_ids: Optional[List[Dict[str, Any]]] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Legacy stubs for backward compatibility during cutover
class TestSetCreate(BaseModel):
    name: str
    tags: Optional[str] = None

class TestSet(BaseModel):
    id: str
    name: str
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TestSetItemCreate(BaseModel):
    test_set_id: str
    test_case_id: str
    execution_order: int

class TestSetItem(BaseModel):
    id: str
    test_set_id: str
    test_case_id: str
    execution_order: int
    created_at: datetime

    class Config:
        from_attributes = True
