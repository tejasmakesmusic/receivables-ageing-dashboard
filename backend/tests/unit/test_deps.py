"""Unit tests for FastAPI dependencies: get_current_user and require_role (spec D5, D11)."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.deps import get_current_user, require_role
from app.core.rbac import Role
from app.db.models.user import User


@pytest.fixture
def mock_request() -> MagicMock:
    """Mock Starlette Request object."""
    return MagicMock()


@pytest.fixture
def mock_session() -> MagicMock:
    """Mock SQLAlchemy Session object."""
    return MagicMock()


@pytest.fixture
def mock_user() -> User:
    """Mock User ORM object."""
    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "test@example.com"
    user.role = Role.ANALYST
    user.is_active = True
    return user


class TestGetCurrentUser:
    """Test get_current_user dependency."""

    def test_get_current_user_no_cookie_raises_401(
        self, mock_request: MagicMock, mock_session: MagicMock
    ) -> None:
        """Missing or invalid cookie should raise 401 Not authenticated."""
        with (
            patch("app.api.deps.read_session_cookie", return_value=None),
            pytest.raises(HTTPException) as exc_info,
        ):
            get_current_user(mock_request, mock_session)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Not authenticated"

    def test_get_current_user_user_not_in_db_raises_401(
        self, mock_request: MagicMock, mock_session: MagicMock
    ) -> None:
        """User not found in DB should raise 401 User not found."""
        # Mock session_data from cookie
        session_data = MagicMock()
        session_data.user_id = uuid.uuid4()

        # Mock session.get() to return None (user not found)
        mock_session.get.return_value = None

        with (
            patch("app.api.deps.read_session_cookie", return_value=session_data),
            pytest.raises(HTTPException) as exc_info,
        ):
            get_current_user(mock_request, mock_session)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "User not found"

    def test_get_current_user_inactive_user_raises_403(
        self, mock_request: MagicMock, mock_session: MagicMock, mock_user: User
    ) -> None:
        """Inactive user should raise 403 Account deactivated."""
        # Mock session_data
        session_data = MagicMock()
        session_data.user_id = uuid.uuid4()

        # Mock user with is_active=False
        mock_user.is_active = False
        mock_session.get.return_value = mock_user

        with (
            patch("app.api.deps.read_session_cookie", return_value=session_data),
            pytest.raises(HTTPException) as exc_info,
        ):
            get_current_user(mock_request, mock_session)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Account deactivated"

    def test_get_current_user_returns_user(
        self, mock_request: MagicMock, mock_session: MagicMock, mock_user: User
    ) -> None:
        """Valid cookie and active user should return User object."""
        # Mock session_data
        session_data = MagicMock()
        session_data.user_id = mock_user.id

        # Mock session.get() to return active user
        mock_session.get.return_value = mock_user

        with patch("app.api.deps.read_session_cookie", return_value=session_data):
            result = get_current_user(mock_request, mock_session)

        assert result == mock_user
        assert result.is_active is True


class TestRequireRole:
    """Test require_role dependency factory."""

    def test_require_role_correct_role_passes(self, mock_user: User) -> None:
        """User with correct role should pass through."""
        # Set user role to ANALYST
        mock_user.role = Role.ANALYST

        # Create dependency that requires ANALYST or CFO
        role_checker = require_role(Role.ANALYST, Role.CFO)

        # Call the returned dependency with the mock user
        result = role_checker(user=mock_user)

        assert result == mock_user

    def test_require_role_wrong_role_raises_403(self, mock_user: User) -> None:
        """User with wrong role should raise 403 Insufficient permissions."""
        # Set user role to PENDING
        mock_user.role = Role.PENDING

        # Create dependency that requires ADMIN only
        role_checker = require_role(Role.ADMIN)

        # Call the returned dependency with the mock user
        with pytest.raises(HTTPException) as exc_info:
            role_checker(user=mock_user)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Insufficient permissions"

    def test_require_role_multiple_roles_first_matches(self, mock_user: User) -> None:
        """User with first role in list should pass."""
        mock_user.role = Role.ADMIN

        role_checker = require_role(Role.ADMIN, Role.CFO)

        result = role_checker(user=mock_user)

        assert result == mock_user

    def test_require_role_multiple_roles_last_matches(self, mock_user: User) -> None:
        """User with last role in list should pass."""
        mock_user.role = Role.CFO

        role_checker = require_role(Role.ADMIN, Role.ANALYST, Role.CFO)

        result = role_checker(user=mock_user)

        assert result == mock_user

    def test_require_role_single_role(self, mock_user: User) -> None:
        """Requiring a single role should work."""
        mock_user.role = Role.CFO

        role_checker = require_role(Role.CFO)

        result = role_checker(user=mock_user)

        assert result == mock_user

    def test_require_role_single_role_mismatch(self, mock_user: User) -> None:
        """Single role requirement mismatch should raise 403."""
        mock_user.role = Role.ANALYST

        role_checker = require_role(Role.ADMIN)

        with pytest.raises(HTTPException) as exc_info:
            role_checker(user=mock_user)

        assert exc_info.value.status_code == 403
